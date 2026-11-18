# Soull

A local-first macOS workspace for persistent agent managers, parallel features, and clear reviews. **Soull has two Ls.**

The first working slice: register a manager against a local Git repository, create an isolated feature worktree, run your installed Codex or Claude Code CLI, publish findings into a durable inbox, and inspect/edit the real working diff.

## Run

Requirements: macOS 14+, Node **24.4+** (built-in SQLite), Python 3, Git, and installed `codex` and/or `claude` CLIs. Building the native shell also requires the Xcode command-line tools / Swift toolchain. Provider authentication happens in the unmodified provider CLI; Soull does not collect subscription credentials.

```sh
npm ci
npm run dev
```

`dev` starts an independent local service if needed and watches the React interface. In another terminal:

```sh
npm run native:build
npm run native
```

Or open the interface in a browser:

```sh
node bin/soull.mjs open
```

Hire a manager, provide an existing repository with at least one commit, then create a feature. Worktrees begin at the source repository's current HEAD; uncommitted source files are not copied. Open Conversation to send the manager a message, or Terminal to start an interactive Codex, Claude Code, or shell session. Both run in the selected feature worktree. Subscription limits and provider permissions remain provider-controlled.

### Manager conversations

Sign in through the installed CLI before sending a message:

```sh
codex login
claude auth login
```

Run the command for the provider chosen when hiring the manager. Soull launches the unmodified binaries from the service's `PATH`; it neither reads provider tokens nor hosts a login or credential proxy. Existing CLI configuration and billing choices still apply, including API-key authentication when configured. A subscription does not override those choices.

Conversation is feature-scoped. Codex uses App Server JSON-RPC (`initialize`, thread start/resume, turn start); Claude Code uses print mode with streaming JSON and `--resume`. Provider session IDs are saved for subsequent messages. This history is separate from interactive Terminal sessions. Send follow-ups while a reply is running: up to eight messages can wait, and each feature runs one turn at a time. Cancel removes a queued request; Stop interrupts the current turn. Failed or interrupted messages offer **Edit and resend**; Soull never automatically retries or replays them after a service restart.

Completed replies lead with the final answer, with earlier updates and tool activity under disclosures. Streaming stays plain text; completed replies render Markdown and workspace-relative file links. Copy reply and the existing optional copy-on-selection behavior are available. Mark read/unread is explicit and separate from execution state.

Turns, tool records and provider session IDs live in local SQLite, independently of the UI. Drafts and read markers use that browser/webview's `localStorage`; reading position uses `sessionStorage`. These preferences are not synchronized between browsers or with the native app. The UI initially loads 30 turns, offers older pages, restores the visible turn and offset (loading older pages to that anchor when needed), and polls only changed turn snapshots. Stream writes are batched at 100 ms; settled turns are memoized to keep active replies from repeatedly rendering old Markdown. History is paged, not a fully virtualized transcript.

Codex runs with workspace-write sandboxing and on-request approvals. Soull exposes supported command/file-change requests as **Allow once** / **Deny**, scoped to the waiting turn; unsupported interactions fail closed. Claude Code print mode follows its existing permission configuration. Soull does not provide interactive Claude permission approvals or bypass them: denied tools appear in activity, with a Terminal fallback. Provider permissions and local CLI configuration remain authoritative; Soull is not an additional agent sandbox.

If startup or protocol compatibility fails, the turn reports an error; check CLI sign-in/version in Terminal and send again. The local Codex `0.167.0-alpha.4` passed an App Server initialization handshake without an inference/account call. Synthetic adapter, service and browser checks exercise conversation behavior; real subscription-backed turns still require a signed-in user smoke test for **both** providers. Claude Code was unavailable in the implementation environment. This is not a certification of every CLI version or subscription policy.

