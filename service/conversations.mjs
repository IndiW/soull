import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChatStore } from "./chat-store.mjs";
import { providerRun } from "./providers.mjs";
const project = fileURLToPath(new URL("..", import.meta.url));
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const limitText = (value) => String(value || "").slice(0, 100_000);
export class Conversations {
  running = new Map();
  closed = false;
  constructor(store, runtimeFile, makeRun = providerRun) {
    this.store = store;
    this.runtimeFile = runtimeFile;
    this.makeRun = makeRun;
    this.chat = new ChatStore(store.db);
  }
  send(featureId, prompt, requestId) {
    const feature = this.store.feature(featureId),
      manager = this.store.manager(feature.managerId);
    const existing = this.chat.existing(featureId, requestId);
    if (existing) return existing;
    if (this.chat.queued(featureId).length >= 8)
      throw fail(
        "This conversation already has eight queued messages. Wait or cancel one.",
        409,
      );
    const turn = this.chat.add(featureId, manager.provider, prompt, requestId);
    this.pump(featureId);
    return turn;
  }
  pump(featureId) {
    if (this.closed || this.running.has(featureId)) return;
    const next = this.chat.queued(featureId)[0];
    if (!next) return;
    const turn = this.chat.get(next.id),
      feature = this.store.feature(featureId),
      manager = this.store.manager(feature.managerId);
    const record = {
      turn,
      run: null,
      timer: null,
      pending: new Map(),
      dirty: false,
    };
    this.running.set(featureId, record);
    turn.status = "running";
    this.chat.update(turn.id, turn);
    const flush = () => {
      clearTimeout(record.timer);
      record.timer = null;
      if (record.dirty) {
        this.chat.update(turn.id, turn);
        record.dirty = false;
      }
    };
    const changed = () => {
      record.dirty = true;
      if (!record.timer) record.timer = setTimeout(flush, 100);
    };
    const block = (id, kind) => {
      let b = turn.blocks.find((b) => b.id === id);
      if (!b) {
        if (turn.blocks.length >= 300)
          throw new Error(
            "This reply exceeded the activity limit. Continue with a new message.",
          );
        b = { id, kind, text: "" };
        turn.blocks.push(b);
      }
      return b;
    };
    const emit = (event) => {
      if (
        !this.running.has(featureId) ||
        this.running.get(featureId) !== record
      )
        return;
      try {
        if (event.type === "session") {
          this.chat.setSession(featureId, manager.provider, event.id);
          return;
        }
        if (event.type === "done") {
          turn.status = event.status;
          turn.error = limitText(event.error || turn.error);
          for (const b of turn.blocks)
            if (b.kind === "approval" && b.status === "waiting")
              b.status = "expired";
          record.pending.clear();
          record.dirty = true;
          flush();
          this.running.delete(featureId);
          queueMicrotask(() => this.pump(featureId));
          return;
        }
        if (event.type === "delta") {
          const b = block(event.id, "message");
          if (event.group) b.group = event.group;
          b.text = limitText(b.text + event.text);
        }
        if (event.type === "message")
          Object.assign(block(event.id, "message"), {
            text: limitText(event.text),
            phase: event.phase,
            group: event.group,
          });
        if (
          event.type === "final" &&
          !turn.blocks.some((b) => b.kind === "message" && b.text)
        )
          Object.assign(block("final", "message"), {
            text: limitText(event.text),
          });
        if (event.type === "activity") {
          const b = block(event.id, "activity");
          if (event.title) b.title = limitText(event.title).slice(0, 300);
          Object.assign(b, {
            text: limitText(event.text),
            status: event.status,
          });
        }
        if (event.type === "approval") {
          record.pending.set(event.id, event.rpcId);
          Object.assign(block(event.id + "-approval", "approval"), {
            requestId: event.id,
            title: event.method.includes("fileChange")
              ? "Allow file changes?"
              : "Allow command?",
            text: limitText(event.detail),
            summary: limitText(event.summary),
            canAccept: event.canAccept !== false,
            status: "waiting",
          });
          turn.status = "waiting";
        }
        if (event.type === "resolved") {
          record.pending.delete(event.id);
          const b = turn.blocks.find((b) => b.id === event.id + "-approval");
          if (b?.status === "waiting") b.status = "resolved";
          turn.status = record.pending.size ? "waiting" : "running";
        }
        if (
          turn.blocks.reduce((size, b) => size + b.text.length, 0) > 500_000
        ) {
          turn.error =
            "This reply reached Soull’s transcript size limit. The provider was stopped; continue with a new message.";
          record.run?.stop();
          return;
        }
        changed();
      } catch (error) {
        turn.error = error.message;
        record.run?.stop();
      }
    };
    const saved = this.chat.session(featureId);
    record.run = this.makeRun({
      provider: manager.provider,
      feature,
      manager,
      sessionId: saved?.provider === manager.provider ? saved.sessionId : null,
      env: {
        ...process.env,
        PATH: path.join(project, "bin") + path.delimiter + process.env.PATH,
        SOULL_FEATURE_ID: featureId,
        SOULL_WORKSPACE: feature.workspace,
        SOULL_RUNTIME_FILE: this.runtimeFile,
      },
      emit,
    });
    Promise.resolve(record.run.start(turn.prompt)).catch((e) =>
      emit({ type: "done", status: "failed", error: e.message }),
    );
  }
  cancel(featureId, id) {
    const turn = this.chat.get(id);
    if (!turn || turn.featureId !== featureId)
      throw fail("Message not found", 404);
    if (turn.status === "queued")
      this.chat.update(id, { status: "interrupted" });
    else if (this.running.get(featureId)?.turn.id === id)
      this.running.get(featureId).run.stop();
  }
  respond(featureId, turnId, requestId, decision) {
    const record = this.running.get(featureId);
    if (!record || record.turn.id !== turnId || !record.pending.has(requestId))
      throw fail("This approval is no longer waiting", 409);
    if (!["accept", "decline"].includes(decision))
      throw fail("Choose Allow once or Deny");
    const approval = record.turn.blocks.find((b) => b.requestId === requestId);
    if (decision === "accept" && approval?.canAccept === false)
      throw fail("The provider does not allow this approval decision", 409);
    record.run.respond(record.pending.get(requestId), decision);
    record.pending.delete(requestId);
    const b = record.turn.blocks.find((b) => b.requestId === requestId);
    b.status = decision === "accept" ? "allowed" : "denied";
    record.turn.status = record.pending.size ? "waiting" : "running";
    this.chat.update(turnId, record.turn);
  }
  close() {
    this.closed = true;
    for (const record of this.running.values()) record.run.stop();
  }
}
