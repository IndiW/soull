import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import { EventEmitter } from "node:events";
import { providerRun, jsonLines } from "../service/providers.mjs";

function harness(provider, sessionId, extra = {}) {
  const events = [],
    sent = [];
  let child, args;
  const spawnProcess = (command, argv, options) => {
    args = { command, argv, options };
    child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    child.stdin = new Writable({
      write(chunk, encoding, done) {
        const raw = chunk.toString();
        if (provider === "codex") {
          const msg = JSON.parse(raw);
          sent.push(msg);
          if (msg.method && msg.id)
            queueMicrotask(() =>
              output({
                id: msg.id,
                result: msg.method.startsWith("thread/")
                  ? { thread: { id: sessionId || "new-thread" } }
                  : {},
              }),
            );
        } else sent.push(raw);
        done();
      },
    });
    return child;
  };
  const output = (msg) => child.stdout.write(JSON.stringify(msg) + "\n");
  const run = providerRun({
    provider,
    sessionId,
    manager: { name: "Mika" },
    feature: { workspace: "/tmp" },
    env: { PATH: "/bin" },
    emit: (e) => events.push(e),
    spawnProcess,
    ...extra,
  });
  return {
    run,
    events,
    sent,
    output,
    get args() {
      return args;
    },
    get child() {
      return child;
    },
  };
}
test("Codex adapter handshakes, resumes, reconciles text and round-trips approvals", async () => {
  const h = harness("codex", "existing-thread");
  await h.run.start("hello");
  assert.deepEqual(
    h.sent.filter((m) => m.method).map((m) => m.method),
    ["initialize", "initialized", "thread/resume", "turn/start"],
  );
  assert.equal(h.args.command, "codex");
  assert.equal(h.args.options.cwd, "/tmp");
  assert.equal(
    h.sent.find((m) => m.method === "thread/resume").params.approvalPolicy,
    "on-request",
  );
  h.output({
    method: "item/agentMessage/delta",
    params: { itemId: "m", delta: "Hello" },
  });
  h.output({
    method: "item/completed",
    params: {
      item: {
        id: "m",
        type: "agentMessage",
        text: "Hello!",
        phase: "final_answer",
      },
    },
  });
  h.output({
    id: 77,
    method: "item/fileChange/requestApproval",
    params: { threadId: "existing-thread", turnId: "t", itemId: "file" },
  });
  assert.equal(h.events.at(-1).type, "approval");
  h.run.respond(77, "decline");
  assert.deepEqual(h.sent.at(-1), { id: 77, result: { decision: "decline" } });
  h.output({ id: 78, method: "unsupported/request", params: {} });
  assert.equal(h.sent.at(-1).error.code, -32601);
  h.output({
    method: "turn/completed",
    params: { turn: { status: "completed" } },
  });
  assert.equal(h.events.at(-1).status, "completed");
  h.child.emit("close", 0);
  assert.equal(h.events.filter((e) => e.type === "done").length, 1);
});
test("Claude adapter streams Unicode, resumes exact session, keeps subagent text out, reports permission denials", async () => {
  const h = harness("claude", "claude-session");
  await h.run.start("Prompt with $(literal shell syntax)");
  assert.ok(h.args.argv.includes("--resume"));
  assert.equal(h.args.argv.at(-1), "claude-session");
  assert.ok(!h.args.argv.includes("--dangerously-skip-permissions"));
  assert.equal(h.sent[0], "Prompt with $(literal shell syntax)");
  h.output({ type: "system", session_id: "claude-session" });
  h.output({
    type: "stream_event",
    event: { type: "message_start", message: { id: "a" } },
  });
  h.output({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "你好" },
    },
  });
  h.output({
    type: "assistant",
    parent_tool_use_id: "developer",
    message: {
      id: "hidden",
      content: [{ type: "text", text: "Developer response" }],
    },
  });
  assert.ok(!h.events.some((e) => e.text === "Developer response"));
  h.output({
    type: "assistant",
    message: {
      id: "a",
      content: [
        { type: "text", text: "你好!" },
        { type: "text", text: "A second answer section." },
      ],
    },
  });
  assert.equal(h.events.at(-1).id, "a:1");
  assert.equal(h.events.at(-1).group, "a");
  assert.equal(h.events.at(-2).group, "a");
  h.output({
    type: "result",
    session_id: "claude-session",
    is_error: false,
    result: "你好!",
    permission_denials: [{ tool_name: "Bash" }],
  });
  assert.equal(h.events.at(-1).status, "completed");
  assert.match(h.events.find((e) => e.id === "permissions").text, /Bash/);
  h.child.emit("close", 0);
});
test("provider errors, partial frames and split UTF-8 are handled without terminal scraping", async () => {
  const stream = new PassThrough(),
    values = [],
    errors = [];
  jsonLines(
    stream,
    (m) => values.push(m),
    (e) => errors.push(e),
  );
  const bytes = Buffer.from('{"text":"🌿"}\n');
  const pos = bytes.indexOf(Buffer.from("🌿"));
  stream.write(bytes.subarray(0, pos + 2));
  stream.write(bytes.subarray(pos + 2));
  assert.deepEqual(values, [{ text: "🌿" }]);
  stream.write("not json\n");
  assert.equal(errors.length, 1);
  const h = harness("claude");
  await h.run.start("hello");
  h.child.emit(
    "error",
    Object.assign(new Error("missing"), { code: "ENOENT" }),
  );
  assert.match(h.events.at(-1).error, /Install claude/);
});

