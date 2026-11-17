import { spawn } from "node:child_process";

// JSON lines only. Limit untrusted frames before allocating an unbounded transcript.
export function jsonLines(stream, onMessage, onError) {
  let buffer = "";
  const data = (chunk) => {
    buffer += chunk.toString();
    if (Buffer.byteLength(buffer) > 4 * 1024 * 1024) {
      buffer = "";
      onError(new Error("Provider frame exceeded 4 MiB"));
      return;
    }
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      try {
        onMessage(JSON.parse(line));
      } catch (error) {
        onError(error);
      }
    }
  };
  // setEncoding preserves UTF-8 characters split across OS pipe chunks.
  stream.setEncoding("utf8");
  stream.on("data", data);
  stream.on("end", () => {
    if (buffer.trim()) {
      try {
        onMessage(JSON.parse(buffer));
      } catch (e) {
        onError(e);
      }
    }
  });
}
const instructions = (name) =>
  `You are ${name}, the user's persistent manager in Soull. Lead with the outcome, use readable Markdown, and put supporting details after the answer. Coordinate developers yourself; communicate directly with the user. Publish durable findings with soull when useful (run soull help). File links must be workspace-relative Markdown links, optionally :line. Do not claim tools or tests ran without evidence.`;

// Preserve the CLI's own sign-in, subscription and configuration. No token handling.
export function providerRun({
  provider,
  feature,
  manager,
  sessionId,
  env,
  emit,
  spawnProcess = spawn,
}) {
  let child,
    done = false,
    stopTimer;
  const pending = new Map();
  let serial = 0;
  const result = {};
  const finish = (status, error = "") => {
    if (done) return;
    done = true;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(error || "Provider closed"));
    }
    pending.clear();
    emit({ type: "done", status, error });
    child?.stdin?.end();
    child?.kill("SIGTERM");
  };
  const write = (message) => {
    if (!done && child?.stdin?.writable)
      child.stdin.write(JSON.stringify(message) + "\n");
  };
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++serial;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          new Error(
            `Codex timed out during ${method}. Update the CLI and try again.`,
          ),
        );
      }, 30_000);
      pending.set(id, { resolve, reject, timer });
      write({ id, method, params });
    });
  const launch = (command, args) => {
    child = spawnProcess(command, args, {
      cwd: feature.workspace,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    // Never persist arbitrary stderr (provider logs can contain private diagnostics).
    child.stderr.on("data", () => {});
    child.stdin.on("error", (e) => {
      if (!done) finish("failed", e.message);
    });
    child.on("error", (e) =>
      finish(
        "failed",
        e.code === "ENOENT"
          ? `Install ${command}, sign in using its CLI, then send again.`
          : e.message,
      ),
    );
    child.on("close", (code) => {
      // The process group can still contain tools after the CLI itself exits.
      if (!done)
        finish(
          "failed",
          `${command} exited (${code ?? "signal"}) before completing. Check its sign-in in Terminal and CLI version.`,
        );
    });
    return child;
  };
  result.stop = () => {
    if (done) return;
    // Terminate the process group so provider-owned tools do not outlive Stop.
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child?.kill("SIGTERM");
    }
    stopTimer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    }, 2000);
    stopTimer.unref();
    finish("interrupted");
  };
  result.respond = (id, decision) => {
    write({ id, result: { decision } });
  };
  result.start = async (prompt) => {
    if (provider === "codex") {
      launch("codex", ["app-server"]);
      jsonLines(
        child.stdout,
        (msg) => {
          if (done) return;
          if (msg.id !== undefined && !msg.method) {
            const p = pending.get(msg.id);
            if (!p) return;
            pending.delete(msg.id);
            clearTimeout(p.timer);
            msg.error
              ? p.reject(new Error(msg.error.message))
              : p.resolve(msg.result);
            return;
          }
          const p = msg.params || {};
          if (msg.id !== undefined && msg.method) {
            if (
              [
                "item/commandExecution/requestApproval",
                "item/fileChange/requestApproval",
              ].includes(msg.method)
            )
              emit({
                type: "approval",
                id: String(msg.id),
                rpcId: msg.id,
                method: msg.method,
                detail: JSON.stringify(p, null, 2),
                summary:
                  p.command ||
                  p.reason ||
                  p.grantRoot ||
                  (p.networkApprovalContext
                    ? `${p.networkApprovalContext.protocol}://${p.networkApprovalContext.host}`
                    : ""),
                canAccept:
                  !p.availableDecisions ||
                  p.availableDecisions.includes("accept"),
              });
            else {
              // Unknown requests fail closed, rather than leaving a turn waiting forever.
              write({
                id: msg.id,
                error: {
                  code: -32601,
                  message:
                    "This request is not supported by Soull. Ask the user in your next message.",
                },
              });
              emit({
                type: "activity",
                id: `unsupported-${msg.id}`,
                title: "Provider requested an unsupported interaction",
                text: msg.method,
                status: "declined",
              });
            }
            return;
          }
          if (msg.method === "item/agentMessage/delta")
            emit({ type: "delta", id: p.itemId, text: p.delta });
          if (["item/started", "item/completed"].includes(msg.method)) {
            const i = p.item || {};
            if (i.type === "agentMessage")
              emit({
                type: "message",
                id: i.id,
                text: i.text || "",
                phase: i.phase,
              });
            else if (i.type !== "userMessage" && i.type !== "reasoning")
              emit({
                type: "activity",
                id: i.id,
                title: i.command || i.tool || i.type,
                text:
                  i.aggregatedOutput ||
                  (i.changes ? i.changes.map((c) => c.path).join("\n") : ""),
                status:
                  i.status ||
                  (msg.method === "item/completed" ? "completed" : "running"),
              });
          }
          if (msg.method === "serverRequest/resolved")
            emit({ type: "resolved", id: String(p.requestId) });
          if (msg.method === "turn/completed")
            finish(
              p.turn.status === "completed"
                ? "completed"
                : p.turn.status === "interrupted"
                  ? "interrupted"
                  : "failed",
              p.turn.error?.message || "",
            );
          if (msg.method === "error" && !p.willRetry)
            emit({
              type: "activity",
              id: "provider-error",
              title: "Provider error",
              text: p.error?.message || "Request failed",
              status: "failed",
            });
        },
        (e) => finish("failed", `Invalid Codex protocol: ${e.message}`),
      );
      try {
        await rpc("initialize", {
          clientInfo: { name: "soull", title: "Soull", version: "0.1.0" },
        });
        write({ method: "initialized", params: {} });
        const options = {
          cwd: feature.workspace,
          approvalPolicy: "on-request",
          sandbox: "workspace-write",
          developerInstructions: instructions(manager.name),
        };
        const thread = await rpc(
          sessionId ? "thread/resume" : "thread/start",
          sessionId
            ? { ...options, threadId: sessionId, excludeTurns: true }
            : options,
        );
        emit({ type: "session", id: thread.thread.id });
        await rpc("turn/start", {
          threadId: thread.thread.id,
          input: [{ type: "text", text: prompt }],
        });
      } catch (e) {
        finish("failed", e.message);
      }
    } else {
      const args = [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--append-system-prompt",
        instructions(manager.name),
      ];
      if (sessionId) args.push("--resume", sessionId);
      launch("claude", args);
      let messageId = "",
        blockIndex = 0;
      jsonLines(
        child.stdout,
        (msg) => {
          if (done || msg.parent_tool_use_id) return; // Developers report via the manager, not as user-facing chat.
          if (msg.session_id) emit({ type: "session", id: msg.session_id });
          if (msg.type === "stream_event") {
            const e = msg.event || {};
            if (e.type === "message_start")
              messageId = e.message?.id || `claude-${Date.now()}`;
            if (e.type === "content_block_start") {
              blockIndex = e.index;
              if (e.content_block?.type === "tool_use")
                emit({
                  type: "activity",
                  id: e.content_block.id,
                  title: e.content_block.name,
                  text: "",
                  status: "running",
                });
            }
            if (e.delta?.type === "text_delta")
              emit({
                type: "delta",
                id: `${messageId}:${e.index ?? blockIndex}`,
                text: e.delta.text,
                group: messageId,
              });
          }
          if (msg.type === "assistant") {
            messageId = msg.message.id;
            for (const [index, block] of (
              msg.message.content || []
            ).entries()) {
              if (block.type === "text")
                emit({
                  type: "message",
                  id: `${messageId}:${index}`,
                  text: block.text,
                  group: messageId,
                });
              if (block.type === "tool_use")
                emit({
                  type: "activity",
                  id: block.id,
                  title: block.name,
                  text: JSON.stringify(block.input, null, 2),
                  status: "running",
                });
            }
          }
          if (msg.type === "user")
            for (const block of msg.message?.content || [])
              if (block.type === "tool_result")
                emit({
                  type: "activity",
                  id: block.tool_use_id,
                  text:
                    typeof block.content === "string"
                      ? block.content
                      : JSON.stringify(block.content),
                  status: block.is_error ? "failed" : "completed",
                });
          if (msg.type === "result") {
            if (msg.permission_denials?.length)
              emit({
                type: "activity",
                id: "permissions",
                title: "Tool permission needed",
                text:
                  "Claude Code denied tools that require approval. Configure permissions in Claude Code or continue this task in Terminal.\n" +
                  msg.permission_denials.map((d) => d.tool_name).join(", "),
                status: "denied",
              });
            if (msg.result) emit({ type: "final", text: msg.result });
            finish(
              msg.is_error ? "failed" : "completed",
              msg.is_error
                ? (msg.errors || [msg.result || msg.subtype]).join("\n")
                : "",
            );
          }
        },
        (e) => finish("failed", `Invalid Claude Code protocol: ${e.message}`),
      );
      child.stdin.end(prompt);
    }
  };
  return result;
}
