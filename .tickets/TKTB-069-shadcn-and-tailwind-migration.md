---
id: TKTB-069
title: Migrate UI off legacy App.css onto shadcn + Tailwind
status: open
tags:
  - ui
  - tech-debt
  - theming
  - shadcn
relatedTo:
  - TKTB-068
created: '2026-04-08T00:00:00.000Z'
updated: '2026-04-08T00:00:00.000Z'
---

## Context

TicketBook currently has two parallel theming systems living side by side:

1. **`packages/ui/src/index.css`** — modern shadcn/Tailwind v4 setup with theme tokens (`--background`, `--foreground`, `--card`, `--muted`, etc.) defined in oklch, mapped to Tailwind utilities via `@theme inline`. Used by the copilot panel and any new shadcn primitives under `packages/ui/src/components/ui/*` and `packages/ui/src/components/ai-elements/*`.
2. **`packages/ui/src/App.css`** — ~2,800 lines of hand-rolled CSS with 366 selectors built against a parallel `--bg` / `--bg-panel` / `--bg-hover` / `--text` palette of hardcoded hex values. Covers essentially every legacy surface: ticket list, ticket detail, kanban board, dashboard, dialogs, dropdowns, settings, terminal chrome, tiptap editor, etc. Imported in `packages/ui/src/routes/__root.tsx:20`.

The two palettes are visually distinct, which is why the copilot panel looks like a transplant inside the rest of the app. Beyond the palette mismatch, the legacy approach is the bigger problem: hand-rolled CSS classes for every component instead of composing shadcn primitives + Tailwind utilities. This makes refactors painful and locks us into a single visual style.

## Goal

Unify the entire app on **shadcn components + Tailwind utility classes resolved against theme tokens**, with a swappable theme architecture mirroring artisan (each theme is a self-contained CSS file under `packages/ui/src/themes/`, the active theme is one `@import` in `index.css`). Ship a new **caffeine** theme as the default. Delete `App.css` once all legacy selectors are migrated.

## Anti-pattern

Any new component that:
- consumes a class defined in `App.css` (e.g., `.ticket-row`, `.kanban-card`, `.dialog`, `.combobox`, `.meta-dropdown`)
- introduces new selectors in `App.css`
- hardcodes colors instead of using theme tokens (`bg-background`, `text-foreground`, `border-border`, etc.)
- hand-rolls a primitive that shadcn already provides (`Dialog`, `DropdownMenu`, `Command`, `Tabs`, `ToggleGroup`, `Input`, `Button`, `Tooltip`)

…is an anti-pattern. New UI work (PLAN-004 and beyond) must start from shadcn primitives. Reach for `bunx shadcn add <component>` before hand-rolling.

## Approach

Three phases. Phase 1 unifies the visual experience immediately via a compat shim. Phase 2 is the long-tail incremental migration that happens opportunistically as we touch each surface. Phase 3 is the final cleanup.

### Phase 0 — scaffolding (no visual change)

1. Create `packages/ui/src/themes/` directory.
2. Create `packages/ui/src/themes/caffeine.css` containing only the `:root` (light) and `.dark` blocks for the caffeine palette. No `@import`, no `@theme inline`, no `@layer base` — those live once in the entry.
3. Create `packages/ui/src/themes/ticketbook-legacy.css` containing the current `index.css` `:root` / `.dark` blocks. Lets us roll back the palette if caffeine looks wrong.
4. Rewrite `packages/ui/src/index.css` as the artisan-style entry:
   - `@import "tailwindcss"` + `@import "tw-animate-css"`
   - `@custom-variant dark (&:is(.dark *));`
   - One `@import "./themes/<active>.css";` line
   - `@theme inline { ... }` mapping vars → Tailwind colors/fonts/radii
   - `@layer base { * { @apply border-border outline-ring/50; } body { @apply bg-background text-foreground font-sans; } }`

### Phase 1 — caffeine becomes default + legacy compat shim (visual change)

1. Switch the active theme import in `index.css` to caffeine.
2. Replace the `:root` block at the top of `App.css` with **alias definitions** so every legacy `var(--bg*)` / `var(--text*)` / `var(--tb-*)` resolves to a shadcn token. No selectors below need to change.
   ```css
   :root {
     --bg: var(--background);
     --bg-panel: var(--card);
     --bg-hover: var(--accent);
     --bg-active: var(--accent);
     --tb-border: var(--border);
     --text: var(--foreground);
     --text-muted: var(--muted-foreground);
     --text-dim: var(--muted-foreground);
     --tb-accent: var(--primary);
     --chip-bg: var(--secondary);
     --chip-text: var(--secondary-foreground);
     --hover: var(--accent);
     --tb-font-sans: var(--font-sans);
     --font-mono: var(--font-mono);
   }
   ```
