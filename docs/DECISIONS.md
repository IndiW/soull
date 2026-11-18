# Decisions

Recorded 2026-11-15 from the product conversation.

| Decision | Rationale / boundary |
| --- | --- |
| Product name Soull, two Ls | User selected name. Earlier mockups say Soul. |
| macOS first, dark only | Native workspace with playful identity and clear hierarchy. |
| Thin Swift shell, React/TypeScript product UI | Fast feedback on complex graph, review and conversation views; native services remain possible. |
| Independent local supervisor | UI reloads must not terminate active agent sessions. |
| SQLite durable local state | Managers, features, findings and decisions survive process restarts. Live PTYs cannot survive supervisor termination. |
| `soull` CLI backed by the service | Structured agent-to-app communication independent of provider; instructions encourage delivery, schemas validate it. |
| Provider-specific adapters | Do not force a false common capability set. Codex and Claude Code both required. |
| Launch installed unmodified CLIs first | Users keep provider-native sign-in and subscriptions. Never collect provider OAuth credentials. |
| Structured feature conversations use provider-native transports | Codex App Server JSON-RPC; Claude Code print-mode streaming JSON. Installed unmodified CLIs retain their own authentication/configuration, including configured API billing. |
| Claude Code authenticates itself | Its own binary and own sign-in flow; no Soull-hosted Claude login or credential proxy. |
| Managers are independent of repo boundaries | Multiple managers can share a repo; one scope can contain several features. |
| Manager handles all developer communication | No direct user-to-subagent conversations. |
| Feature history outlives execution | Developer sessions/worktrees are temporary; preserve evidence and decisions. |
| Guided diffs, not just a diff viewer | PR story, logical/category ordering, revision-bound explanations and related test evidence. |
| Native Ghostty integration is the terminal target | First slice may use xterm in the webview to unblock a real usable PTY; keep the terminal transport replaceable. Do not represent xterm as libghostty. |
| Main-pane Terminal tab | No mandatory bottom terminal pane. |
| Geometric SVG robot avatars | Easy generation, recognizable silhouettes, minimal decorative complexity. |
| Subscription usage is reported honestly | No inferred usage represented as provider-reported data. |
| GitHub integration supplies observed state | Agent readiness does not override failing checks; merge triggers eventual cleanup. |
| Keep Stable and Dev separate | Dogfood without replacing the running app with an unfinished build. |

## Integration references checked

- https://learn.chatgpt.com/docs/app-server
- https://code.claude.com/docs/en/headless
- https://code.claude.com/docs/en/legal-and-compliance
- https://github.com/ghostty-org/ghostty

Authentication and subscription policies change. Revalidate when implementing structured transports or distribution. Terminal-hosting and API/SDK credential routing are different integration models.

## First-slice acceptance

1. Register a manager against an existing Git repository.
2. Create a feature branch/worktree without modifying the source checkout.
3. Open a real PTY and run Codex, Claude Code, or a shell. CLI handles provider authentication.
4. Run `soull finding create` from that environment, then see the finding in the manager inbox.
5. Read the real diff, open a text file, and save an edit inside the correct worktree.
6. Reload UI and reconnect to the session; durable records survive service restart.
7. Build native shell; document what remains deferred rather than mock it as complete.

## Conversation extension — 2026-11-16

- Keep the incumbent dark macOS design system. Prioritize readable final answers, disclose progress/tools, stream plain text and parse Markdown after settlement.
- Persist feature-scoped turns and provider session IDs in SQLite. Serialize turns per feature with up to eight queued prompts; incremental polling and 100 ms write batching keep streaming out of the main app snapshot. Load history in 30-turn pages, including older pages needed to restore a saved reading anchor.
- Keep drafts/read markers in browser-local storage and reading position in session storage; these are UI preferences, not durable service records. UI reloads leave provider execution running.
- Offer only supported Codex command/file-change approvals, scoped to the live request. Claude print-mode permissions remain in Claude Code configuration; surface denied tools and offer Terminal. Do not widen permissions to achieve parity.
- Stop interrupts execution; service recovery marks unfinished/queued records interrupted and expires approvals. No automatic replay or retry. A new user message can continue the saved provider session.
- Local Codex `0.167.0-alpha.4` passed initialization only, without inference/account calls. Synthetic adapters/service/browser tests cover behavior; real signed-in subscription smoke tests for both providers remain required. Claude was not installed, and native macOS build validation was unavailable on Linux without Swift.


