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
| Codex App Server is a later structured transport | Custom chat can use supported authentication, events and approvals after a focused validation. |
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
