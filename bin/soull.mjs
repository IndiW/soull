#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import path from "node:path";
const args = process.argv.slice(2),
  command = args[0];
const help = `Soull 0.1
  soull finding create --title "Summary" --body-file findings.md [--kind finding|answer|question|follow-up] [--feature ID]
  soull task create --title "Task name" [--feature ID]
  soull question create --task ID --body-file question.json
  soull question show ID
  soull question list [--manager ID] [--history]
  soull question inbox --task ID
  soull question ack ID --task ID --answer-version N
  soull question stage ID --task ID --stage waiting|can-continue|later --revision N
  soull question milestone --task ID --name "Milestone"
  soull state
  soull open

Uses SOULL_FEATURE_ID and SOULL_RUNTIME_FILE supplied to workspace terminals.
To use outside a workspace: set SOULL_RUNTIME_FILE and pass --feature ID.
Question JSON: {"title":"Decision?","context":"...","reason":"Why it matters","recommendation":"...","stage":"can-continue","choices":[{"id":"keep","label":"Keep sessions","recommended":true}]}.
Publish, then continue work or end the manager turn. Do not block the manager by waiting for answers.
Task agents read their inbox and acknowledge only the exact version actually received/used.
Discussion is not an answer. Questions and answers are durable across restarts. No provider credentials are read.`;
function option(key) {
  const i = args.indexOf("--" + key);
  return i < 0 ? undefined : args[i + 1];
}
try {
  if (!command || command === "help" || command === "--help") {
    console.log(help);
    process.exit(0);
  }
  const runtimeFile =
    process.env.SOULL_RUNTIME_FILE ||
    fileURLToPath(new URL("../.soull/runtime.json", import.meta.url));
  const runtime = JSON.parse(await readFile(runtimeFile, "utf8"));
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(runtime.url))
    throw new Error("Invalid local runtime URL");
  if (command === "open") {
    const child = spawn("open", [`${runtime.url}/#${runtime.token}`], {
      stdio: "ignore",
    });
    child.on("error", (error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  } else {
    let endpoint = "/api/state",
      init = { headers: { Authorization: "Bearer " + runtime.token } };
    if (command === "finding" && args[1] === "create") {
      endpoint = "/api/findings";
      const file = option("body-file");
      if (!file) throw new Error("--body-file is required");
      init = {
        ...init,
        method: "POST",
        body: JSON.stringify({
          featureId: option("feature") || process.env.SOULL_FEATURE_ID,
          title: option("title"),
          body: await readFile(path.resolve(file), "utf8"),
          kind: option("kind") || "finding",
        }),
      };
    } else if (command === "task" && args[1] === "create") {
      endpoint = "/api/tasks";
      init = {
        ...init,
        method: "POST",
        body: JSON.stringify({
          featureId: option("feature") || process.env.SOULL_FEATURE_ID,
          title: option("title"),
        }),
      };
    } else if (command === "question") {
      const action = args[1],
        id = args[2],
        taskId = option("task") || process.env.SOULL_TASK_ID;
      if (action === "create") {
        const file = option("body-file");
        if (!file) throw new Error("--body-file question.json is required");
        endpoint = "/api/questions";
        init = {
          ...init,
          method: "POST",
          body: JSON.stringify({
            ...JSON.parse(await readFile(path.resolve(file), "utf8")),
            taskId,
          }),
        };
      } else if (action === "show" && id && !id.startsWith("--"))
        endpoint = "/api/questions/" + encodeURIComponent(id);
      else if (action === "list") {
        const managerId = option("manager") || process.env.SOULL_MANAGER_ID;
        if (!managerId)
          throw new Error(
            "--manager ID is required outside a workspace terminal",
          );
        endpoint =
          "/api/managers/" +
          encodeURIComponent(managerId) +
          "/questions" +
          (args.includes("--history") ? "?history=true" : "");
      } else if (action === "inbox") {
        if (!taskId) throw new Error("--task ID is required");
        endpoint = "/api/tasks/" + encodeURIComponent(taskId) + "/answers";
      } else if (action === "ack" && id && !id.startsWith("--")) {
        if (!taskId) throw new Error("--task ID is required");
        endpoint = "/api/questions/" + encodeURIComponent(id) + "/ack";
        init = {
          ...init,
          method: "POST",
          body: JSON.stringify({
            taskId,
            answerVersion: Number(option("answer-version")),
          }),
        };
      } else if (action === "stage" && id && !id.startsWith("--")) {
        endpoint = "/api/questions/" + encodeURIComponent(id);
        init = {
          ...init,
          method: "PATCH",
          body: JSON.stringify({
            action: "stage",
            taskId,
            revision: Number(option("revision")),
            stage: option("stage"),
          }),
        };
      } else if (action === "milestone") {
        if (!taskId) throw new Error("--task ID is required");
        endpoint = "/api/tasks/" + encodeURIComponent(taskId) + "/milestone";
        init = {
          ...init,
          method: "POST",
          body: JSON.stringify({ name: option("name") }),
        };
      } else throw new Error("Unknown question command. Run soull help.");
    } else if (command !== "state")
      throw new Error("Unknown command. Run soull help.");
    const response = await fetch(runtime.url + endpoint, init),
      result = await response.json();
    if (!response.ok) throw new Error(result.error);
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(`soull: ${error.message}`);
  process.exitCode = 1;
}
