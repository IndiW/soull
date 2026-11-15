import http from "node:http";
import { mkdir, writeFile, readFile, realpath } from "node:fs/promises";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openStore } from "./store.mjs";
import {
  git,
  repoRoot,
  changes,
  fileDiff,
  readText,
  saveText,
} from "./workspace.mjs";
import { Sessions } from "./sessions.mjs";
const project = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
export function text(value, label, max = 200) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    value.includes("\0")
  )
    throw fail(`Invalid ${label}`);
  return value.trim();
}
async function body(req) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data) > 2 * 1024 * 1024)
      throw fail("Request too large", 413);
  }
  try {
    return data ? JSON.parse(data) : {};
  } catch {
    throw fail("Invalid JSON");
  }
}
export async function startServer({
  dataDir = process.env.SOULL_DATA_DIR || path.join(project, ".soull"),
  port = Number(process.env.SOULL_PORT || 4317),
} = {}) {
  dataDir = path.resolve(dataDir);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const store = openStore(path.join(dataDir, "soull.sqlite")),
    token = randomBytes(32).toString("hex"),
    runtimeFile = path.join(dataDir, "runtime.json"),
    sessions = new Sessions(runtimeFile);
  const operations = new Set();
  let actualPort;
  const send = (res, status, data) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(data));
  };
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.host !== `127.0.0.1:${actualPort}`)
        throw fail("Invalid host", 403);
      const origin = `http://127.0.0.1:${actualPort}`;
      if (req.headers.origin && req.headers.origin !== origin)
        throw fail("Invalid origin", 403);
      const url = new URL(req.url, origin),
        parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] === "api") {
        const auth = req.headers.authorization || "",
          expected = `Bearer ${token}`;
        if (
          auth.length !== expected.length ||
          !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))
        )
          throw fail("Unauthorized", 401);
        const method = req.method;
        if (method === "GET" && url.pathname === "/api/state")
          return send(res, 200, {
            ...store.snapshot(),
            sessions: sessions.list(),
            capabilities: {
              usage: false,
              github: false,
              guidedExplanations: false,
              terminal: "xterm",
            },
          });
        if (method === "POST" && url.pathname === "/api/managers") {
          const b = await body(req),
            name = text(b.name, "manager name", 60),
            repo = await repoRoot(text(b.repo, "repository path", 4096)),
            provider = b.provider || "codex";
          if (!["codex", "claude"].includes(provider))
            throw fail("Choose Codex or Claude Code");
          return send(res, 201, store.addManager(name, repo, provider));
        }
        if (method === "POST" && url.pathname === "/api/features") {
          const b = await body(req),
            manager = store.manager(text(b.managerId, "manager ID")),
            title = text(b.title, "feature title");
          const id = randomUUID(),
            branch = `soull/${
              title
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "")
                .slice(0, 40) || "feature"
            }-${id.slice(0, 8)}`,
            workspace = path.join(dataDir, "worktrees", id),
            base = (await git(manager.repo, ["rev-parse", "HEAD"])).trim();
          await mkdir(path.dirname(workspace), { recursive: true });
          await git(manager.repo, [
            "worktree",
            "add",
            "-b",
            branch,
            workspace,
            base,
          ]);
          const feature = {
            id,
            managerId: manager.id,
            title,
            branch,
            workspace,
            base,
            created: new Date().toISOString(),
          };
          try {
            store.addFeature(feature);
          } catch (error) {
            error.message += "; worktree remains at " + workspace;
            throw error;
          }
          return send(res, 201, feature);
        }
        if (method === "POST" && url.pathname === "/api/findings") {
          const b = await body(req);
          if (
            !["finding", "answer", "question", "follow-up"].includes(
              b.kind || "finding",
            )
          )
            throw fail("Unknown finding kind");
          return send(
            res,
            201,
            store.addFinding(
              text(b.featureId, "feature ID"),
              text(b.title, "title"),
              text(b.body, "body", 100000),
              b.kind || "finding",
            ),
          );
        }
        if (
          method === "PATCH" &&
          parts[1] === "findings" &&
          parts.length === 3
        ) {
          store.updateFinding(parts[2], await body(req));
          return send(res, 200, { ok: true });
        }
        if (parts[1] === "features" && parts.length === 4) {
          const feature = store.feature(parts[2]),
            action = parts[3];
          if (method === "GET" && action === "changes")
            return send(res, 200, await changes(feature));
          if (method === "GET" && action === "diff")
            return send(
              res,
              200,
              await fileDiff(
                feature,
                text(url.searchParams.get("path"), "file path", 4096),
              ),
            );
          if (method === "GET" && action === "files")
            return send(res, 200, {
              files: [
                ...new Set(
                  (
                    await git(feature.workspace, [
                      "ls-files",
                      "--cached",
                      "--others",
                      "--exclude-standard",
                      "-z",
                    ])
                  )
                    .split("\0")
                    .filter(Boolean),
                ),
              ].sort(),
            });
          if (method === "GET" && action === "file")
            return send(
              res,
              200,
              await readText(
                feature.workspace,
                text(url.searchParams.get("path"), "file path", 4096),
              ),
            );
          if (method === "PUT" && action === "file") {
            const b = await body(req);
            if (typeof b.content !== "string")
              throw fail("Expected file content");
            const file = text(b.path, "file path", 4096),
              key = feature.id + ":" + file;
            if (operations.has(key))
              throw fail("A save is already in progress", 409);
            operations.add(key);
            try {
              return send(
                res,
                200,
                await saveText(
                  feature.workspace,
                  file,
                  b.content,
                  text(b.version, "file version"),
                ),
              );
            } finally {
              operations.delete(key);
            }
          }
        }
        if (method === "POST" && url.pathname === "/api/sessions") {
          const b = await body(req);
          return send(
            res,
            201,
            sessions.start(
              store.feature(text(b.featureId, "feature ID")),
              b.provider,
            ),
          );
        }
        if (parts[1] === "sessions" && parts.length === 4) {
          const id = parts[2],
            action = parts[3];
          if (method === "GET" && action === "output") {
            const offset = Number(url.searchParams.get("offset") || 0);
            if (!Number.isSafeInteger(offset) || offset < 0)
              throw fail("Invalid offset");
            return send(res, 200, sessions.output(id, offset));
          }
          if (method === "POST" && action === "input") {
            const b = await body(req);
            if (typeof b.input !== "string" || b.input.length > 100000)
              throw fail("Invalid input");
            sessions.input(id, b.input);
            return send(res, 200, { ok: true });
          }
          if (method === "POST" && action === "resize") {
            const b = await body(req);
            if (!Number.isInteger(b.cols) || !Number.isInteger(b.rows))
              throw fail("Invalid terminal size");
            sessions.resize(id, b.cols, b.rows);
            return send(res, 200, { ok: true });
          }
          if (method === "POST" && action === "stop") {
            sessions.stop(id);
            return send(res, 200, { ok: true });
          }
        }
        throw fail("Not found", 404);
      }
      if (req.method !== "GET") throw fail("Not found", 404);
      const resource =
        url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (!["index.html", "app.js", "app.css", "app.js.map"].includes(resource))
        throw fail("Not found", 404);
      let content;
      try {
        content = await readFile(path.join(project, "dist", resource));
      } catch {
        throw fail("UI not built. Run npm run build, then reload.", 503);
      }
      res.writeHead(200, {
        "Content-Type": resource.endsWith(".html")
          ? "text/html"
          : resource.endsWith(".css")
            ? "text/css"
            : "text/javascript",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      });
      res.end(content);
    } catch (error) {
      send(res, error.status || 500, {
        error: error.message || "Unexpected error",
      });
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        actualPort = server.address().port;
        resolve();
      });
    });
  } catch (error) {
    store.close();
    throw error;
  }
  const url = `http://127.0.0.1:${actualPort}`;
  await writeFile(
    runtimeFile,
    JSON.stringify({ url, token, pid: process.pid }, null, 2),
    { mode: 0o600 },
  );
  return {
    server,
    store,
    sessions,
    url,
    token,
    runtimeFile,
    async close() {
      sessions.close();
      await new Promise((resolve) => server.close(resolve));
      store.close();
    },
  };
}
if (
  process.argv[1] &&
  (await realpath(process.argv[1]).catch(() => null)) ===
    fileURLToPath(import.meta.url)
) {
  const app = await startServer();
  console.log(
    `Soull service: ${app.url}\nRuntime: ${app.runtimeFile}\nOpen with: npm run native (or node bin/soull.mjs open)`,
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      await app.close();
      process.exit(0);
    });
}
