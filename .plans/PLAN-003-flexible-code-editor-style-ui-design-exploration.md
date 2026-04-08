---
id: PLAN-003
title: 'Flexible code-editor-style UI: design exploration'
status: draft
tags:
  - desktop-app
  - ui-architecture
  - deferred
  - v2
project: ticketbook
created: '2026-04-06T10:52:05.260Z'
updated: '2026-04-08T05:20:45.708Z'
---

# Flexible code-editor-style UI: design exploration

> **Status:** design exploration. No implementation yet. The goal of this plan is to lock in the *primitives* before any layout code gets written. Treat every section as editable — push back, cut, rearrange.

## Why this exists

Today's UI is rigid. `__root.tsx` hardcodes a header + `<Outlet />` + optional right-side terminal. Each route (`/tickets`, `/plans`, `/`) owns its own layout and URL schema, and the tickets route hardcodes the list-vs-detail split. There are two unrelated tab systems (one for ticket/plan tabs in the detail pane, one inside `TerminalPane` for terminal sessions). The terminal's open state and width live as globals on `AppContext`.

This works for "task tracker with a terminal bolted on." It does not work for the direction we're heading: a workspace where humans orchestrate many agent sessions across many projects, and the UI fluidly reshapes around whatever the user is doing right now.

## The reframe: session is the noun, not the file

VS Code's whole spatial model orbits one thing: the file tree of a single project root. Sidebar = files. Tabs = open files. Status bar = the file's git status. Everything is a *projection of the file under cursor*.

Our model needs to orbit a different noun: **the agent session**. A session has a project, a worktree, a branch, a live output stream, a status, linked tickets/plans, and a working diff. Files, CI, diffs, tickets — those become *projections of the active session*, not projections of a file. And critically, sessions aren't constrained to one project root, so the whole "single workspace folder" assumption falls away.

This is the single most important reframe in this plan. Everything below follows from it.

## Primitive 1: the view registry

A view is a pure function of `(viewType, params)`. You register each view type once. Views split into two categories:

