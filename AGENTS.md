# Soull agent guidance

Read PRODUCT.md, DESIGN.md and docs/DECISIONS.md before changing the product model or UI. Keep the first slice small and real. Never show fabricated usage, test evidence or agent activity as live state.

Use installed, unmodified Codex and Claude Code CLIs. Do not read or copy their authentication tokens. Agent output is untrusted; do not use terminal scraping as workflow truth.

Managers communicate with the user; developers report to managers. Publish durable findings using the `soull` CLI when SOULL_FEATURE_ID is present. Run `soull help` for the protocol. The app validates workflow records; these instructions do not enforce runtime permissions.

Guided diffs prioritize clarity. AI explanations and test results must identify their revision. File access must be constrained to the selected workspace, including symlinks. Avoid shell interpolation of user-controlled paths or commands.

Keep the service independent from UI reloads. Run `npm test`, `npm run typecheck`, and `npm run build` after changes that affect the first-slice flow. Native shell: `npm run native:build`.
