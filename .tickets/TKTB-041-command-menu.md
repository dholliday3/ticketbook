---
id: TKTB-041
title: Command menu
status: open
tags:
  - ui
  - navigation
  - v1-foundations
relatedTo:
  - TKTB-068
  - TKTB-065
created: '2026-04-04T07:38:20.246Z'
updated: '2026-04-08T05:51:56.971Z'
---

## Context

A command menu (Cmd+K) that serves as the universal navigation and action hub. This replaces the current search shortcut and becomes the primary way to find and navigate to anything in the app — especially important once the workspace view (TKTB-068) exists, because items live in different contexts (workspaces, tabs, views).

## Core behavior

### Search across everything
The command menu is a single search input that finds:
- **Tickets** — by ID, title, or body text
- **Plans** — by ID or title
- **Sessions** — by workspace, branch, or linked ticket
- **Workspaces** — by repo name or branch

Results are grouped by type with section dividers:
```
Sessions
  ticketbook/feat-auth — Session 7 (active)
  ticketbook/main — Session 3 (idle)

Tickets
  TKTB-054 — Terminal session event stream
  TKTB-055 — SessionRecord model

Plans
  PLAN-004 — V1 Foundations
```

### Navigation — open in context
Selecting a result opens it in the right place:
- **In workspace view:** opens as a tab in the center panel. If the item belongs to a workspace (e.g., a session), navigates to that workspace first.
- **In ticket/plan views:** opens in the existing detail panel (current behavior).
- A result can indicate which workspace it belongs to, so the user knows where they'll land.

### Context-aware actions
Like Linear, the top section changes based on current context:
- **With a ticket open:** "Change status", "Set priority", "Link to session", "Delete"
- **With a session tab active:** "Link ticket", "View diff", "Copy branch name"
- **No context:** "New ticket", "New plan", "Open terminal", "Settings"

### Agent kickoff commands
Carry over the original idea:
- "Work on open tickets" — copies a structured prompt with ticket IDs for pasting into a terminal, or opens a session tab with the prompt pre-filled
- "Work on TKTB-054" — same but scoped to one ticket
- "Review session" — opens the diff for the active session

### Sections with dividers
Keep it organized for growth:
```
Recent
  [recently opened items]
──────────────
Actions
  New ticket          C
  New plan            C (in plans view)
  Open terminal
  Settings
──────────────
Navigate
  Tickets view
  Plans view
  Workspaces view
──────────────
Search results...
```

## Implementation

### Keyboard
- `Cmd+K` — open command menu (replaces current search focus behavior)
- Type to filter/search
- Arrow keys to navigate results
- Enter to select
- Esc to close
- `>` prefix for actions-only mode (like VS Code's `>`)

### UI
- Modal overlay with search input at top
- Grouped results below with section headers
- Each result shows: icon (type indicator), title, subtitle (context), keyboard shortcut if applicable
- Fuzzy matching on title/ID

### Library
Consider cmdk (patak-dev/cmdk) — it's the standard React command menu library, used by Linear, Vercel, etc. Handles the search, keyboard nav, grouping, and rendering patterns.

## Dependencies

- TKTB-068 (workspace view) — for workspace-aware navigation. Command menu can ship before the workspace view, but the "open in workspace tab" behavior needs TKTB-068.
- TKTB-065 (workspace model) — for searching across workspaces/sessions

## Incremental path

1. **v1:** Cmd+K opens command menu with ticket/plan search + basic actions (new ticket, settings, navigate). Replace current search shortcut.
2. **v2:** Add session/workspace search once backend lands (TKTB-065)
3. **v3:** Context-aware actions based on active item
4. **v4:** Agent kickoff commands