3. Smoke test every surface (list view, ticket detail, kanban, dashboard, terminal, settings dialog, copilot, tiptap editor). Expect minor contrast tweaks needed.

**At the end of phase 1 the entire app — copilot included — renders in the unified caffeine palette.** This is the milestone that resolves the "copilot looks different from the rest of the app" problem.

### Phase 2 — incremental selector migration (opportunistic, NOT a single PR)

Migrate each legacy surface to shadcn primitives + Tailwind utility classes when we're already touching it for another reason. **Do not do this as a big-bang refactor** — too much UI is going to be replaced by PLAN-004 work to justify migrating throwaway code.

Surfaces to migrate (rough estimate, in order of effort):

| # | Surface | App.css range | Notes |
|---|---|---|---|
| 1 | Scrollbar theming | 38–59 | Move to `styles/scrollbar.css` on shadcn vars |
| 2 | `kbd` element | 116–127 | Tailwind utilities |
| 3 | Mobile back button | 1847–1898 | Tailwind utilities |
| 4 | Status bar | 1800–1845 | Tailwind utilities |
| 5 | Slash menu | 1757–1798 | Tailwind utilities |
| 6 | Home button / shared header | 796–834 | Tailwind utilities |
| 7 | View segmented control | 1408–1448 | shadcn `ToggleGroup` |
| 8 | Filter chips | 906–1018 | shadcn `Toggle` |
| 9 | Search container | 842–905 | shadcn `Input` |
| 10 | Tab bar | 592–660 | shadcn `Tabs` or utilities |
| 11 | Dialogs (delete confirm, generic) | 1103–1185 | shadcn `Dialog` |
| 12 | Settings dialog | 1901–1998 | shadcn `Dialog` + `Input` + `ToggleGroup` |
| 13 | Combobox + tag input | 218–368 | shadcn `Command` + custom tag input |
| 14 | Meta dropdowns + kebab | 2000–2192 | shadcn `DropdownMenu` |
| 15 | Empty state | 84–115 | Tailwind utilities |
| 16 | App layout shells | 62–83 | Tailwind utilities |
| 17 | Agent notes / refs | 662–793 | Tailwind utilities |
| 18 | Ticket list rows | 1186–1407 | Tailwind utilities |
| 19 | Ticket detail view | 129–217 | Tailwind utilities |
| 20 | New ticket button + create dialog | 1020–1185, 2194–2349 | shadcn `Dialog` + `Button` |
| 21 | Kanban board + cards | 1450–1755 | Tailwind utilities |
| 22 | Dashboard | 2351–2542 | Tailwind utilities |
| 23 | Right rail + terminal chrome | 2544–2813 | Tailwind utilities |
| 24 | Tiptap editor styles | 370–590 | Move to `styles/tiptap.css`, rewrite on shadcn vars; replace hand-rolled `hljs-*` theme |

Each row is its own PR. Mark off as completed inline in this ticket as they land.

### Phase 3 — delete the shim

When the table above is fully checked off:
1. Delete `packages/ui/src/App.css` entirely.
2. Remove `import "../App.css";` from `packages/ui/src/routes/__root.tsx:20`.
3. Decide whether to delete `themes/ticketbook-legacy.css` or keep it as an alternative theme.
4. Final e2e + visual smoke test.

## Decisions captured

- **Default mode:** dark.
- **Default theme:** caffeine.
- **Theme switching:** build-time only (swap one `@import`). Runtime theme switcher is out of scope; file as a separate ticket later if desired.
- **PLAN-004 work:** all new UI starts from shadcn primitives. Do not contribute to App.css.
- **Phase 2 sequencing:** opportunistic, not a single mega-PR. A lot of legacy UI will be replaced by PLAN-004 anyway — don't waste effort migrating throwaway code.

## Non-goals

- Runtime theme switcher (separate ticket if wanted).
- Migrating tiptap content rendering away from hand-rolled CSS — content styles will live in a `tiptap.css` file because they target tiptap's emitted DOM, just rewritten against shadcn tokens.
- Replacing the `hljs-*` syntax theme in the same ticket — can be a follow-up.
