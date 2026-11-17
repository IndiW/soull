import { chromium } from "playwright";
import { startServer } from "../../service/server.mjs";
import { git } from "../../service/workspace.mjs";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const project = fileURLToPath(new URL("../..", import.meta.url));
const screenshots = path.join(project, ".impeccable/review");
const root = await mkdtemp(path.join(os.tmpdir(), "soull-review-ui-")),
  repo = path.join(root, "repo");
await mkdir(repo);
await mkdir(screenshots, { recursive: true });
await git(repo, ["init"]);
await git(repo, ["config", "user.name", "Test"]);
await git(repo, ["config", "user.email", "test@example.invalid"]);
await writeFile(path.join(repo, "service.ts"), "export const pageSize = 10;\n");
await writeFile(
  path.join(repo, "Widget.tsx"),
  'export const label = "Load";\n',
);
await writeFile(path.join(repo, "removed.ts"), "export const old = true;\n");
await git(repo, ["add", "."]);
await git(repo, ["commit", "-m", "Synthetic fixture"]);
const base = (await git(repo, ["rev-parse", "HEAD"])).trim();
await writeFile(path.join(repo, "service.ts"), "export const pageSize = 30;\n");
await writeFile(
  path.join(repo, "Widget.tsx"),
  'export const label = "Load earlier messages";\n',
);
await rm(path.join(repo, "removed.ts"));
await writeFile(path.join(repo, "diagram.bin"), Buffer.from([0, 1, 2]));
await writeFile(
  path.join(root, "outside.txt"),
  "Do not dereference this fixture secret",
);
await symlink(path.join(root, "outside.txt"), path.join(repo, "external-link"));
let failNext = false;
const makeReviewRun = ({ emit }) => {
  let timer;
  return {
    start(prompt) {
      const snapshot = JSON.parse(prompt.split("Captured snapshot:\n")[1]);
      const summary = {
        what: "Synthetic fixture: load conversation history in smaller, explicit pages.",
        why: "The change makes earlier messages easier to find while keeping the initial reading view focused.",
        risks:
          "Check page boundaries and empty history. This is sample AI guidance, not a verified test result.",
      };
      const result = {
        summary,
        files: snapshot.files.map((file) => ({
          path: file.path,
          what: `Synthetic fixture: explains the captured change to ${file.path}.`,
          why: "Inferred: clarify the history-loading interaction.",
          risks:
            "Review callers and edge cases before merging. No test evidence is attached.",
        })),
      };
      timer = setTimeout(() => {
        emit({
          type: "final",
          text: failNext ? "invalid JSON fixture" : JSON.stringify(result),
        });
        emit({ type: "done", status: "completed" });
      }, 120);
    },
    stop() {
      clearTimeout(timer);
      emit({ type: "done", status: "interrupted" });
    },
  };
};
const app = await startServer({
  dataDir: path.join(root, "data"),
  port: 0,
  makeReviewRun,
});
const m = app.store.addManager("Mika", repo, "codex"),
  f = app.store.addFeature({
    id: "review-fixture",
    managerId: m.id,
    title: "Guided diff · synthetic fixture",
    branch: "test/guided-diff",
    workspace: repo,
    base,
    created: new Date().toISOString(),
  });
let browser;
try {
  browser = await chromium.launch({
    executablePath:
      process.env.SOULL_BROWSER_BINARY ||
      (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    ({ manager, feature }) => {
      localStorage.setItem("soull-manager", manager);
      localStorage.setItem("soull-feature", feature);
      localStorage.setItem("soull-tab", "review");
    },
    { manager: m.id, feature: f.id },
  );
  await page.goto(app.url + "/#" + app.token);
  const explanation = page.getByRole("region", {
    name: "AI change explanation",
  });
  await page
    .getByRole("button", { name: "Explain changes", exact: true })
    .click();
  await page
    .getByText("Matches the last checked worktree", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Change summary", exact: true })
    .click();
  await page
    .getByText(
      "Synthetic fixture: load conversation history in smaller, explicit pages.",
      { exact: true },
    )
    .waitFor();
  await page.screenshot({
    path: path.join(screenshots, "guided-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: /Widget.tsx/ }).click();
  await page.getByRole("button", { name: "This file", exact: true }).click();
  await page
    .getByText(
      "Synthetic fixture: explains the captured change to Widget.tsx.",
      { exact: true },
    )
    .waitFor();
  await page.getByRole("button", { name: /removed.ts/ }).click();
  await page
    .getByRole("region", { name: "File diff" })
    .getByText("deleted file mode 100644", { exact: false })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Edit file", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: /diagram.bin/ }).click();
  await page
    .getByRole("region", { name: "File diff" })
    .getByText("Binary contents not shown", { exact: false })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Edit file", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: /external-link/ }).click();
  await page
    .getByRole("region", { name: "File diff" })
    .getByText("Symbolic link target:", { exact: false })
    .waitFor();
  assert.equal(
    await page
      .getByRole("region", { name: "File diff" })
      .getByText("Do not dereference this fixture secret")
      .count(),
    0,
  );
  await page.getByRole("button", { name: /service.ts/ }).click();
  await page.getByRole("button", { name: "Edit file", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Edit service.ts" });
  await editor.fill("export const pageSize = 40;\n");
  await page
    .getByText("Save your edits before generating.", { exact: false })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Regenerate explanation", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("button", { name: "Show diff", exact: true }).click();
  await page
    .getByText("Stale · changes need a new explanation", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Regenerate explanation", exact: true })
    .click();
  await page
    .getByText("Matches the last checked worktree", { exact: true })
    .waitFor();
  await page.reload();
  await page
    .getByText("Matches the last checked worktree", { exact: true })
    .waitFor();
  // Failed regeneration must retain the previous complete explanation.
  failNext = true;
  await page
    .getByRole("button", { name: "Regenerate explanation", exact: true })
    .click();
  await page
    .getByText("The provider did not return valid explanation JSON.", {
      exact: false,
    })
    .waitFor();
  assert.ok(await page.locator(".explanation-prose").textContent());
  await page.evaluate(
    ({ id }) =>
      localStorage.setItem(
        "soull-chat-" + id + "-draft",
        "Keep my existing draft.",
      ),
    { id: f.id },
  );
  await page
    .getByRole("button", { name: "Discuss with manager", exact: true })
    .click();
  const draft = await page
    .getByRole("textbox", { name: "Message Mika" })
    .inputValue();
  assert.ok(draft.startsWith("Keep my existing draft."));
  assert.match(draft, /describes diff [a-f0-9]{64}/);
  await page.getByRole("button", { name: /Guided diff/, exact: false }).click();
  await page.getByRole("button", { name: "This file", exact: true }).waitFor();
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({
    path: path.join(screenshots, "guided-compact.png"),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  const diffBox = await page
    .getByRole("region", { name: "File diff" })
    .boundingBox();
  assert.ok(
    diffBox.height >= 100 && diffBox.y + diffBox.height <= 768,
    "working diff remains visible",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Guided diff browser passed: generation, per-file guidance, deleted files, unsaved edit guard, saved-change staleness, regeneration, reload, failed-output recovery, preserved chat draft, revision context and compact layout.",
  );
} finally {
  await browser?.close();
  await app.close();
  await rm(root, { recursive: true, force: true });
}