## Guided diff explanation extension — 2026-11-17

- Extend the existing Guided diff and design system with manual summary/per-file what, why and risks. AI prose remains unverified guidance; GitHub PR descriptions, logical ordering and test evidence/coverage mapping remain deferred.
- Capture revision provenance in the service: feature base, full HEAD, working diff, tracked/untracked content hashes, file modes, deletions and symlink targets without dereferencing. Omit binary contents from provider input. Bind the displayed file diff to its captured revision and disclose stale, unsaved or unreadable state rather than claiming currency.
- Use a new provider session for each explanation, separate from normal manager Conversation history, while reusing installed CLI sign-in/configuration. Never read provider tokens or host a login proxy. Codex uses read-only sandboxing and approvalPolicy never, which does not disable every tool. Claude uses `--tools '' --disallowedTools '*'` to disable built-in and MCP tools; see [Claude CLI reference](https://code.claude.com/docs/en/cli-reference). The description-only prompt forbids tools/tests/edits; approval requests fail without access being granted.
- Validate nonempty bounded summary/per-file fields and exactly one result for every captured path. Preserve the last successful explanation when regeneration fails or stops. Persist snapshots/jobs/results in SQLite; interrupt unfinished jobs after service restart without automatic replay. Discuss with manager appends revision and untrusted AI context to a draft without sending.
- Bound requests to 100 files, 1 MiB per regular file, 2 MiB combined reads, 160,000 diff bytes, 180,000 snapshot bytes, five minutes and 100,000 response characters. See [implementation](../service/reviews.mjs), [UI](../ui/Explanation.tsx), [review tests](../tests/reviews.test.mjs) and [browser fixture](../tests/browser/reviews.mjs). Synthetic checks establish local behavior, not real subscription access. Signed-in provider smoke tests and a native Mac build remain outstanding; Swift was unavailable in the Linux environment.


## Needs you extension — 2026-11-18

- Extend the established dark macOS interface with a manager-wide question tray spanning tasks/features. Waiting on you, Can continue and Needed later express attention timing independently of read state and resolution. Preserve the incumbent design system.
- Route durable questions through task records, not a new autonomous worker scheduler. Existing feature conversations stay serialized; manager instructions encourage native subagent delegation and publishing questions before continuing or ending the turn. Workers retrieve answers through their task mailbox independently of the main chat queue; the next manager turn receives routing metadata.
- Separate Open, Answered and Applied. User submission starts no model call and never fabricates Applied. Only the owning task acknowledges the exact current answer version after receipt/use; this is agent-declared acknowledgment, not verified execution. Use optimistic question revisions, idempotent answer request IDs and immutable answer-version audit records. Reject wrong-task and stale-version acknowledgment.
- Offer quick choices/custom replies and isolated read-only question discussion. Discussion cannot grant tool permissions or submit a decision. Persist durable questions, answers and discussion turns in SQLite; keep drafts and UI preferences in browser-local storage.
- Defer open questions by time or exact task-scoped milestone without resolving them. Timed deferrals return on reads/polls. Support explicit dismissal, reopening and Applied/dismissed history in 30-item pages using a durable monotonic completion-order cursor, preserving older pages as new questions close.
- Bound new questions to five choices and 12,000 context characters; omit context from lists. Limit new authoring to 200 unresolved questions per manager. Adopt all legacy question findings once, preserve originals and retain access above that cap. Prior resolved findings become dismissed, never Applied.
- Capture supported native Codex item/tool/requestUserInput and structured Claude AskUserQuestion requests into durable records. Retain the native source on the task, deduplicate requests per source and turn, and keep different workers distinct. Include that source in subsequent manager routing metadata. Codex receives an explicit error directing the task to its mailbox, without inventing a user answer; Claude child question requests are captured without exposing child prose as manager replies. Keep the CLI reporting protocol reliable for unsupported requests. Do not scrape terminal output or handle provider credentials.
- Synthetic service/provider checks and all three browser suites exercise local behavior. Signed-in subscription smoke tests and a native macOS build remain outstanding; Linux validation cannot establish native shell behavior. See README.md for protocol and operational boundaries.
