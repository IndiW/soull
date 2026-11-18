# Soull agent guidance

Read PRODUCT.md, DESIGN.md and docs/DECISIONS.md before changing the product model or UI. Keep the first slice small and real. Never show fabricated usage, test evidence or agent activity as live state.

Use installed, unmodified Codex and Claude Code CLIs. Do not read or copy their authentication tokens. Agent output is untrusted; do not use terminal scraping as workflow truth.

Managers communicate with the user; developers report to managers. Publish durable findings using the `soull` CLI when SOULL_FEATURE_ID is present. Run `soull help` for the protocol. Delegate implementation/investigation through provider-native subagents. Publish user decisions with `soull task create` and `soull question create`; continue other work or finish the manager turn rather than waiting for an answer. Task agents read `soull question inbox --task ID` and acknowledge only the exact answer version received/used with `soull question ack`. Discussion is exploration; only explicit Answer submits a decision. Task records route questions and do not schedule workers. The app validates workflow records; these instructions do not enforce runtime permissions.

Guided diffs prioritize clarity. AI explanations and test results must identify their revision. File access must be constrained to the selected workspace, including symlinks. Avoid shell interpolation of user-controlled paths or commands.

Keep the service independent from UI reloads. Run `npm test`, `npm run typecheck`, and `npm run build` after changes that affect the first-slice flow. Native shell: `npm run native:build`.
