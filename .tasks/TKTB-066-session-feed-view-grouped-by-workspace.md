---
id: TKTB-066
title: Session feed view (grouped by workspace)
status: backlog
tags:
  - ui
  - workspace
  - agent-experience
  - v1-foundations
  - agent-editor
created: '2026-04-08T05:18:14.789Z'
updated: '2026-04-12T03:56:55.429Z'
---

## Context

A simple view that shows all terminal sessions grouped by workspace, with status indicators. This is the first UI that makes the workspace model tangible — the developer can see at a glance what's running where.

This is NOT the full PLAN-003 session feed with flexible layout, drag-to-dock, or pin-vs-follow. It's a minimal prototype to validate the concepts and surface the session data we're collecting.

## UI design

### Session feed (new view/route or panel)

**Grouped by workspace:**
```
ticketbook (main)
  └─ Session 3 — claude code — idle 5m — TKTB-046
  └─ Session 5 — zsh — active

ticketbook / feature-auth
  └─ Session 7 — claude code — active — TKTB-064

other-project (main)
  └─ Session 8 — aider — needs attention (exit code 1)
```

**Per session, show:**
- Session name or ID
- What's running (derived from the initial command or process name)
- Status: `active` (commands running), `idle` (no recent output), `needs-attention` (last command failed), `ended`
- Linked ticket (if any) — clickable
- Duration / last activity timestamp

**Per workspace, show:**
- Display name (repo + branch)
- Number of active sessions
- Last activity

### Status derivation

Status comes from the session event stream (TKTB-054):
- `active`: a command is currently running (we got `commandStart` but no `commandEnd`)
- `idle`: last command ended successfully, no new commands for > 30s (configurable)
- `needs-attention`: last command exited with non-zero code
- `ended`: session/PTY closed

### Interactions

- Click a session → opens/focuses that terminal tab
- Click a workspace → expand/collapse its sessions
- Click a linked ticket → navigates to ticket detail
- "Link ticket" action on a session → opens a picker to associate a ticket
- Workspaces sorted by last activity (most recent first)

## Where it lives

Two options (can support both):
1. **Activity bar explorer** — a new icon in the left sidebar that shows the session feed as an explorer panel (like PLAN-003 describes, but simpler)
2. **Home page section** — add a "Sessions" section to the existing home view

Start with option 1 (sidebar explorer) since it's always accessible regardless of what route you're on.

## Dependencies

- Workspace model ticket (for workspace data)
- TKTB-055 (for session persistence)
- TKTB-054 (for status derivation from events — can stub without it, showing all as "active")

## Non-goals

- Flexible layout / dockview — that's PLAN-003 / desktop app
- Session detail view — clicking goes to the terminal tab for now
- Cross-session search — follow-up
