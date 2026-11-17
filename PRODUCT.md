# Soull

## Register

product

## Users

A developer who juggles projects, investigations, and features in parallel and manages agents like a staff engineering manager. The initial user has ADHD, switches context frequently, and needs to return to answers without acknowledging them immediately. Soull will be used to develop itself.

## Product Purpose

A local-first macOS agent development environment. Persistent named managers coordinate temporary developers. The user communicates only with managers. Work, decisions, findings, and attention persist independently of agent transcripts. A repository is a resource, not a manager boundary: multiple managers can share a repo, and a manager may oversee multiple features.

## Brand Personality

Playful, calm, companionable. A mission-control game with the clarity and familiarity of good Mac software. Named minimalist geometric robot characters, easily generated in SVG, give managers identity.

## Anti-references

Avoid corporate administration dashboards, illustrated anime portraits, dense terminal-only information architecture, excessive badges, decorative motion, neon cyberpunk, and an interface where everything competes for attention. Light mode is out of scope.

## Design Principles

1. Reduce cognitive load. Lead with outcomes, preserve place, and reveal detail progressively.
2. Managers own communication. Developers report through their coordinator.
3. Keep attention distinct from execution. Unread, blocked, and unfinished are independent states.
4. Guided diffs explain a change before asking the user to judge it.
5. Treat execution resources as temporary and the work record as durable.

## Accessibility & Inclusion

Clear hierarchy, comfortable prose, keyboard access, visible focus, explicit status labels, reduced-motion support, and quiet notifications. Never rely on color alone. Remember drafts and view selection. Conversation selection copies on mouse release, with feedback and an off switch. No conformance certification is claimed.

## Product specification

### Domain

- Manager: persistent name, geometric avatar, remit, repository bindings, provider, conversation, durable decisions and summaries. Explicitly hired and retired by the user.
- Feature: durable objective, dependencies, state, linked ticket/PR, plan, execution history, review evidence, findings and questions.
- Investigation: independently tracked inquiry, linked to its initiating prompt and feature where applicable. Findings return through the manager. Can be promoted to implementation.
- Developer/session: temporary provider execution coordinated by the manager; not a user chat destination.
- Workspace: worktree, branch, environment profile, running processes, editor state. A feature can need multiple sessions.
- Attention item: answer, decision, manual follow-up, finding, or PR-ready notification, with separate read and resolution state.

### Core experience

Dark manager roster with names and minimalist robot avatars. An interactive project/feature dependency graph provides overall progress. Main-pane views: Map, Conversation, Terminal, Guided diff, Code. Terminal is a primary view, not a mandatory bottom drawer. Coordinator context can be shown in a collapsible companion panel.

Prompt routing expresses Continue, Delegate, or Investigate intent. Codex/Claude Code own subagent orchestration. Soull tools communicate structured results to the application; instructions alone do not guarantee delivery or enforce runtime permissions.

Feature-scoped manager conversations use installed Codex App Server or Claude Code streaming print mode, with durable turns and provider session continuation. They support outcome-first hierarchy, expandable evidence, multiple outstanding prompts, explicit read/unread markers, remembered browser-local drafts and reading position, internal file links to the correct worktree and line, and copy-on-selection. Terminal rendering can only support the interactions its provider exposes; do not promise rich conversation behavior from raw PTY output.

### Guided diffs

The goal is reduced cognitive load and maximum clarity, not merely a syntax-colored diff. Show PR description, grouped file changes, per-file AI explanations (what, why, risks), and test evidence. Offer logical data-flow order and category order (contracts, UI, backend, tests, evals, infrastructure, docs). Include unified/side-by-side diff, editable source, reviewed markers, and navigation back to the originating manager.

Explanations identify the exact revision/diff they describe and become stale when it changes. Related tests identify the basis of association (explicit, coverage, import, naming, or AI inference), source (local/CI), revision, time, and passed/failed/skipped/not run/stale state. A passing test suite is not proof of file coverage. AI ordering is a suggested reading order, not a proven dependency graph.

### GitHub, workflows, environments

GitHub issues, PR descriptions, review/check state and merges are first-class records. Keep agent-reported readiness distinct from GitHub evidence. Visual workflows inspect implementation, tests, independent review, revision and readiness. Start with definitions plus an inspector before a full node editor.

Shareable workspace environment recipes layer project defaults, named profiles, workspace overrides and secret references. Values stay in a secret provider. Support Automic Vault-style operation-scoped access through integration rather than building a vault. Never put credentials in a committed environment recipe or transcript.

### Usage

Show provider-reported subscription usage and reset times where available. Clearly distinguish estimates and unavailable data. Do not invent per-manager or per-feature attribution.

### Completion and cleanup

Lifecycle: merged → cleaning up → archived. Stop workspace processes, retire developer sessions, remove eligible worktrees/local branches and release temporary environment resources. Retain decisions, findings, PR links and evidence. Block cleanup on dirty/unpushed changes or shared resources; expose the specific exception. Cleanup never means deleting the feature history.

### First usable slice

Create a manager attached to a local repository, create a feature and isolated git worktree, launch an installed Codex or Claude Code CLI with its own authentication, publish a finding using `soull`, collect it in an inbox, inspect the working diff and edit source. Establish a native shell and independent local service so UI reloads do not kill sessions. No sample evidence or pretend usage data in the working app.

### Deferred

Full Guided diff intelligence, plan accounting, GitHub sync, automatic merge cleanup, graphical workflow editing, environment/secret providers, graph editing, richer provider interactions and conversation virtualization, and production packaging are follow-on slices. First-slice limitations must be visible and documented.

## References

- Agentastic: https://www.agentastic.dev/ (editor and review inspiration)
- Automic Vault: https://github.com/automic-vault/automic-vault
- Initial visual direction: docs/design/initial-review.png