Provider references: [Codex App Server](https://learn.chatgpt.com/docs/app-server), [Claude Code headless mode](https://code.claude.com/docs/en/headless), and [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance).

### Guided diff explanations

In Guided diff, choose **Explain changes** to request a change summary and per-file **what changed**, **why**, and **risks & uncertainty**. Generation is manual: use **Regenerate explanation** after changes or **Stop explanation** while running. Save editor changes first; unsaved text is excluded and generation is disabled while the editor is dirty. **Change summary** and **This file** switch the explanation scope. The prose is unverified AI guidance; check inferred rationale and risks against the source.

The manager's selected installed CLI reuses its existing sign-in/configuration in a new isolated provider session, separate from normal Conversation history. Soull does not read tokens or provide a login proxy. Codex requests a `read-only` sandbox with `approvalPolicy: never`; this is not a blanket disable of every tool. Claude Code receives `--tools '' --disallowedTools '*'` to disable built-in and MCP tools ([CLI reference](https://code.claude.com/docs/en/cli-reference)). The prompt asks for description only, and an approval request fails generation without granting access. Existing provider billing choices still apply.

**Revision details** records the diff fingerprint, feature base, full HEAD, provider and capture time. The fingerprint binds the working diff to tracked/untracked file bytes, deletion state and file modes; binary bytes are hashed with their content omitted from the prompt, and symlink target strings are hashed without dereferencing them. The displayed file diff carries its captured revision too. Worktree changes, unsaved edits, unavailable revision checks and read errors are explicit; use **Refresh changes** before comparing an outdated displayed diff. “Matches the last checked worktree” describes the latest check, not a filesystem lock.

Results must provide nonempty what/why/risks prose for the summary and every captured path exactly once; unknown, duplicate or missing paths fail validation. A failed or stopped regeneration preserves the last successful explanation. Jobs, snapshots and successful results live in SQLite across UI reloads; unfinished jobs become interrupted after service restart and are never replayed automatically. **Discuss with manager** opens a Conversation draft containing revision and AI context, appending to any existing draft. It does not send the message.

Current capture limits: 100 changed files, 1 MiB per regular file, 2 MiB combined file reads, 160,000 bytes of diff and 180,000 bytes of serialized snapshot. Requests time out after five minutes and replies are limited to 100,000 characters. Large or unreadable changes report an error rather than a partial explanation. Implementation: [snapshot/jobs and validation](service/reviews.mjs), [provider settings](service/providers.mjs), [diff revision API](service/server.mjs), and [explanation UI](ui/Explanation.tsx).

### Publish a finding

Workspace terminals include the `soull` command, `SOULL_FEATURE_ID`, and a reference to the local service. A coordinator can run:

```sh
soull help
soull finding create --title "Investigation complete" --body-file findings.md
```

The body file is read on the CLI side. Other kinds: `answer`, `follow-up`. Results are JSON with durable IDs. Findings appear in Inbox and in the feature's Briefings. Marking an item read is separate from resolving it. Explicit Markdown links such as `[service](src/service.ts:42)` open the corresponding workspace file in Soull. Only relative file links are recognized.

In this slice, tell external-repository agents to use `soull help`; Soull does not rewrite the repository's agent instruction files. Soull's own AGENTS.md includes the reporting guidance, and structured manager turns receive the question/delegation protocol. External Terminal agents still need explicit reporting instructions.

### Needs you: durable task questions

Open a manager’s **Needs you** tray to review questions across its tasks and features. **Waiting on you**, **Can continue**, and **Needed later** describe when a decision matters. Quick choices and custom replies use the same explicit Answer action. Discussion is exploration: each question has its own read-only provider conversation, isolated from the main manager turn, and discussing never submits a decision. Answer and discussion drafts persist in browser-local storage.

The lifecycle is **Open → Answered → Applied**. Submitting an answer writes a durable task mailbox entry without waiting for the main chat queue or starting a model call. **Answered** means the agent has not acknowledged that version. **Applied** means the owning task explicitly acknowledged the exact answer version it received/used; it is an agent declaration, not verified code execution. Updated answers get immutable versions. Stale question revisions and acknowledgments from the wrong task or for superseded answers are rejected; repeated answer request IDs are idempotent.

Defer an open question until a time or an exact task milestone; this postpones attention without resolving it. Timed reminders return on the next read/poll. Milestones are scoped to the owning task. Dismiss or reopen questions explicitly; Applied and dismissed history loads in pages of 30, ordered by completion, including newly completed questions while older pages are open. SQLite retains questions, answer history and discussions across restarts; browser/webview drafts and view preferences remain local.

Publish questions through the CLI rather than burying decisions in chat:

```sh
soull task create --title "Choose rollout approach"
# Use the returned task ID below.
soull question create --task TASK_ID --body-file question.json
soull question list --manager MANAGER_ID
soull question show QUESTION_ID
soull question inbox --task TASK_ID
# Only after this task has received/used the exact returned answerVersion:
soull question ack QUESTION_ID --task TASK_ID --answer-version 1
# For an open question, use its latest revision from question show:
soull question stage OPEN_QUESTION_ID --task TASK_ID --stage waiting --revision REVISION
soull question milestone --task TASK_ID --name "Implementation ready"
```

`question.json` contains:

```json
{
  "title": "Which rollout approach?",
  "context": "The implementation supports either approach.",
  "reason": "The choice determines rollout work.",
  "recommendation": "Start with a small cohort.",
  "stage": "can-continue",
  "choices": [{ "id": "cohort", "label": "Small cohort", "recommended": true }]
}
```

Workspace commands receive `SOULL_FEATURE_ID`, `SOULL_MANAGER_ID` and the local runtime reference; `question list` defaults to `SOULL_MANAGER_ID`. Task commands accept `SOULL_TASK_ID` as a task default. New questions allow at most five choices and 12,000 context characters, with at most 200 unresolved questions per manager. Lists omit full context; details load separately. Earlier `finding --kind question` records are adopted once while preserving the original finding; resolved legacy findings become dismissed, never Applied. All legacy questions remain accessible even above the new-authoring cap.

Task records route decisions; they do not schedule autonomous workers. Manager chat turns remain serialized per feature. Manager instructions ask the provider to delegate through native subagents, publish durable questions, then continue other work or finish the turn instead of waiting. Task agents retrieve their mailboxes independently; the next manager turn receives pending-answer routing metadata, including the native worker source when available. Delivery and acknowledgment still require agent cooperation.

Supported native Codex `item/tool/requestUserInput` requests and structured Claude `AskUserQuestion` requests are captured as durable questions. Codex receives an explicit error explaining that capture is not a user answer and directing the task to its mailbox. Native requests retain their source (Codex thread or Claude parent tool), so retries within a turn are deduplicated without merging distinct workers. Claude child question requests are captured while child prose stays out of the manager transcript. The CLI remains the explicit fallback for unsupported requests; workflow state is never inferred from terminal scraping. Provider permissions and sign-in remain with the installed CLIs.

### Iterate without losing sessions

UI builds do not own the service. Reload the interface with ⌘R in the native app; the terminal reconnects to the same PTY. File edits remain unsaved until Save / ⌘S. A conflict is rejected if the file changed on disk since it was opened. Reopen it to inspect the newer content. This is optimistic conflict detection, not filesystem locking against external editors.

For **service** changes, stop sessions first, then:

```sh
npm run dev -- --restart-service
```

This refuses to restart while terminal sessions, conversation turns or explanations are active. Restarting the service ends PTYs; SQLite records survive. Interrupted conversation and explanation requests are retained and never replayed automatically. Reload the native interface afterward to refresh its local authentication token. In the browser, rerun `node bin/soull.mjs open`.

`npm run dev` watches and rebuilds; it does not yet auto-refresh the webview or preserve terminal scroll position exactly. Agent TUI content replays from a bounded in-memory buffer on reconnect. The service owns PTYs until stopped, not across machine/service restarts. To stop it after closing all sessions, terminate the PID recorded in `.soull/runtime.json`. Closing the window or UI watcher intentionally leaves the service running.

## Validate

```sh
npm run typecheck
npm run build
npm test
npm run native:build
```

For a development environment whose sandbox restricts local socket binding, `npm run dev -- --verify` runs the same integration suite in the development launcher context. The suite uses temporary repositories and a separate ephemeral service, not the user's project data. It verifies Git worktree isolation, authenticated APIs, findings through the real CLI, conflict detection, traversal/symlink rejection, actual PTY output and persistence across service restart. Conversation tests use synthetic provider transports to cover session continuation, queuing, scoped approvals, interruption and incremental history; they do not prove real subscription access. Native validation requires macOS and Swift; it cannot run in the Linux implementation environment.

Browser checks are separate and use synthetic conversation fixtures in an ephemeral service:

```sh
npx playwright install chromium
npm run test:browser
# Guided diff fixture can also be run directly:
node tests/browser/reviews.mjs
```

Alternatively set `SOULL_BROWSER_BINARY` to an installed Chromium binary. The Needs you fixture covers manager-wide grouping, quick/custom answers, drafts, discussion isolation, deferral, history and compact layout. Conversation checks cover Markdown, streamed replies, queued follow-ups, Stop, draft recovery, multi-page reading-anchor restoration and desktop/compact layout. The Guided diff fixture covers generation, per-file guidance, deleted files, unsaved edit guards, staleness, regeneration, reload, failed-output recovery and revision context in preserved Conversation drafts. [Review unit/service tests](tests/reviews.test.mjs) cover snapshot fingerprints, schema validation, cancellation and durable recovery; [provider tests](tests/providers.test.mjs) exercise synthetic transports. These fixtures do not validate real signed-in subscription inference. Local screenshots go in `.impeccable/review/` and are ignored by Git.

Before relying on subscription-backed work on your Mac, sign in to each CLI, send a message and follow-up through a manager configured for that provider, reload during a reply, and exercise its permission flow. These live checks remain outstanding.

## Architecture

- `native/`: thin AppKit + WKWebView shell, native menus, clipboard bridge, dark appearance. Separate `dev.soull.desktop` identity.
- `ui/`: React/TypeScript product interface, SVG robots, workspace navigation, basic category-grouped diff and text editor.
- `service/`: loopback HTTP supervisor, SQLite state, Git operations, structured conversation adapters, sessions and Python Unix PTY bridge.
- `bin/`: `soull` CLI communicating through the authenticated local service.
- `.soull/`: ignored local database, bearer discovery file, logs, and worktrees. **Do not delete this directory casually: it can contain uncommitted work.** Runtime discovery is created with mode 0600; directory with mode 0700.

The first-slice terminal uses **xterm**, not libghostty. The terminal transport is separate from rendering so Ghostty can be integrated later. The first code editor is a plain text editor; syntax intelligence and advanced editing are not implemented.

The local service binds only `127.0.0.1`, rejects mismatched Host/Origin headers, and requires a random bearer token for API calls. It is a local development service, not an exposed multi-user server or an agent sandbox. Same-user processes and agents executing arbitrary local commands remain within the local user's trust boundary. No code execution permissions are enforced by Soull's instructions or workflow records.

## Product and design

- [Product specification](PRODUCT.md)
- [Decisions and first-slice acceptance](docs/DECISIONS.md)
- [Design system](DESIGN.md)
- [Initial design reference](docs/design/initial-review.png), generated concept originally titled Soul
- [Project-local Unslop skill](.agents/skills/unslop/SKILL.md), by Damir Sokolovsky, CC BY 4.0

Guided diffs are about **reducing cognitive load and maximizing clarity**. This slice provides actual working diffs, category grouping, editable source and session-only reviewed markers. GitHub PR descriptions, logical flow ordering, revision-bound test evidence and per-file test/coverage mapping, GitHub synchronization, usage reporting, environment/secret integration, workflow editing and safe merge cleanup are intentionally not presented as complete. The Map currently shows manager-owned features; dependency edges and layout editing are deferred. Briefings collect structured findings alongside feature-scoped manager conversations. Terminal remains available for interactive provider sessions and unsupported interactions.

## GitHub setup

A local `main` repository is initialized. If a remote was not created during setup, after GitHub access is available:

```sh
gh auth login
gh repo create Soull --private --source=. --remote=origin --push
```

The repository defaults to private because this is a personal development workspace. No GitHub Projects board is created by this scaffold.
