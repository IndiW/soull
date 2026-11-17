import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  chmod,
  readFile,
  rm,
  symlink,
  unlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer } from "../service/server.mjs";
import { git, fileDiff } from "../service/workspace.mjs";
import { reviewSnapshot, validateExplanation } from "../service/reviews.mjs";
const describe = {
  what: "Changes the greeting.",
  why: "Inferred: makes the greeting clearer.",
  risks: "Review downstream callers. Tests were not run by this request.",
};
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "soull-review-")),
    repo = path.join(root, "repo");
  await mkdir(repo);
  await git(repo, ["init"]);
  await git(repo, ["config", "user.name", "Test"]);
  await git(repo, ["config", "user.email", "test@example.invalid"]);
  await writeFile(
    path.join(repo, "hello.ts"),
    'export const greeting = "hello";\n',
  );
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "Initial"]);
  const base = (await git(repo, ["rev-parse", "HEAD"])).trim();
  return { root, repo, base };
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
test("review snapshots fingerprint tracked, untracked, binary, deletion, HEAD and symlink changes", async () => {
  const { root, repo, base } = await fixture(),
    feature = { workspace: repo, base };
  try {
    await writeFile(
      path.join(repo, "hello.ts"),
      'export const greeting = "hi";\n',
    );
    const initial = await reviewSnapshot(feature);
    assert.equal(initial.files.length, 1);
    assert.equal(initial.revision, (await reviewSnapshot(feature)).revision);
    await writeFile(path.join(repo, "new.ts"), "first");
    const untracked = await reviewSnapshot(feature);
    assert.notEqual(initial.revision, untracked.revision);
    assert.equal(untracked.untracked[0].content, "first");
    await writeFile(path.join(repo, "new.ts"), "other");
    assert.notEqual(
      untracked.revision,
      (await reviewSnapshot(feature)).revision,
    );
    await writeFile(path.join(repo, "binary.bin"), Buffer.from([0, 1, 2]));
    const binary = await reviewSnapshot(feature);
    assert.equal(
      binary.untracked.find((f) => f.path === "binary.bin").content,
      "[Binary content omitted]",
    );
    await writeFile(path.join(repo, "binary.bin"), Buffer.from([0, 2, 1]));
    assert.notEqual(binary.revision, (await reviewSnapshot(feature)).revision);
    await symlink(path.join(root, "outside-secret"), path.join(repo, "link"));
    const linked = await reviewSnapshot(feature);
    assert.equal(linked.files.find((f) => f.path === "link").kind, "symlink");
    await unlink(path.join(repo, "link"));
    await symlink(path.join(root, "other-target"), path.join(repo, "link"));
    assert.notEqual(linked.revision, (await reviewSnapshot(feature)).revision);
    await unlink(path.join(repo, "hello.ts"));
    assert.equal(
      (await reviewSnapshot(feature)).files.find((f) => f.path === "hello.ts")
        .kind,
      "deleted",
    );
    await unlink(path.join(repo, "link"));
    await writeFile(
      path.join(root, "outside-secret"),
      "not part of the snapshot",
    );
    await symlink(path.join(root, "outside-secret"), path.join(repo, "link"));
    const linkSnapshot = await reviewSnapshot(feature);
    assert.equal(
      linkSnapshot.files.find((f) => f.path === "link").kind,
      "symlink",
    );
    assert.equal(
      JSON.stringify(linkSnapshot).includes("not part of the snapshot"),
      false,
    );
    const linkDiff = await fileDiff(feature, "link");
    assert.equal(linkDiff.readable, false);
    assert.match(linkDiff.diff, /Symbolic link target:/);
    assert.ok(!linkDiff.diff.includes("not part of the snapshot"));
    const binaryDiff = await fileDiff(feature, "binary.bin");
    assert.equal(binaryDiff.readable, false);
    assert.match(binaryDiff.diff, /Binary contents not shown/);
    await unlink(path.join(repo, "link"));
    await symlink("hello.ts", path.join(repo, "link"));
    assert.notEqual(
      linkSnapshot.revision,
      (await reviewSnapshot(feature)).revision,
    );
    const beforeMode = await reviewSnapshot(feature);
    await chmod(path.join(repo, "new.ts"), 0o755);
    assert.notEqual(
      beforeMode.revision,
      (await reviewSnapshot(feature)).revision,
    );
    const beforeCommit = await reviewSnapshot(feature);
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-m", "Change"]);
    assert.notEqual(
      beforeCommit.revision,
      (await reviewSnapshot(feature)).revision,
    );
    await writeFile(path.join(repo, "huge.txt"), "x".repeat(190000));
    await assert.rejects(reviewSnapshot(feature), /too large/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("explanations validate every path, bind captured revision, preserve last success and recover after restart", async () => {
  const { root, repo, base } = await fixture(),
    executions = [];
  const makeReviewRun = (options) => {
    const run = {
      ...options,
      start(prompt) {
        this.prompt = prompt;
      },
      stop() {
        options.emit({ type: "done", status: "interrupted" });
      },
    };
    executions.push(run);
    return run;
  };
  let app = await startServer({
    dataDir: path.join(root, "data"),
    port: 0,
    makeReviewRun,
  });
  const m = app.store.addManager("Mika", repo, "codex"),
    f = app.store.addFeature({
      id: "review-feature",
      managerId: m.id,
      title: "Greeting",
      branch: "feature",
      workspace: repo,
      base,
      created: new Date().toISOString(),
    });
  const call = async (method = "GET", suffix = "") => {
    const response = await fetch(
      app.url + "/api/features/" + f.id + "/review" + suffix,
      { method, headers: { Authorization: "Bearer " + app.token } },
    );
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await call("POST")).status, 400);
    await writeFile(
      path.join(repo, "hello.ts"),
      'export const greeting = "hi";\n',
    );
    const snapshot = await reviewSnapshot(f),
      valid = JSON.stringify({
        summary: describe,
        files: [{ path: "hello.ts", ...describe }],
      });
    assert.throws(
      () =>
        validateExplanation(
          JSON.stringify({
            summary: describe,
            files: [{ path: "../secret", ...describe }],
          }),
          snapshot,
        ),
      /unknown/,
    );
    assert.throws(
      () => validateExplanation("{oops", snapshot),
      /valid explanation JSON/,
    );
    assert.throws(
      () =>
        validateExplanation(
          JSON.stringify({ summary: describe, files: [] }),
          snapshot,
        ),
      /every captured file/,
    );
    assert.equal((await call("POST")).status, 202);
    assert.equal((await call("POST")).status, 409);
    assert.equal(executions[0].readOnly, true);
    assert.equal(executions[0].sessionId, null);
    assert.match(executions[0].prompt, /export const greeting/);
    // Mutate while the provider is thinking. Its result stays pinned to the old snapshot.
    await writeFile(
      path.join(repo, "hello.ts"),
      'export const greeting = "newer";\n',
    );
    executions[0].emit({
      type: "message",
      id: "answer",
      phase: "final_answer",
      text: valid,
    });
    executions[0].emit({ type: "done", status: "completed" });
    const stale = (await call()).body;
    assert.equal(stale.explanation.revision, snapshot.revision);
    assert.equal(stale.stale, true);
    assert.equal(stale.explanation.result.files[0].what, describe.what);
    assert.equal("snapshot" in stale.explanation, false);
    await call("POST");
    executions[1].emit({ type: "final", text: "not JSON" });
    executions[1].emit({ type: "done", status: "completed" });
    const failed = (await call()).body;
    assert.equal(failed.job.status, "failed");
    assert.equal(failed.explanation.id, stale.explanation.id);
    await call("POST");
    await call("POST", "/cancel");
    assert.equal((await call()).body.job.status, "interrupted");
    await call("POST");
    const fourth = app.reviews.latest(f.id).id;
    await app.close();
    app = await startServer({
      dataDir: path.join(root, "data"),
      port: 0,
      makeReviewRun,
    });
    assert.equal((await call()).body.job.status, "interrupted");
    assert.equal(app.reviews.latest(f.id).id, fourth);
    assert.equal((await call()).body.explanation.id, stale.explanation.id);
    await call("POST");
    executions.at(-1).emit({ type: "final", text: "x".repeat(100001) });
    assert.equal((await call()).body.job.status, "failed");
    assert.match((await call()).body.job.error, /response limit/);
    assert.equal((await call()).body.explanation.id, stale.explanation.id);
    // No transcript or provider session is inserted into the manager's conversation.
    assert.equal(app.conversations.chat.page(f.id).turns.length, 0);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