**Global views** (don't need a session):

- `home`
- `tickets.list` — params: `{ filters, sort }`
- `tickets.board` — params: `{ filters }`
- `plans.list`
- `sessions.feed` — live list of agents, sorted by needs-attention
- `projects.list` — known repos, worktrees, branches
- `search` — cross-project search
- `prompts.list` / `skills.list` — for quick injection

**Session-bound views** (need a `sessionId`):

- `session.overview` — header card with project/branch/status
- `session.terminal` — live PTY
- `session.diff` — working tree diff for this session's worktree
- `session.files` — file tree rooted at this session's worktree
- `session.ci` — GitHub Checks for this session's branch
- `session.timeline` — structured event stream (OSC 133/633, see TKTB-054)
- `session.linked-tickets` — tickets tied to this session
- `session.plan` — plan that spawned this session, if any

**Record-bound views** (need an id of a specific record):

- `ticket.detail` — params: `{ ticketId }`
- `plan.detail` — params: `{ planId }`

Each registry entry exposes:

```ts
{
  component: React.ComponentType<{ params; binding? }>;
  titleFor(params, binding): string;
  iconFor(params, binding): ReactNode;
  canClose: boolean;
  category: "global" | "session-bound" | "record-bound";
}
```

The registry is the extension point. New primitives drop in here without touching layout code.

## Primitive 2: layout tree (splits + groups)

A recursive structure, fully serializable:

```ts
type LayoutNode =
  | { kind: "split"; axis: "row" | "col"; sizes: number[]; children: LayoutNode[] }
  | { kind: "group"; tabs: Tab[]; activeTabId: string };

type Tab = {
  id: string;
  viewType: string;
  // only meaningful for session-bound views:
  sessionBinding?:
    | { mode: "pinned"; sessionId: string }
    | { mode: "follow" };
  params?: Record<string, unknown>;
};
```

Top/bottom/side panels are just splits with a group at the edge. Splitting the center is replacing a group with a `split` of two groups. Drag-to-dock is a tree edit. That's it. Once this schema is locked, the layout engine becomes a mechanical concern (see "Library choice" below).

## Primitive 3: pin vs. follow (the multi-project unlock)

This is the part that matters most for cross-project work. Every session-bound view has a binding mode:

- `{ mode: "pinned", sessionId: "abc" }` — locked to one specific session forever
- `{ mode: "follow" }` — re-renders whenever the workspace's `activeSessionId` changes

So:

- Put a `session.diff` panel on the right with `mode: "follow"`. Click between sessions in the feed. The diff panel updates automatically.
- Want to compare two sessions side-by-side? Split the center, put two `session.terminal` tabs there, pin each to its own `sessionId`.

VS Code does this for the file explorer ("follow active editor" toggle). We do it for *every* session-bound view, because the whole UI is session-aware.

This single concept — pin vs. follow — is what lets us fluidly jump between agents in different directories/projects/branches without the UI getting confused about "which directory am I in right now."

**Open question:** when two session-bound views are pinned to different sessions and one of them gets focus, does that update `activeSessionId`? Probably yes — focus drives active. But we should be deliberate about it.

## Primitive 4: workspace = layout, not folder

VS Code's "workspace" means a folder. Ours can't, because a single workspace might host sessions in 3 different repos. A workspace in Ticketbook is just **a saved layout + the set of pinned things in it + the active session**. No root directory.

```ts
type Workspace = {
  id: string;
  name: string;
  layout: LayoutNode;
  activeSessionId?: string;  // what "follow" resolves to
  // future: per-workspace filters, saved searches, etc.
};
```

Examples of workspaces a user might create:

- **"Morning review"** → 4 `session.diff` tabs pinned to today's PR sessions across 2 repos
- **"Feature: auth rewrite"** → `plan.detail` center-left, 2 `session.terminal` tabs center-right, `sessions.feed` in the bottom panel filtered to that plan's sessions
- **"Triage"** → `tickets.list` left, `sessions.feed` right, empty center
- **"Default"** → what you boot into

Workspaces are cheap to create, swap, and share. They become the unit of context, replacing both "what folder am I in" and "what tab layout did I have last time."

## Primitive 5: activity bar swaps explorers

VS Code's left rail toggles which explorer shows in the sidebar (Files / Search / SCM / Run / Extensions). Same idea, different explorers:

- **Sessions feed** — the live agent feed with status dots, project/branch labels, and last-output preview. Sorted by needs-attention. *This is the centerpiece.*
- **Tickets** — current ticket list, filterable
- **Plans** — current plan list
- **Projects / worktrees** — every known repo + worktree + branch you've touched, so jumping across is one click
- **Search** — cross-project search across sessions, tickets, plans, files, agent output
- **Saved prompts / skills** — for quick injection into a session

Clicking anything in an explorer either opens it as a tab in the center (default), or — with a modifier — pins it into a side panel. This is the affordance: "easy to bring a session or a plan or tickets into the main view."

## What this means for the URL model

Today: `/tickets?view=board&status=…&project=…` — route-level filters in the URL.

Tomorrow: routes go away (or shrink to almost nothing). Filters become `params` on a `tickets.list` tab inside the layout. URLs become one of:

- `/` — restore last workspace
- `/w/:workspaceId` — open a named workspace
- `/share/:layoutBlob` — deep-linkable serialized layout for sharing

This is the biggest break from the current architecture. Worth being explicit about it before committing. **Open question:** do we need to keep `/tickets` and `/plans` URLs working as a transitional concession, or do we accept the break?

## Library choice (deferred)

Two realistic paths once the schema above is locked:

**Path A — Compose from primitives** (`react-resizable-panels`) We own the layout tree, tab strips, drag-and-drop, and persistence. Highest control, cleanest fit with the project's "primitives you opt into" ethos, most code. Drag-to-dock between groups is the part we'd build ourselves — non-trivial.

**Path B — Adopt** `dockview-react`Purpose-built VS Code clone: groups, tabs, splits, drag-to-dock, floating panels, serialization — all there. Thin adapter maps our view registry to dockview's panel API. \~80% done in a day. Downside: inherited styling/opinions and dependency weight.

**Recommendation:** Path B for the first cut. Treat dockview as scaffolding. The view registry, session schema, and workspace schema are what's durable — the dock engine is replaceable. Once we know which primitives matter, we can decide whether to swap to Path A.

This decision is explicitly *deferred* until the schema is settled. Don't pick a library before the primitives are right.

## Open design questions (must resolve before implementation)

1. **What is a session, exactly?** Right now `terminal/sessions` are PTY-backed terminal tabs. Is "agent session" the same primitive (a long-running shell with structured event hooks), or a layer above that links a terminal session to a ticket/plan + records its diff/output history? TKTB-054, TKTB-055, TKTB-056 all hint at this. **The schema we settle on for** `Session` **is the keystone — every side panel reads from it.**

2. **Where does "needs attention" come from?** OSC 133/633 shell integration (TKTB-054)? Idle detection? Explicit agent emit? The feed is only useful if "needs attention" is reliable.

3. **CI integration scope.** GitHub Checks API for the session's branch is the obvious v1. Confirm we want this scoped *per session* (not per project), keyed off `branch`.

4. **Cross-project file tree.** When `session.files` is pinned to a session, it shows that session's worktree. Should there also be a *global* "all known projects" tree as one of the activity-bar explorers? Probably yes, but explicit choice.

5. **Persistence layer.** Workspaces and pinned sessions need to live server-side eventually (we have a server + SQLite). Local-first for now is fine, but the schema should be server-ready from day 1.

6. **Active session resolution across split groups.** When two pinned session views have focus in different groups, which is "active"? Probably last-focused-group's binding wins. Needs to be deliberate.

7. **URL break.** Do we keep `/tickets` and `/plans` as transitional URLs, or accept the clean break to a workspace-only URL model?

## What this plan is NOT

- Not an implementation ticket. No code yet.
- Not a library evaluation. Library choice is deferred until the schema is locked.
- Not a redesign of tickets/plans/terminal as features. They keep working. This is about how they *compose*.
- Not a commitment to dockview. It's a recommendation for the first cut, not a decision.

## What "done" looks like for this plan

- [ ] `Session` schema agreed on (keystone — see open question #1)

- [ ] View registry list reviewed and edited (which views matter, which don't)

- [ ] Pin-vs-follow concept reviewed

- [ ] Workspace schema reviewed

- [ ] Activity bar explorers list reviewed

- [ ] URL break decision made

- [ ] Persistence approach decided (local-first vs. server from day 1)

- [ ] Library decision unblocked (Path A or Path B)

- [ ] Implementation tickets cut from this plan (likely TKTB-060…06x)

Once those boxes are checked, this plan converts into a stack of implementation tickets via `cut_tickets_from_plan`.
