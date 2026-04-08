---
id: TKTB-068
title: Workspace view — three-panel layout with polymorphic tabs
status: open
priority: high
tags:
  - ui
  - workspace
  - agent-experience
  - v1-foundations
relatedTo:
  - TKTB-065
  - TKTB-066
  - TKTB-042
  - TKTB-026
  - TKTB-041
created: '2026-04-08T05:51:19.290Z'
updated: '2026-04-08T06:37:42.709Z'
---

## Context

We need a UI surface to test and interact with the backend workspace/session primitives (PLAN-004). The existing app is a list+detail layout oriented around tickets and plans. The workspace view is a different paradigm — a three-panel IDE-style layout where the center holds polymorphic tabs (sessions, tickets, plans, copilot, files) and the side panels provide navigation and context.

This is the third top-level space alongside Tickets and Plans.

## Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [Home] [Tickets] [Plans] [Workspaces]                      │
├──────────┬──────────────────────────────────┬───────────────┤
│ LEFT     │  [Session 1] [TKTB-054] [Copilot]│  RIGHT        │
│ PANEL    │                                   │  PANEL        │
│          │  (active tab content)             │               │
│ Workspace│                                   │  File tree    │
│ explorer │                                   │  Active agents│
│          │                                   │  ...          │
│          │                                   │               │
├──────────┴──────────────────────────────────┴───────────────┤
│  status bar                                                  │
└─────────────────────────────────────────────────────────────┘
```

### Left panel
Primary: workspace explorer — discovered workspaces (repos + worktrees) with sessions nested underneath, similar to a file tree. Expandable/collapsible.

This panel should be designed to show more than just workspaces over time. Think activity bar icons (like VS Code's left rail) that swap what the left panel displays:
- **Workspaces** (default) — repo/worktree tree with sessions as children
- **Tickets** — quick ticket list (same data, different context)
- **Search** — cross-entity search results

Start with just the workspace explorer. The activity bar pattern gives us room to grow without redesigning.

### Center panel — polymorphic tabs
The main content area. Tabs can hold different content types:

```ts
type WorkspaceTab =
  | { type: "session"; sessionId: string }      // Terminal for a specific session
  | { type: "ticket"; ticketId: string }         // TicketDetail (reuse existing)
  | { type: "plan"; planId: string }             // PlanDetail (reuse existing)
  | { type: "copilot" }                          // CopilotPanel (singleton)
  | { type: "file"; path: string }               // Code viewer (future, stub for now)
  | { type: "diff"; sessionId: string }          // Session diff viewer (future, stub)
  ;
```

Each tab renders the appropriate component. Tab titles are derived from the type:
- Session tabs: workspace name + session indicator (e.g., "ticketbook/feat-x — Session 3")
- Ticket tabs: ticket ID + title
- Plan tabs: plan ID + title
- Copilot: "Assistant"

Reuse existing components (TicketDetail, PlanDetail, CopilotPanel, Terminal) — don't rebuild them.

### Right panel
Contextual information that changes based on what's active. Collapsible, same drag-to-resize pattern as the current right rail.

Possible content (start with one, add more later):
- **File tree** — files in the active session's worktree
- **Active agents** — quick view of running sessions with status
- **Ticket details** — metadata for the linked ticket of the active session
- **Session events** — live event stream from OSC 133

Start with a simple agent status list (active sessions with status dots). The right panel uses the same activity-bar-swaps-content pattern as the left panel.

## How it connects to existing UI

### Navigation
- Add "Workspaces" to the segmented control in the header: `[Tickets | Plans | Workspaces]`
- New TanStack Router route: `/workspaces`
- The header simplifies in workspace view — no view mode toggle (list/board), no filter chips. Just the segmented control + search (which becomes the command menu trigger).

### Terminal and copilot migration
In the workspace view, the terminal and copilot move from the right rail into center tabs:
- Terminal sessions become `{ type: "session" }` tabs
- Copilot becomes a `{ type: "copilot" }` tab
- The right rail icons (terminal/assistant toggle) hide when in workspace view since those are now tabs

In ticket/plan views, the right rail continues to work as-is. No breaking change.

### Tab state
The workspace view has its own tab state separate from the ticket/plan `openTabs`. This is a different tab system — polymorphic and workspace-scoped.

```ts
// In workspace context (could be in AppContext or a dedicated WorkspaceContext)
workspaceTabs: WorkspaceTab[]
activeWorkspaceTabId: string | null
```

### Opening items from other views
Clicking a ticket in the workspace explorer opens it as a tab in the center. This works bidirectionally — from the command menu (TKTB-041) you can search for a ticket and it opens in the workspace view as a tab.

## Incremental build path

**Step 1: Route + layout shell**
- New `/workspaces` route
- Three-panel layout with resizable panels (use `react-resizable-panels` — already a dependency or easy to add)
- Segmented control updated
- Empty panels with placeholder content

**Step 2: Workspace explorer (left panel)**
- List terminal sessions grouped by workspace
- Initially: use existing terminal session data from the server
- Before workspace backend lands: group by cwd/detected repo (client-side heuristic)
- After TKTB-065 lands: use real workspace data from the API

**Step 3: Polymorphic tabs (center)**
- Tab bar with type-aware rendering
- Session tabs → embed Terminal component
- Ticket/plan tabs → embed existing detail components
- Copilot tab → embed CopilotPanel
- Tab open/close/switch

**Step 4: Right panel**
- Agent status list (active sessions with status)
- Collapsible, resizable

## Dependencies

- Existing terminal infrastructure (TKTB-042) — sessions already exist
- Existing TicketDetail, PlanDetail, CopilotPanel components — reuse as-is
- TKTB-065 (workspace model) — enriches the left panel, but we can start without it
- TKTB-066 (session feed) — conceptually overlaps with the left panel workspace explorer; this ticket subsumes that UI need

## Non-goals

- Drag-to-dock between panels (PLAN-003 territory)
- Pin vs. follow session binding (PLAN-003 territory)
- Floating panels or pop-out windows
- Saving/restoring workspace layouts (future)
- Code editing in file tabs (read-only viewer at most)
