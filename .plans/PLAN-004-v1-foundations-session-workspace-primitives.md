---
id: PLAN-004
title: V1 Foundations — Session & Workspace Primitives
status: active
tags:
  - v1
  - foundations
  - agent-experience
  - architecture
project: ticketbook
tickets:
  - TKTB-054
  - TKTB-055
  - TKTB-064
  - TKTB-065
  - TKTB-066
  - TKTB-067
  - TKTB-046
  - TKTB-056
  - TKTB-068
  - TKTB-041
created: '2026-04-08T05:17:04.298Z'
updated: '2026-04-09T05:15:01.829Z'
---

# V1 Foundations — Session & Workspace Primitives

> **Status:** active. This plan defines what to build in the current web app before transitioning to the native Mac desktop app. Everything here is chosen for high carry-over: the data models, server logic, MCP tools, and interaction patterns all transfer directly to the desktop app as-is. The web UI serves as a prototype for validating concepts.

## Thesis

**Workspace = git worktree** is the organizational primitive. Agent sessions are automatically grouped by which worktree/branch they're running in. We observe agents rather than orchestrate them — no rigid framework, just structured data from terminal event streams that the UI and MCP tools can surface.

This is the "Intent by Augment" philosophy without the heavy orchestration: automatic association via the environment the agent is running in, not a custom agent runtime the agent must opt into.

## The primitives

### 1. Session (the keystone)

A session is a terminal process running in a specific directory. We observe it via OSC 133/633 shell integration to get structured events: command starts/ends, exit codes, cwd changes. Sessions are persisted in SQLite with their event streams.

A session is NOT an agent — it's the environment an agent runs in. Claude Code, Codex, Aider, or a plain shell all produce sessions. The agent is opaque to us; the terminal events are what we see.

### 2. Workspace (the grouping)

A workspace is a discovered git context: `{ repoRoot, worktree?, branch }`. Workspaces are discovered lazily — when a terminal session starts, we resolve its cwd to a git repo/worktree/branch and that becomes its workspace. No config, no scanning.

Within a workspace, sessions are the children. Tickets and plans can also be scoped to a workspace (the project already maps to this loosely). The workspace is the natural grouping because it's how developers already organize: one worktree per task, one branch per feature.

**For graphite stacks + worktrees:** a repo is the parent workspace, and each worktree is a sub-context within it. The UI can show the stack relationship (branch parent chain) alongside the worktree grouping.

### 3. Session-ticket linking

A session can be linked to a ticket. This can happen:

- **Automatically:** if a ticket was "active" in the UI when the terminal session started
- **Manually:** user links via a chip in the terminal pane or via MCP tool
- **By agent:** the agent calls `link_session_to_ticket` via MCP

This is what makes "what did the agent do on this ticket?" answerable.

### 4. Agent feedback loop

When an agent finishes work on a ticket, the session data (commands run, exit codes, files changed) feeds into the review workflow. The `feedback` status between `in-progress` and `done` signals the human to validate. The diff review UI is scoped by session — showing exactly what changed during that session, not a raw git range.

## Phases

### Phase 1: Session observation layer

The data foundation. Terminal emits structured events, we persist them.

- **TKTB-054** — OSC 133/633 shell integration (emit structured SessionEvents)
- **TKTB-055** — SessionRecord model in SQLite (persist events, link to tickets)
- **New: Worktree/branch detection** — resolve session cwd → git repo/worktree/branch automatically

### Phase 2: Workspace grouping & UI

The organizational layer. Sessions grouped by workspace, visible in the UI.

- **New: Workspace model** — define the workspace primitive, discovery logic, persistence
- **New: Session feed view** — simple list of sessions grouped by workspace with status indicators

### Phase 3: Agent feedback loop

The validation layer. Human can review what the agent did and close the loop.

- **TKTB-046** — feedback status + agent debrief + confidence levels
- **TKTB-056** — diff review UI scoped by session

### Phase 4: MCP expansion

Make sessions a first-class primitive for agents to interact with.

- **New: Session MCP tools** — CRUD for sessions, linking, event queries

## What this plan is NOT

- Not the flexible layout system (PLAN-003) — that's desktop app work
- Not a custom agent runtime (TKTB-050) — we observe, we don't orchestrate
- Not ambient agents (TKTB-049) — needs the runtime first
- Not plugins (TKTB-061) — rendering model is platform-specific

## What "done" looks like

- Terminal sessions automatically tagged with repo/worktree/branch
- Sessions persisted with structured event streams in SQLite
- Sessions groupable by workspace in the UI
- Sessions linkable to tickets (manual + automatic + via MCP)
- `feedback` status in the ticket lifecycle with agent debrief
- Diff review scoped by session
- MCP tools for session CRUD and queries
- All data models and APIs ready to be consumed by a native Mac app client
