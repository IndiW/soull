import { chromium } from "playwright";
import { startServer } from "../../service/server.mjs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
const root = await mkdtemp(path.join(os.tmpdir(), "soull-needs-ui-")),
  project = fileURLToPath(new URL("../..", import.meta.url)),
  shots = path.join(project, ".impeccable/review");
await mkdir(shots, { recursive: true });
const runs = [];
const makeRun = (options) => {
  let timer;
  const run = {
    ...options,
    start(prompt) {
      this.prompt = prompt;
      timer = setTimeout(() => {
        options.emit({
          type: "message",
          id: "reply",
          phase: "final_answer",
          text: options.readOnly
            ? "Synthetic fixture: keeping sessions avoids interrupting users. This discussion is not an answer."
            : "Synthetic fixture: the main conversation remains available while task questions wait.",
        });
        options.emit({ type: "done", status: "completed" });
      }, 100);
    },
    stop() {
      clearTimeout(timer);
      options.emit({ type: "done", status: "interrupted" });
    },
  };
  runs.push(run);
  return run;
};
const app = await startServer({
  dataDir: root,
  port: 0,
  makeChatRun: makeRun,
  makeDiscussionRun: makeRun,
});
const manager = app.store.addManager("Mika", root, "codex"),
  other = app.store.addManager("Nori", root, "claude");
const f = (id, title, managerId = manager.id) =>
  app.store.addFeature({
    id,
    managerId,
    title,
    branch: "fixture/" + id,
    workspace: root,
    base: "fixture",
    created: new Date().toISOString(),
  });
const auth = f("auth", "Needs you · synthetic fixture"),
  search = f("search", "Search redesign"),
  deploy = f("deploy", "Deployment"),
  foreign = f("foreign", "Other manager work", other.id);
const task = (feature, title) => app.questions.createTask(feature.id, title);
const ta = task(auth, "Authentication fix"),
  ts = task(search, "Search investigation"),
  td = task(deploy, "Deployment"),
  tf = task(foreign, "Other manager task");
