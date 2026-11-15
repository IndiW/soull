# Soull design system

## Direction

Approved direction: dark-only native Mac mission control with minimalist code-drawn robot managers, a graph, readable briefings, and a Guided diff editor. The user works across several projects in long coding sessions and explicitly prefers dark mode. Charm comes from character identity and language, not persistent animation.

## Palette and typography

Restrained violet-tinted charcoal neutrals, lavender primary accent, mint success and peach attention. Use OKLCH tokens in the interface. Warm near-white text, no pure black or white. System sans for UI, system monospace for code. Prose capped at 72ch, 15px comfortable body, 12px metadata, 20–28px section headings.

## Layout

Sidebar holds managers, Inbox and settings. Main content has persistent manager context and primary tabs. Terminal occupies the main pane. Guided diff adds a change navigator and optional coordinator companion. Collapse supporting navigation to focus on code. Use separators and whitespace over repeated nested cards.

## Components

SVG robot avatar with deterministic color and silhouette. Names and accessible text statuses accompany avatars. Clear active navigation, keyboard focus, real loading/empty/error states. Findings have separate unread and resolved state. Never communicate meaning only through color.

## Interaction

Preserve selected manager/feature/view and drafts across refresh. Explain operational failures inline. Confirm destructive cleanup using evidence about dirty/unpushed work. Copy selected conversation text on mouse release only, with feedback and an opt-out. Open file links at worktree-relative file and line. Honor reduced motion; transitions are short and convey state.

## Initial design reference

`docs/design/initial-review.png` is the latest accepted generated concept, originally labeled Soul. The product name is now **Soull**. It is a direction reference, not a pixel-perfect specification. Numeric usage/test data are illustrative, not real. The concept contains placeholder inconsistencies (file counts and diff revision labels); implementation must derive these from actual data.
