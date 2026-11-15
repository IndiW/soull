import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const exec = promisify(execFile);
export const hash = (text) => createHash("sha256").update(text).digest("hex");
export async function git(repo, args) {
  const { stdout } = await exec("git", ["-C", repo, ...args], {
    maxBuffer: 8 * 1024 * 1024,
    timeout: 20000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout;
}
export async function repoRoot(input) {
  const root = (
    await git(await realpath(input), ["rev-parse", "--show-toplevel"])
  ).trim();
  await git(root, ["rev-parse", "HEAD"]);
  return root;
}
export async function safeFile(workspace, relative) {
  if (!relative || path.isAbsolute(relative) || relative.includes("\0"))
    throw Object.assign(new Error("Expected a workspace-relative file path"), {
      status: 400,
    });
  const root = await realpath(workspace),
    lexical = path.relative(root, path.resolve(root, relative));
  if (
    lexical === ".." ||
    lexical.startsWith(`..${path.sep}`) ||
    path.isAbsolute(lexical)
  )
    throw Object.assign(new Error("File is outside the workspace"), {
      status: 403,
    });
  const target = await realpath(path.resolve(root, relative));
  const local = path.relative(root, target);
  if (
    local === ".." ||
    local.startsWith(`..${path.sep}`) ||
    path.isAbsolute(local) ||
    local.split(path.sep).includes(".git")
  )
    throw Object.assign(new Error("File is outside the workspace"), {
      status: 403,
    });
  const info = await stat(target);
  if (!info.isFile() || info.size > 1024 * 1024)
    throw Object.assign(new Error("Only text files up to 1 MB can be opened"), {
      status: 400,
    });
  return target;
}
export async function readText(workspace, relative) {
  const file = await safeFile(workspace, relative),
    bytes = await readFile(file);
  if (bytes.includes(0))
    throw Object.assign(new Error("Binary files cannot be edited"), {
      status: 400,
    });
  const content = bytes.toString("utf8");
  return { path: relative, content, version: hash(bytes) };
}
export async function saveText(workspace, relative, content, version) {
  if (Buffer.byteLength(content) > 1024 * 1024)
    throw Object.assign(new Error("File exceeds 1 MB"), { status: 400 });
  const file = await safeFile(workspace, relative),
    before = await readFile(file);
  if (hash(before) !== version)
    throw Object.assign(
      new Error("This file changed on disk. Reopen it before saving."),
      { status: 409 },
    );
  // Recheck after asynchronous path resolution; no force-save path is exposed.
  const current = await readFile(file);
  if (hash(current) !== version)
    throw Object.assign(
      new Error("Concurrent edit detected. Reopen the file."),
      { status: 409 },
    );
  await writeFile(file, content);
  return { path: relative, content, version: hash(content) };
}
export function category(file) {
  if (/(^|\/)(evals?|evaluations?)(\/|\.)/i.test(file)) return "Evals";
  if (/(test|spec)\.[^.]+$|(^|\/)(__tests__|tests)(\/|$)/i.test(file))
    return "Tests";
  if (
    /(^|\/)(\.github|infra|terraform|deploy|docker)(\/|\.)|Dockerfile|\.ya?ml$/.test(
      file,
    )
  )
    return "Infrastructure";
  if (/\.(md|txt)$/.test(file)) return "Docs";
  if (/schema|contract|types\./i.test(file)) return "Contracts";
  if (/\.(tsx|jsx|css|swift)$|(^|\/)ui\//.test(file)) return "UI";
  return "Backend";
}
export async function changes(feature) {
  const tracked = (
    await git(feature.workspace, [
      "diff",
      "--name-only",
      "-z",
      "--no-renames",
      feature.base,
      "--",
    ])
  )
    .split("\0")
    .filter(Boolean);
  const untracked = (
    await git(feature.workspace, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
    ])
  )
    .split("\0")
    .filter(Boolean);
  const files = [...new Set([...tracked, ...untracked])];
  const head = (
    await git(feature.workspace, ["rev-parse", "--short", "HEAD"])
  ).trim();
  return {
    head,
    base: feature.base,
    files: files.map((file) => ({
      path: file,
      category: category(file),
      untracked: untracked.includes(file),
    })),
    diff: await git(feature.workspace, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--no-renames",
      feature.base,
      "--",
    ]),
  };
}
export async function fileDiff(feature, relative) {
  // Deletions are valid diff targets, but arbitrary files/paths are not.
  const all = await changes(feature);
  if (!all.files.some((f) => f.path === relative))
    throw Object.assign(new Error("File is not part of this change"), {
      status: 404,
    });
  if (all.files.find((f) => f.path === relative)?.untracked) {
    const file = await readText(feature.workspace, relative);
    return {
      diff:
        `New file: ${relative}\n` +
        file.content
          .split("\n")
          .map((l) => "+" + l)
          .join("\n"),
    };
  }
  return {
    diff: await git(feature.workspace, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--no-renames",
      feature.base,
      "--",
      relative,
    ]),
  };
}
