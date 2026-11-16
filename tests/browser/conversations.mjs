import { chromium } from "playwright";
import { startServer } from "../../service/server.mjs";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const project = fileURLToPath(new URL("../..", import.meta.url));
const reviewDir = path.join(project, ".impeccable/review");
const root = await mkdtemp(path.join(os.tmpdir(), "soull-visual-"));
let active;
const makeChatRun = ({ emit }) => ({
  start(prompt) {
    active = emit;
    emit({
      type: "delta",
      id: "stream",
      text: "Streaming fixture response. This is synthetic browser test data.",
    });
  },
  stop() {
    emit({ type: "done", status: "interrupted" });
  },
  respond() {},
});
const app = await startServer({ dataDir: root, port: 0, makeChatRun });
const m = app.store.addManager("Mika", root, "codex");
const f = app.store.addFeature({
  id: "visual-test",
  managerId: m.id,
  title: "Rich conversations · synthetic test",
  branch: "test/conversations",
  workspace: root,
  base: "fixture",
  created: new Date().toISOString(),
});
for (let i = 0; i < 94; i++) {
  const t = app.conversations.chat.add(
    f.id,
    "codex",
    "Synthetic test: How will the conversation stay readable as the feature grows?",
    "fixture-" + i,
  );
  app.conversations.chat.update(t.id, {
    status: "completed",
    blocks: [
      {
        id: "progress",
        kind: "message",
        text: "I’ll inspect the existing conversation transport first.",
        phase: "commentary",
      },
      {
        id: "tool",
        kind: "activity",
        title: "Inspect conversation rendering",
        text: "Synthetic fixture output. No real command was executed.",
        status: "completed",
      },
      {
        id: "reply",
        kind: "message",
        phase: "final_answer",
        text: "**Keep the answer in focus.** The conversation should help you return to the work without rereading every tool call.\n\n### A quieter reading flow\n\n- Replies use a comfortable line length and real Markdown.\n- Tool activity stays available under one disclosure.\n- New tokens arrive without pulling you away from an earlier answer.\n\nYour draft stays with the feature, and follow-ups resume the same provider conversation. See [the conversation component](ui/Conversation.tsx:1).\n\n```ts\nconst reading = !isAtBottom;\nif (!reading) followLatest();\n```\n\nThis is **synthetic browser test data**, not a live agent result.",
      },
    ],
  });
}
await mkdir(reviewDir, { recursive: true });
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
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(
    ({ manager, feature }) => {
      localStorage.setItem("soull-manager", manager);
      localStorage.setItem("soull-feature", feature);
      localStorage.setItem("soull-tab", "conversation");
    },
    { manager: m.id, feature: f.id },
  );
  await page.goto(app.url + "/#" + app.token);
  await page
    .getByRole("button", { name: "Send message", exact: true })
    .waitFor();
  await page.locator(".chat-exchange").last().waitFor();
  assert.equal(await page.locator(".chat-exchange").count(), 30);
  await page.screenshot({
    path: path.join(reviewDir, "desktop.png"),
    fullPage: true,
  });
  // Draft persistence, streaming, queued prompts, and no forced scroll while reading.
  const input = page.getByRole("textbox", { name: "Message Mika" });
  await input.fill("A draft that survives reload");
  await page.reload();
  await input.waitFor();
  assert.equal(await input.inputValue(), "A draft that survives reload");
  await input.fill("Start a synthetic streamed reply");
  await input.press("Enter");
  await page
    .getByText("Streaming fixture response.", { exact: false })
    .waitFor();
  await input.fill("Follow-up synthetic question");
  await input.press("Enter");
  await page
    .getByText("This message will run after the current reply.")
    .waitFor();
  await page.locator(".chat-scroll").evaluate((el) => {
    el.scrollTop = el.scrollHeight / 2;
    el.dispatchEvent(new Event("scroll"));
  });
  const scrollBefore = await page
    .locator(".chat-scroll")
    .evaluate((el) => el.scrollTop);
  active({
    type: "delta",
    id: "stream",
    text: "\nNew tokens should not move your reading position.",
  });
  await page.waitForTimeout(700);
  assert.equal(
    await page.locator(".chat-scroll").evaluate((el) => el.scrollTop),
    scrollBefore,
  );
  await page.getByRole("button", { name: "Jump to latest" }).click();
  await page.getByRole("button", { name: "Stop", exact: true }).first().click();
  await page.waitForTimeout(500);
  // Queued message starts after interruption. Stop it as well.
  await page.getByRole("button", { name: "Stop", exact: true }).first().click();
  await page.waitForTimeout(500);
  await page.locator(".chat-scroll").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.getByRole("button", { name: "Load earlier messages" }).click();
  await page.waitForTimeout(300);
  assert.ok((await page.locator(".chat-exchange").count()) > 30);
  // Restore an anchor in history older than the default 30-turn page.
  await page.locator(".chat-scroll").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.getByRole("button", { name: "Load earlier messages" }).click();
  await page.waitForTimeout(200);
  await page
    .locator(".chat-exchange")
    .nth(4)
    .evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(100);
  const anchor = await page.locator(".chat-scroll").evaluate((el) => {
    const top = el.getBoundingClientRect().top;
    const node = [...el.querySelectorAll("[data-turn-id]")].find(
      (n) => n.getBoundingClientRect().bottom > top,
    );
    return {
      id: node.dataset.turnId,
      offset: node.getBoundingClientRect().top - top,
    };
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Send message", exact: true })
    .waitFor();
  await page.waitForTimeout(300);
  const restored = await page
    .locator(`[data-turn-id="${anchor.id}"]`)
    .evaluate(
      (el) =>
        el.getBoundingClientRect().top -
        el.closest(".chat-scroll").getBoundingClientRect().top,
    );
  assert.ok(
    Math.abs(restored - anchor.offset) < 2,
    `Anchor moved: ${restored} vs ${anchor.offset}`,
  );
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.locator(".chat-scroll").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.screenshot({
    path: path.join(reviewDir, "compact.png"),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Browser passed: Markdown, 30-turn pagination, draft reload, streaming, queue, stop, stable reading scroll, compact width; no browser errors.",
  );
} finally {
  await browser?.close();
  await app.close();
  await rm(root, { recursive: true, force: true });
}
