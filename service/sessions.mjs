import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";
const project = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export class Sessions {
  items = new Map();
  constructor(runtimeFile) {
    this.runtimeFile = runtimeFile;
  }
  list() {
    return [...this.items.values()].map(
      ({ id, featureId, provider, state, exit, created }) => ({
        id,
        featureId,
        provider,
        state,
        exit,
        created,
      }),
    );
  }
  get(id) {
    const item = this.items.get(id);
    if (!item)
      throw Object.assign(new Error("Session not found"), { status: 404 });
    return item;
  }
  start(feature, provider) {
    if (!["codex", "claude", "shell"].includes(provider))
      throw Object.assign(new Error("Unknown provider"), { status: 400 });
    const existing = [...this.items.values()].find(
      (s) =>
        s.featureId === feature.id &&
        s.provider === provider &&
        s.state === "running",
    );
    if (existing) return this.list().find((s) => s.id === existing.id);
    const executable =
      provider === "shell" ? process.env.SHELL || "/bin/zsh" : provider;
    const child = spawn(
      "python3",
      [
        path.join(project, "service/pty_bridge.py"),
        feature.workspace,
        executable,
      ],
      {
        env: {
          ...process.env,
          PATH: path.join(project, "bin") + path.delimiter + process.env.PATH,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          SOULL_RUNTIME_FILE: this.runtimeFile,
          SOULL_FEATURE_ID: feature.id,
          SOULL_MANAGER_ID: feature.managerId,
          SOULL_WORKSPACE: feature.workspace,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const item = {
      id: randomUUID(),
      featureId: feature.id,
      provider,
      state: "running",
      created: new Date().toISOString(),
      chunks: [],
      offset: 0,
      first: 0,
      bytes: 0,
      child,
    };
    this.items.set(item.id, item);
    const push = (data) => {
      const bytes = Buffer.from(data, "base64").length;
      item.chunks.push({ offset: item.offset++, data });
      item.bytes += bytes;
      while (item.bytes > 4 * 1024 * 1024 && item.chunks.length) {
        const old = item.chunks.shift();
        item.bytes -= Buffer.from(old.data, "base64").length;
        item.first = old.offset + 1;
      }
    };
    createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.data) push(msg.data);
        if ("exit" in msg) {
          item.state = "exited";
          item.exit = msg.exit;
        }
      } catch {}
    });
    child.stderr.on("data", (data) => push(data.toString("base64")));
    child.on("error", (error) => {
      item.state = "exited";
      item.exit = 1;
      push(Buffer.from(error.message).toString("base64"));
    });
    child.on("exit", (code) => {
      item.state = "exited";
      item.exit ??= code;
    });
    return this.list().find((s) => s.id === item.id);
  }
  output(id, offset) {
    const item = this.get(id);
    return {
      chunks: item.chunks.filter((c) => c.offset >= offset),
      offset: item.offset,
      truncated: offset < item.first,
      state: item.state,
      exit: item.exit,
    };
  }
  input(id, input) {
    const s = this.get(id);
    if (s.state !== "running")
      throw Object.assign(new Error("Session has ended"), { status: 409 });
    s.child.stdin.write(
      JSON.stringify({ input: Buffer.from(input).toString("base64") }) + "\n",
    );
  }
  resize(id, cols, rows) {
    const s = this.get(id);
    if (s.state === "running")
      s.child.stdin.write(
        JSON.stringify({
          cols: Math.min(500, Math.max(10, cols)),
          rows: Math.min(200, Math.max(2, rows)),
        }) + "\n",
      );
  }
  stop(id) {
    const s = this.get(id);
    s.child.kill("SIGTERM");
  }
  close() {
    for (const s of this.items.values())
      if (s.state === "running") s.child.kill("SIGTERM");
  }
}
