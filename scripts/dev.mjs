import { context } from "esbuild";
import { options } from "./build.mjs";
import { readFile, mkdir, open, readdir } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
if (process.argv.includes("--verify")) {
  try {
    const result = await promisify(execFile)(
      process.execPath,
      [
        "--test",
        ...(await readdir("tests"))
          .filter((name) => name.endsWith(".test.mjs"))
          .map((name) => "tests/" + name),
      ],
      { cwd: process.cwd(), maxBuffer: 4 * 1024 * 1024 },
    );
    console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);
  } catch (error) {
    console.error(error.stdout || error.message);
    console.error(error.stderr || "");
    process.exit(1);
  }
  process.exit(0);
}
import path from "node:path";
const dataDir = path.resolve(process.env.SOULL_DATA_DIR || ".soull");
await mkdir(dataDir, { recursive: true, mode: 0o700 });
let running = false;
if (process.argv.includes("--restart-service")) {
  try {
    const runtime = JSON.parse(
      await readFile(path.join(dataDir, "runtime.json"), "utf8"),
    );
    const response = await fetch(runtime.url + "/api/state", {
      headers: { Authorization: "Bearer " + runtime.token },
      signal: AbortSignal.timeout(1000),
    });
    if (response.ok) {
      const state = await response.json();
      if (
        state.activeChats ||
        state.sessions.some((s) => s.state === "running")
      )
        throw new Error(
          "Stop running sessions and conversation turns before restarting the service.",
        );
      process.kill(runtime.pid, "SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch (error) {
    if (
      error.message ===
      "Stop running sessions and conversation turns before restarting the service."
    )
      throw error;
  }
}
try {
  const runtime = JSON.parse(
    await readFile(path.join(dataDir, "runtime.json"), "utf8"),
  );
  const response = await fetch(runtime.url + "/api/state", {
    headers: { Authorization: "Bearer " + runtime.token },
    signal: AbortSignal.timeout(1000),
  });
  running = response.ok;
} catch {}
if (!running) {
  const log = await open(path.join(dataDir, "service.log"), "a", 0o600);
  const child = spawn(process.execPath, ["service/server.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, SOULL_DATA_DIR: dataDir },
    detached: true,
    stdio: ["ignore", log.fd, log.fd],
  });
  child.unref();
  await log.close();
  console.log(
    "Started independent local service. Logs: " +
      path.join(dataDir, "service.log"),
  );
}
const ctx = await context(options);
await ctx.watch();
console.log(
  "Soull UI watch is running. Reload to see changes; agents stay connected.",
);
console.log(
  "Open: node bin/soull.mjs open, or npm run native after npm run native:build.",
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await ctx.dispose();
    process.exit(0);
  });
