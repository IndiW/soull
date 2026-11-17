import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer } from "../service/server.mjs";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

test("conversation API: queue, idempotency, scoped approvals, deltas, cancellation and restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "soull-chat-"));
  const executions = [];
  const makeChatRun = (options) => {
    const run = {
      ...options,
      prompt: "",
      responses: [],
      start(prompt) {
        this.prompt = prompt;
      },
      respond(id, decision) {
        this.responses.push({ id, decision });
      },
      stop() {
        options.emit({ type: "done", status: "interrupted" });
      },
    };
    executions.push(run);
    return run;
  };
  let app = await startServer({ dataDir: root, port: 0, makeChatRun });
  const manager = app.store.addManager("Mika", root, "codex");
  const f = (id) =>
    app.store.addFeature({
      id,
      managerId: manager.id,
      title: id,
      branch: id,
      workspace: root,
      base: "abc",
      created: new Date().toISOString(),
    });
  const feature = f("feature-one"),
    other = f("feature-two");
  const call = async (suffix = "", body, id = feature.id) => {
    const response = await fetch(
      `${app.url}/api/features/${id}/conversation${suffix}`,
      {
        method: body ? "POST" : "GET",
        headers: { Authorization: "Bearer " + app.token },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal(
      (await fetch(`${app.url}/api/features/${feature.id}/conversation`))
        .status,
      401,
    );
    assert.equal(
      (await call("", { prompt: " ", requestId: "blank" })).status,
      400,
    );
    const first = (
      await call("", { prompt: "First question", requestId: "one" })
    ).body;
    assert.equal(
      (await call("", { prompt: "First question", requestId: "one" })).body.id,
      first.id,
    );
    assert.equal(executions.length, 1);
    const second = (await call("", { prompt: "Follow up", requestId: "two" }))
      .body;
    assert.equal(second.status, "queued");
    executions[0].emit({ type: "session", id: "provider-thread-1" });
    executions[0].emit({ type: "delta", id: "answer", text: "Hi " });
    executions[0].emit({ type: "delta", id: "answer", text: "世界" });
    executions[0].emit({
      type: "approval",
      id: "17",
      rpcId: 17,
      method: "item/commandExecution/requestApproval",
      detail: "git status",
    });
    await pause(130);
    const page = (await call()).body;
    assert.equal(page.turns[0].blocks[0].text, "Hi 世界");
    assert.equal(page.turns[0].status, "waiting");
    assert.equal(
      (
        await call(
          `/${first.id}/approval`,
          { requestId: "17", decision: "accept" },
          other.id,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await call(`/${first.id}/approval`, {
          requestId: "17",
          decision: "acceptForSession",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call(`/${first.id}/approval`, {
          requestId: "17",
          decision: "accept",
        })
      ).status,
      200,
    );
    assert.deepEqual(executions[0].responses, [{ id: 17, decision: "accept" }]);
    assert.equal(
      (
        await call(`/${first.id}/approval`, {
          requestId: "17",
          decision: "accept",
        })
      ).status,
      409,
    );
    executions[0].emit({ type: "done", status: "completed" });
    await pause(0);
    assert.equal(executions.length, 2);
    assert.equal(executions[1].sessionId, "provider-thread-1");
    const updates = (await call("?after=" + page.cursor)).body;
    assert.equal(updates.turns[0].status, "completed");
    assert.equal((await call("?after=" + updates.cursor)).body.turns.length, 0);
    assert.equal(
      (await call(`/${second.id}/cancel`, {}, other.id)).status,
      404,
    );
    await call(`/${second.id}/cancel`, {});
    assert.equal(app.conversations.chat.get(second.id).status, "interrupted");
    const third = (
      await call("", { prompt: "Interrupt on shutdown", requestId: "three" })
    ).body;
    await app.close();
    app = await startServer({ dataDir: root, port: 0, makeChatRun });
    const restored = (await call()).body;
    assert.equal(restored.turns.length, 3);
    assert.equal(
      restored.turns.find((t) => t.id === third.id).status,
      "interrupted",
    );
    assert.equal(
      app.conversations.chat.session(feature.id).sessionId,
      "provider-thread-1",
    );
    // Crash recovery also covers requests left queued/running without a graceful close.
    const abandoned = app.conversations.chat.add(
      feature.id,
      "codex",
      "No replay",
      "abandoned",
    );
    app.conversations.chat.update(abandoned.id, { status: "running" });
    await app.close();
    app = await startServer({ dataDir: root, port: 0, makeChatRun });
    assert.equal(
      app.conversations.chat.get(abandoned.id).status,
      "interrupted",
    );
    assert.match(
      app.conversations.chat.get(abandoned.id).error,
      /not replayed/,
    );
    const n = executions.length;
    await pause(0);
    assert.equal(executions.length, n);
    for (let i = 0; i < 65; i++)
      app.conversations.chat.add(
        feature.id,
        "codex",
        "History " + i,
        "history-" + i,
      );
    const latest = (await call()).body;
    assert.equal(latest.turns.length, 30);
    assert.equal(latest.hasOlder, true);
    const earlier = (await call("?before=" + latest.turns[0].ordinal)).body;
    assert.equal(earlier.turns.length, 30);
    assert.ok(earlier.turns.at(-1).ordinal < latest.turns[0].ordinal);
    assert.equal((await call("?after=NaN")).status, 400);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