test("Stop kills a tool descendant even when its provider parent exits first", async () => {
  const { spawn } = await import("node:child_process");
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");
  const { promisify } = await import("node:util");
  const { execFile } = await import("node:child_process");
  const root = await mkdtemp(path.join(os.tmpdir(), "soull-process-"));
  const pidFile = path.join(root, "pid");
  let providerChild, toolPid;
  const descendant = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`;
  const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});setInterval(()=>{},1000);`;
  const run = providerRun({
    provider: "claude",
    feature: { workspace: root },
    manager: { name: "Test" },
    env: process.env,
    emit() {},
    spawnProcess(command, args, options) {
      providerChild = spawn(process.execPath, ["-e", parent], options);
      return providerChild;
    },
  });
  try {
    await run.start("Synthetic process test");
    for (let i = 0; i < 50; i++) {
      try {
        toolPid = Number(await readFile(pidFile, "utf8"));
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    assert.ok(
      toolPid,
      "descendant must install its signal handler before Stop",
    );
    run.stop();
    await new Promise((r) => providerChild.once("close", r));
    await new Promise((r) => setTimeout(r, 2300));
    let stat = "";
    try {
      stat = (
        await promisify(execFile)("ps", ["-o", "stat=", "-p", String(toolPid)])
      ).stdout.trim();
    } catch {}
    assert.ok(
      !stat || stat.startsWith("Z"),
      `descendant remains live: ${stat}`,
    );
  } finally {
    try {
      process.kill(-providerChild.pid, "SIGKILL");
    } catch {}
    await rm(root, { recursive: true, force: true });
  }
});

test("explanation requests use read-only Codex and disable Claude built-in/MCP tools", async () => {
  const codex = harness("codex", null, { readOnly: true });
  await codex.run.start("Explain this captured diff");
  const params = codex.sent.find((m) => m.method === "thread/start").params;
  assert.equal(params.sandbox, "read-only");
  assert.equal(params.approvalPolicy, "never");
  codex.output({
    method: "turn/completed",
    params: { turn: { status: "completed" } },
  });
  codex.child.emit("close", 0);
  const claude = harness("claude", null, { readOnly: true });
  await claude.run.start("Explain this captured diff");
  assert.equal(claude.args.argv[claude.args.argv.indexOf("--tools") + 1], "");
  assert.equal(
    claude.args.argv[claude.args.argv.indexOf("--disallowedTools") + 1],
    "*",
  );
  claude.output({ type: "result", is_error: false, result: "{}" });
  claude.child.emit("close", 0);
});
