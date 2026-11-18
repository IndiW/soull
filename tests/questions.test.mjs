import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import { startServer } from "../service/server.mjs";
const exec = promisify(execFile);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const choice = {
  id: "keep",
  label: "Keep sessions",
  description: "Avoid signing users out",
  recommended: true,
};

test("Needs you: durable questions, versioned answers, deferral, manager/task isolation and independent discussion", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "soull-questions-")),
    runs = [];
  const makeRun = (options) => {
    const run = {
      ...options,
      start(prompt) {
        this.prompt = prompt;
      },
      stop() {
        options.emit({ type: "done", status: "interrupted" });
      },
    };
    runs.push(run);
    return run;
  };
  let app = await startServer({
    dataDir: root,
    port: 0,
    makeChatRun: makeRun,
    makeDiscussionRun: makeRun,
  });
  const manager = app.store.addManager("Mika", root, "codex"),
    other = app.store.addManager("Nori", root, "claude");
  const feature = (id, managerId) =>
    app.store.addFeature({
      id,
      managerId,
      title: id,
      branch: id,
      workspace: root,
      base: "fixture",
      created: new Date().toISOString(),
    });
  feature("auth", manager.id);
  feature("search", manager.id);
  feature("other", other.id);
  const call = async (route, method = "GET", body) => {
    const response = await fetch(app.url + "/api" + route, {
      method,
      headers: { Authorization: "Bearer " + app.token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const task = (
    await call("/tasks", "POST", {
      featureId: "auth",
      title: "Authentication fix",
    })
  ).body;
  const task2 = (
    await call("/tasks", "POST", {
      featureId: "search",
      title: "Search redesign",
    })
  ).body;
  const create = async (taskId, stage = "waiting") =>
    (
      await call("/questions", "POST", {
        taskId,
        title: "Keep existing sessions valid?",
        context: "User sessions may expire after deployment.",
        reason: "Determines rollout behavior.",
        recommendation: "Keep sessions.",
        choices: [choice],
        stage,
      })
    ).body;
  try {
    assert.equal(
      (await fetch(app.url + "/api/managers/" + manager.id + "/questions"))
        .status,
      401,
    );
    assert.equal(
      (await call("/questions", "POST", { taskId: "missing", title: "bad" }))
        .status,
      404,
    );
    const q = await create(task.id),
      q2 = await create(task2.id, "can-continue");
    assert.equal(
      (await call("/managers/" + manager.id + "/questions")).body.questions
        .length,
      2,
    );
    assert.equal(
      (await call("/managers/" + other.id + "/questions")).body.questions
        .length,
      0,
    );
    assert.equal(
      (await call("/state")).body.questionCounts.find(
        (c) => c.managerId === manager.id,
      ).open,
      2,
    );
    await call("/questions/" + q.id, "PATCH", { action: "read" });
    assert.equal((await call("/questions/" + q.id)).body.status, "open");
    assert.equal((await call("/questions/" + q.id)).body.revision, q.revision);
    // The manager can be busy while two question-specific discussions proceed independently.
    await call("/features/auth/conversation", "POST", {
      prompt: "Keep coordinating",
      requestId: "manager",
    });
    await call("/questions/" + q.id + "/discussion", "POST", {
      prompt: "What are the tradeoffs?",
      requestId: "discussion-one",
    });
    await call("/questions/" + q2.id + "/discussion", "POST", {
      prompt: "Explain the options",
      requestId: "discussion-two",
    });
    assert.equal(runs.length, 3);
    assert.equal(runs[1].readOnly, true);
    assert.match(runs[1].prompt, /not an answer submission/);
    assert.ok(
      runs[1].prompt.includes(choice.description),
      "discussion receives the complete suggested-answer context",
    );
    assert.equal(runs[1].env.SOULL_FEATURE_ID, "auth");
    assert.equal(runs[1].env.SOULL_TASK_ID, task.id);
    runs[1].emit({
      type: "message",
      id: "reply",
      text: "Discussion says keep sessions. This is not a decision.",
    });
    runs[1].emit({ type: "done", status: "completed" });
    assert.equal((await call("/questions/" + q.id)).body.status, "open");
    assert.equal(app.conversations.chat.page("auth").turns.length, 1);
    assert.equal(app.discussions.chat.page(q.id).turns.length, 1);
    assert.equal(
      (
        await call(
          "/questions/" +
            q.id +
            "/discussion/" +
            app.discussions.chat.page(q.id).turns[0].id +
            "/cancel",
          "POST",
        )
      ).status,
      200,
    );
    const first = (
      await call("/questions/" + q.id + "/answer", "POST", {
        revision: q.revision,
        choiceId: "keep",
        requestId: "answer-one",
      })
    ).body;
    assert.equal(first.status, "answered");
    assert.equal(first.answer, "Keep sessions");
    assert.equal(first.answerVersion, 1);
    assert.equal(first.appliedVersion, 0);
    assert.equal(runs.length, 3, "answer must not queue a main chat turn");
    const inbox = (await call("/tasks/" + task.id + "/answers")).body.answers;
    assert.equal(inbox[0].answerVersion, 1);
    assert.equal(
      (await call("/tasks/" + task2.id + "/answers")).body.answers.length,
      0,
    );
    assert.equal(
      (
        await call("/questions/" + q.id + "/answer", "POST", {
          revision: q.revision,
          choiceId: "keep",
          requestId: "answer-one",
        })
      ).body.answerVersion,
      1,
      "retry is idempotent",
    );
    assert.equal(
      (
        await call("/questions/" + q.id + "/answer", "POST", {
          revision: q.revision,
          answer: "Competing answer",
          requestId: "competing",
        })
      ).status,
      409,
    );
    const revised = (
      await call("/questions/" + q.id + "/answer", "POST", {
        revision: first.revision,
        answer: "Keep sessions for 24 hours.",
        requestId: "answer-two",
      })
    ).body;
    assert.equal(revised.answerVersion, 2);
    assert.equal(
      (
        await call("/questions/" + q.id + "/ack", "POST", {
          taskId: task2.id,
          answerVersion: 2,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await call("/questions/" + q.id + "/ack", "POST", {
          taskId: task.id,
          answerVersion: 1,
        })
      ).status,
      409,
    );
    const applied = (
      await call("/questions/" + q.id + "/ack", "POST", {
        taskId: task.id,
        answerVersion: 2,
      })
    ).body;
    assert.equal(applied.status, "applied");
    assert.equal(applied.appliedVersion, 2);
    assert.equal(
      (await call("/tasks/" + task.id + "/answers")).body.answers.length,
      0,
    );
    assert.equal(
      (
        await call("/questions/" + q.id + "/ack", "POST", {
          taskId: task.id,
          answerVersion: 2,
        })
      ).body.revision,
      applied.revision,
    );
    const history = (
      await call("/managers/" + manager.id + "/questions?history=true")
    ).body;
    assert.equal(history.questions[0].id, q.id);
    const updated = (
      await call("/questions/" + q.id + "/answer", "POST", {
        revision: applied.revision,
        answer: "Actually keep existing sessions for 48 hours.",
        requestId: "answer-three",
      })
    ).body;
    assert.equal(updated.status, "answered");
    assert.equal(updated.answerVersion, 3);
    assert.equal(updated.appliedVersion, 2);
    assert.equal(
      (
        await call("/questions/" + q.id + "/ack", "POST", {
          taskId: task.id,
          answerVersion: 2,
        })
      ).status,
      409,
    );
    const deferred = (
      await call("/questions/" + q2.id, "PATCH", {
        revision: q2.revision,
        action: "defer",
        milestone: "API contract agreed",
      })
    ).body;
    assert.equal(deferred.deferred, true);
    assert.equal(
      (
        await call("/tasks/" + task.id + "/milestone", "POST", {
          name: "API contract agreed",
        })
      ).body.released,
      0,
    );
    assert.equal(
      (
        await call("/tasks/" + task2.id + "/milestone", "POST", {
          name: "API contract agreed",
        })
      ).body.released,
      1,
    );
    const resumed = (await call("/questions/" + q2.id)).body;
    assert.equal(resumed.deferred, false);
    assert.equal(
      (
        await call("/questions/" + q2.id, "PATCH", {
          revision: resumed.revision,
          action: "defer",
          until: "invalid",
        })
      ).status,
      400,
    );
    const timed = (
      await call("/questions/" + q2.id, "PATCH", {
        revision: resumed.revision,
        action: "defer",
        until: new Date(Date.now() + 60_000).toISOString(),
      })
    ).body;
    assert.equal(timed.deferred, true);
    app.store.db
      .prepare("UPDATE questions SET deferUntil=? WHERE id=?")
      .run(new Date(Date.now() - 1000).toISOString(), q2.id);
    const due = (await call("/questions/" + q2.id)).body;
    assert.equal(due.deferred, false);
    assert.equal(
      (
        await call("/questions/" + q2.id, "PATCH", {
          revision: due.revision,
          action: "dismiss",
          reason: "",
        })
      ).status,
      400,
    );
    const dismissed = (
      await call("/questions/" + q2.id, "PATCH", {
        revision: due.revision,
        action: "dismiss",
        reason: "The task no longer needs this decision.",
      })
    ).body;
    assert.equal(dismissed.status, "dismissed");
    assert.equal(
      (
        await call("/questions/" + q2.id + "/answer", "POST", {
          revision: dismissed.revision,
          answer: "No",
          requestId: "dismissed-answer",
        })
      ).status,
      409,
    );
    const restored = (
      await call("/questions/" + q2.id, "PATCH", {
        revision: dismissed.revision,
        action: "restore",
      })
    ).body;
    assert.equal(restored.status, "open");
    assert.equal(
      (
        await call("/questions/" + q2.id, "PATCH", {
          revision: restored.revision,
          action: "stage",
          taskId: task.id,
          stage: "later",
        })
      ).status,
      409,
    );
    const changed = (
      await call("/questions/" + q2.id, "PATCH", {
        revision: restored.revision,
        action: "stage",
        taskId: task2.id,
        stage: "later",
      })
    ).body;
    assert.equal(changed.stage, "later");
    // CLI provides exact task routing and an explicit acknowledgment protocol.
    const cli = async (args) =>
      JSON.parse(
        (
          await exec(process.execPath, ["bin/soull.mjs", ...args], {
            cwd: path.resolve(import.meta.dirname, ".."),
            env: {
              ...process.env,
              SOULL_RUNTIME_FILE: app.runtimeFile,
              SOULL_FEATURE_ID: "auth",
              SOULL_TASK_ID: task.id,
            },
          })
        ).stdout,
      );
    assert.equal(
      (await cli(["question", "inbox"])).answers[0].answerVersion,
      3,
    );
    assert.equal(
      (await cli(["question", "ack", q.id, "--answer-version", "3"])).status,
      "applied",
    );
    const bodyFile = path.join(root, "question.json");
    await writeFile(
      bodyFile,
      JSON.stringify({
        title: "Another decision?",
        stage: "later",
        context: "CLI fixture",
      }),
    );
    const cliQuestion = await cli([
      "question",
      "create",
      "--body-file",
      bodyFile,
    ]);
    assert.equal(cliQuestion.taskId, task.id);
    const legacy = (
      await call("/findings", "POST", {
        featureId: "auth",
        kind: "question",
        title: "Legacy decision?",
        body: "Keep the original finding context.",
      })
    ).body;
    assert.equal((await call("/questions/" + legacy.id)).body.status, "open");
    // Native requests become durable questions, without blocking the manager on a live approval.
    const nativeEvent = {
      type: "question",
      requestId: 991,
      questions: [
        {
          id: "db",
          header: "Storage",
          question: "Choose a database?",
          options: [
            { label: "SQLite", description: "Local first" },
            { label: "Postgres", description: "Shared server" },
          ],
        },
      ],
    };
    nativeEvent.source = "worker-thread-a";
    const published = runs[0].emit(nativeEvent);
    assert.equal(published.ids.length, 1);
    assert.equal(app.questions.get(published.ids[0]).status, "open");
    const again = runs[0].emit({ ...nativeEvent, requestId: 992 });
    assert.deepEqual(
      again.ids,
      published.ids,
      "semantic retries in the same turn do not duplicate questions",
    );
    const different = runs[0].emit({
      ...nativeEvent,
      source: "worker-thread-b",
    });
    assert.notEqual(
      different.taskId,
      published.taskId,
      "identical questions from different workers keep separate routing",
    );
    assert.equal(
      app.questions.task(published.taskId).origin,
      "worker-thread-a",
    );
    const nativeQuestion = app.questions.get(published.ids[0]);
    await call("/questions/" + nativeQuestion.id + "/answer", "POST", {
      revision: nativeQuestion.revision,
      answer: "Use SQLite.",
      requestId: "native-answer",
    });
    app.conversations.send(
      "auth",
      "Continue coordinating",
      "pending-answer-context",
    );
    runs[0].emit({ type: "done", status: "completed" });
    await pause(0);
    assert.match(runs.at(-1).prompt, new RegExp(published.taskId));
    assert.match(runs.at(-1).prompt, /owning tasks/);
    const listed = await cli(["question", "list", "--manager", manager.id]);
    assert.ok(listed.questions.some((q) => q.id === nativeQuestion.id));
    await app.close();
    app = await startServer({
      dataDir: root,
      port: 0,
      makeChatRun: makeRun,
      makeDiscussionRun: makeRun,
    });
    assert.equal((await call("/questions/" + q.id)).body.status, "applied");
    assert.equal((await call("/questions/" + q2.id)).body.stage, "later");
    assert.equal(
      app.discussions.chat.page(q.id).turns[0].blocks[0].text,
      "Discussion says keep sessions. This is not a decision.",
    );
    assert.equal(
      app.discussions.chat.page(q2.id).turns[0].status,
      "interrupted",
    );
    assert.equal(
      app.conversations.chat.page("auth").turns.at(-1).status,
      "interrupted",
    );
    assert.equal(
      app.store.db
        .prepare("SELECT count(*) AS n FROM questions WHERE id=?")
        .get(legacy.id).n,
      1,
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
