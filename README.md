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

### Publish a finding

Workspace terminals include the `soull` command, `SOULL_FEATURE_ID`, and a reference to the local service. A coordinator can run:

```sh
soull help
soull finding create --title "Investigation complete" --body-file findings.md
soull finding create --kind question --title "Choose rollout approach" --body-file question.md
```

The body file is read on the CLI side. Other kinds: `answer`, `follow-up`. Results are JSON with durable IDs. Findings appear in Inbox and in the feature's Briefings. Marking an item read is separate from resolving it. Explicit Markdown links such as `[service](src/service.ts:42)` open the corresponding workspace file in Soull. Only relative file links are recognized.

In this slice, tell external-repository agents to use `soull help`; Soull does not rewrite the repository's agent instruction files. Soull's own AGENTS.md includes the reporting guidance. Full coordinator startup/remit injection is a follow-up.

### Iterate without losing sessions

UI builds do not own the service. Reload the interface with ⌘R in the native app; the terminal reconnects to the same PTY. File edits remain unsaved until Save / ⌘S. A conflict is rejected if the file changed on disk since it was opened. Reopen it to inspect the newer content. This is optimistic conflict detection, not filesystem locking against external editors.

For **service** changes, stop sessions first, then:

```sh
npm run dev -- --restart-service
```

This refuses to restart while terminal sessions or conversation turns are active. Restarting the service ends PTYs; SQLite records survive. Interrupted conversation requests are retained and never replayed automatically. Reload the native interface afterward to refresh its local authentication token. In the browser, rerun `node bin/soull.mjs open`.

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
```

Alternatively set `SOULL_BROWSER_BINARY` to an installed Chromium binary. The check covers Markdown, streamed replies, queued follow-ups, Stop, draft recovery, multi-page reading-anchor restoration and desktop/compact layout. Local screenshots go in `.impeccable/review/` and are ignored by Git.

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

Guided diffs are about **reducing cognitive load and maximizing clarity**. This slice provides actual working diffs, category grouping, editable source and session-only reviewed markers. PR descriptions, logical flow ordering, AI explanations, revision-bound test evidence, GitHub synchronization, usage reporting, environment/secret integration, workflow editing and safe merge cleanup are intentionally not presented as complete. The Map currently shows manager-owned features; dependency edges and layout editing are deferred. Briefings collect structured findings alongside feature-scoped manager conversations. Terminal remains available for interactive provider sessions and unsupported interactions.

## GitHub setup

A local `main` repository is initialized. If a remote was not created during setup, after GitHub access is available:

```sh
gh auth login
gh repo create Soull --private --source=. --remote=origin --push
```

The repository defaults to private because this is a personal development workspace. No GitHub Projects board is created by this scaffold.