const qa = app.questions.create({
  taskId: ta.id,
  title: "Keep existing sessions valid?",
  context:
    "Synthetic fixture: the authentication fix changes how sessions are validated after deployment.",
  reason: "Affects whether people need to sign in again.",
  recommendation: "Keep existing sessions valid for a short transition.",
  stage: "waiting",
  choices: [
    {
      id: "keep",
      label: "Keep sessions",
      description: "Preserve existing sessions during the transition",
      recommended: true,
    },
    {
      id: "expire",
      label: "Sign everyone out",
      description: "Require a fresh sign-in",
    },
  ],
});
const qs = app.questions.create({
  taskId: ts.id,
  title: "Which search approach should we explore?",
  context: "Synthetic fixture: choose the investigation direction.",
  reason: "The agent can inspect existing queries while you decide.",
  stage: "can-continue",
  choices: [{ id: "local", label: "Start with local search" }],
});
const qd = app.questions.create({
  taskId: td.id,
  title: "Confirm the rollout window",
  context: "Synthetic fixture: a decision needed before release.",
  stage: "later",
});
app.questions.create({
  taskId: tf.id,
  title: "Foreign manager question should be hidden",
  stage: "waiting",
});
const seed = app.conversations.chat.add(
  auth.id,
  "codex",
  "Synthetic fixture: fix authentication, investigate search, and prepare the release.",
  "seed",
);
app.conversations.chat.update(seed.id, {
  status: "completed",
  blocks: [
    {
      id: "reply",
      kind: "message",
      phase: "final_answer",
      text: "**Synthetic UI fixture.** Questions from separate tasks stay beside this conversation. You can keep talking here while deciding what each task needs.\n\n- Authentication needs your decision.\n- Search can continue while you choose.\n- Deployment has a decision needed later.\n\nReading a question does not answer it. Only an explicit answer records a decision.",
    },
  ],
});
const call = async (route, method = "GET", body) => {
  const response = await fetch(app.url + "/api" + route, {
    method,
    headers: { Authorization: "Bearer " + app.token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.ok(response.ok, await response.clone().text());
  return response.json();
};
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
      timezoneId: "UTC",
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    ({ manager, feature }) => {
      localStorage.setItem("soull-manager", manager);
      localStorage.setItem("soull-feature", feature);
      localStorage.setItem("soull-tab", "conversation");
    },
    { manager: manager.id, feature: auth.id },
  );
  await page.goto(app.url + "/#" + app.token);
  const tray = page.getByRole("complementary", { name: "Needs you" }),
    main = page.getByRole("region", {
      name: "Conversation with Mika",
      exact: true,
    });
  await tray
    .getByRole("button", { name: /Keep existing sessions valid/ })
    .waitFor();
  assert.equal(
    await tray.getByText("Foreign manager question should be hidden").count(),
    0,
  );
  await page.screenshot({
    path: path.join(shots, "needs-you-desktop.png"),
    fullPage: true,
  });
  await main
    .getByRole("textbox", { name: "Message Mika" })
    .fill("Keep this unrelated main draft.");
  await tray
    .getByRole("button", { name: /Keep existing sessions valid/ })
    .click();
  await tray
    .getByRole("textbox", { name: "Your answer", exact: true })
    .fill("A draft answer that stays with this question.");
  assert.equal((await call("/questions/" + qa.id)).status, "open");
  await page.screenshot({
    path: path.join(shots, "needs-you-question.png"),
    fullPage: true,
  });
  await tray.getByRole("button", { name: "Discuss this", exact: true }).click();
  const discussion = tray.getByRole("region", {
    name: "Question discussion with Mika",
    exact: true,
  });
  await discussion
    .getByRole("textbox", { name: "Message Mika" })
    .fill("What would keeping the sessions change?");
  await discussion
    .getByRole("button", { name: "Send message", exact: true })
    .click();
  await discussion
    .getByText(
      "Synthetic fixture: keeping sessions avoids interrupting users. This discussion is not an answer.",
      { exact: true },
    )
    .waitFor();
  assert.equal((await call("/questions/" + qa.id)).status, "open");
  assert.equal(
    await main.getByRole("textbox", { name: "Message Mika" }).inputValue(),
    "Keep this unrelated main draft.",
  );
  await page.screenshot({
    path: path.join(shots, "needs-you-discussion.png"),
    fullPage: true,
  });
  await tray
    .getByRole("button", { name: "Back to question", exact: true })
    .click();
  assert.equal(
    await tray
      .getByRole("textbox", { name: "Your answer", exact: true })
      .inputValue(),
    "A draft answer that stays with this question.",
  );
  await page.reload();
  await tray
    .getByRole("button", { name: /Keep existing sessions valid/ })
    .waitFor();
  await tray
    .getByRole("button", { name: /Keep existing sessions valid/ })
    .click();
  assert.equal(
    await tray
      .getByRole("textbox", { name: "Your answer", exact: true })
      .inputValue(),
    "A draft answer that stays with this question.",
  );
  await tray
    .getByRole("button", { name: "All questions", exact: true })
    .click();
  await tray
    .getByRole("button", { name: "Keep sessions", exact: true })
    .click();
  await tray
    .getByRole("heading", { name: /Answers waiting for agent/ })
    .waitFor();
  const answered = await call("/questions/" + qa.id);
  assert.equal(answered.answer, "Keep sessions");
  assert.equal(answered.status, "answered");
  await tray
    .getByRole("button", { name: "Answered & dismissed history", exact: true })
    .click();
  await call("/questions/" + qa.id + "/ack", "POST", {
    taskId: ta.id,
    answerVersion: answered.answerVersion,
  });
  await tray.getByText("Applied · v1", { exact: true }).waitFor();
  // A milestone defers only its own task and releases explicitly.
  await tray.getByRole("button", { name: /Which search approach/ }).click();
  await tray.getByRole("button", { name: "Defer", exact: true }).click();
  await tray
    .getByRole("textbox", { name: "Or after a task milestone", exact: true })
    .fill("Search implementation ready");
  await tray
    .getByRole("button", { name: "Defer question", exact: true })
    .click();
  await tray
    .getByRole("button", { name: "All questions", exact: true })
    .click();
  await tray.getByRole("heading", { name: /Deferred/ }).waitFor();
  await call("/tasks/" + ts.id + "/milestone", "POST", {
    name: "Search implementation ready",
  });
  await tray.getByRole("heading", { name: /Can continue/ }).waitFor();
  // Concurrent task context changes never silently submit a stale draft.
  await tray.getByRole("button", { name: /Which search approach/ }).click();
  await tray
    .getByRole("textbox", { name: "Your answer", exact: true })
    .fill("User answer kept across a conflict.");
  const before = await call("/questions/" + qs.id);
  await call("/questions/" + qs.id, "PATCH", {
    revision: before.revision,
    action: "stage",
    stage: "waiting",
    taskId: ts.id,
  });
  await tray
    .getByText("This question changed while you were drafting.", {
      exact: false,
    })
    .waitFor();
  assert.equal(
    await tray
      .getByRole("button", { name: "Send answer", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await tray
      .getByRole("textbox", { name: "Your answer", exact: true })
      .inputValue(),
    "User answer kept across a conflict.",
  );
  await tray
    .getByRole("button", { name: "Use latest question", exact: true })
    .click();
  await tray.getByRole("button", { name: "Send answer", exact: true }).click();
  await tray
    .getByRole("heading", { name: /Answers waiting for agent/ })
    .waitFor();
  assert.equal(
    (await call("/questions/" + qs.id)).answer,
    "User answer kept across a conflict.",
  );
  // Timed deferral returns on the next tray poll; dismissal is explicit and reversible.
  await tray
    .getByRole("button", { name: /Confirm the rollout window/ })
    .click();
  await tray.getByRole("button", { name: "Defer", exact: true }).click();
  await tray
    .getByLabel("Remind me at", { exact: true })
    .fill(new Date(Date.now() + 3600000).toISOString().slice(0, 16));
  await tray
    .getByRole("button", { name: "Defer question", exact: true })
    .click();
  assert.equal((await call("/questions/" + qd.id)).deferred, true);
  app.store.db
    .prepare("UPDATE questions SET deferUntil=? WHERE id=?")
    .run(new Date(Date.now() - 1000).toISOString(), qd.id);
  await tray
    .locator(".question-stage")
    .filter({ hasText: "Needed later" })
    .waitFor();
  await tray.getByRole("button", { name: "Dismiss", exact: true }).click();
  await tray
    .getByRole("textbox", { name: "Why dismiss it?", exact: true })
    .fill("Synthetic fixture: rollout already decided.");
  await tray
    .getByRole("button", { name: "Confirm dismissal", exact: true })
    .click();
  await tray
    .getByRole("button", { name: "Reopen question", exact: true })
    .waitFor();
  await tray
    .getByRole("button", { name: "Reopen question", exact: true })
    .click();
  await tray
    .getByRole("button", { name: "All questions", exact: true })
    .click();
  await main
    .getByRole("textbox", { name: "Message Mika" })
    .fill("An unrelated manager question while another task waits.");
  await main.getByRole("button", { name: "Send message", exact: true }).click();
  await main
    .getByText(
      "Synthetic fixture: the main conversation remains available while task questions wait.",
      { exact: true },
    )
    .waitFor();
  assert.equal((await call("/questions/" + qd.id)).status, "open");
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({
    path: path.join(shots, "needs-you-compact.png"),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  const box = await main
    .getByRole("textbox", { name: "Message Mika" })
    .boundingBox();
  assert.ok(box.height >= 60 && box.y + box.height <= 768);
  // History exhaustion survives subsequent polling, even after more than one page.
  const historyButton = tray.getByRole("button", {
    name: "Answered & dismissed history",
    exact: true,
  });
  if ((await historyButton.getAttribute("aria-expanded")) === "true")
    await historyButton.click();
  for (let i = 0; i < 35; i++) {
    const q = app.questions.create({
      taskId: td.id,
      title: "History fixture " + i,
      stage: "later",
    });
    app.questions.update(q.id, {
      revision: q.revision,
      action: "dismiss",
      reason: "Synthetic completed decision",
    });
  }
  await historyButton.click();
  await tray
    .getByRole("button", { name: "Load earlier questions", exact: true })
    .click();
  await page.waitForTimeout(2500);
  assert.equal(
    await tray
      .getByRole("button", { name: "Load earlier questions", exact: true })
      .count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Needs you browser passed: manager-wide grouping, explicit answer vs discussion, independent composer/drafts, reload, version conflicts, acknowledgment, live history, time/milestone deferral, dismissal/reopen, unrelated chat and compact layout.",
  );
} finally {
  await browser?.close();
  await app.close();
  await rm(root, { recursive: true, force: true });
}
