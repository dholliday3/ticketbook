# Agent Workspace: Foundation

A developer cockpit for the agent era. Plan, delegate, observe, and ship — all from one keyboard-driven workspace.

---

## What This Is

A tool that makes a single developer orchestrating multiple agents feel less like chaos and more like flow. It replaces the current workflow of bouncing between planning tools, terminal tabs running agent sessions, CI dashboards, and code editors with a single workspace where all of that happens together.

It is not a code editor. It is not a terminal emulator. It is not a project management tool. It is the connective tissue between all of these — the place where you think, delegate, observe, and decide.

---

## Core Primitives

Three primitives. Everything is built on these.

### Work Item

The universal unit of work. Scale-agnostic — a one-line bug fix and a 500-line PRD are both work items. A work item has: a title, a body (freeform markdown, from one sentence to a full plan), a status, relationships to other work items, and zero or more linked sessions.

Work items live in a **backend**. The default backend is ticketbook — local, git-based, zero-config, files in `.tickets/`. Additional backends (Linear, GitHub Issues) can be connected and appear alongside ticketbook items in a unified view. The workspace doesn't own the work items; it renders and interacts with them through a backend interface. Quick capture always writes to ticketbook first (instant, local, no network) and items can be promoted to external backends when they need team visibility.

### Session

An agent execution. A session wraps a headless agent process (Claude Code, Codex, or others) and tracks its lifecycle: running, waiting for input, completed, failed. Sessions have an event log that persists, so you can review what happened or resume interrupted work. Sessions are optionally linked to a work item — the work item is the "why," the session is the "how."

### Document

A file — usually markdown — that you co-author with an agent. Plans, PRDs, tickets, CLAUDE.md, agent skills. Documents are the artifacts of planning and configuration. They can be edited directly, annotated with inline comments, and refined through an adjacent agent conversation.

---

## The Agent Harness

This is the architectural core: how the workspace integrates with coding agents.

### The Provider Model

The workspace doesn't run agents itself — it orchestrates them through a **provider** abstraction. A provider is a module that knows how to start, communicate with, and manage a specific agent tool. Claude Code is the first provider. Others (Codex, Aider, custom agents) follow the same interface.

A provider handles three concerns:

**1. Lifecycle management.** Starting an agent process, monitoring its health, stopping it, resuming it. Each provider knows its agent's specific invocation (CLI flags, server mode, environment variables) and translates the workspace's generic "start a session" request into the right subprocess call.

**2. Event streaming.** Translating the agent's native output into a canonical event format the workspace understands. Every agent emits output differently — structured JSON, JSON-RPC, raw text, mixed protocols. The provider normalizes all of it into workspace events: `reasoning`, `tool_call`, `file_change`, `approval_request`, `progress`, `session_complete`, etc. The workspace renderer only knows the canonical format.

**3. Control and feedback.** Sending human input back to the agent — approving actions, denying with feedback, providing mid-session direction, injecting context. Each agent has a different mechanism for receiving input (stdin, hook responses, API calls, tool results). The provider translates the workspace's generic "send feedback" action into the right agent-specific call.

### What the Workspace Provides to Agents

Regardless of provider, the workspace offers context and tooling to every agent session through whatever mechanism the provider supports (MCP, prompt injection, environment, filesystem):

- The linked work item's full body (the plan/task description)
- The parent work item's body (broader project context)
- Active sibling sessions and what files they're touching (conflict prevention)
- The relevant agent config files

This context assembly happens automatically when a session is spawned from a work item. The agent starts with full situational awareness.

### Claude Code as First Provider

Claude Code is exceptionally well-suited as the first provider because of its rich integration surface: structured streaming JSON output for event normalization, a hook system for lifecycle interception and control flow, MCP for bidirectional tool access, plugin packaging for clean distribution, and persistent session IDs for resume/replay. These map cleanly onto the three provider concerns above. But the workspace's internal architecture never assumes Claude Code — it speaks the canonical event format everywhere. The Claude Code specifics live entirely inside its provider module.

See the **Technical Design Document** for the provider interface definition and how other agents would implement it.

---

## The Workspace UX

### Three Zones

```
┌──────────┬──────────────────────────────────┬─────────────┐
│          │                                  │             │
│   RAIL   │          WORKSPACE               │    PANEL    │
│          │                                  │             │
│  (⌘B)   │   (tiling panes: shell,          │  (⌘⇧D/C/S) │
│          │    agent session, doc+agent)     │             │
│          │                                  │             │
└──────────┴──────────────────────────────────┴─────────────┘
```

**Left Rail** — the work stack. Shows all active sessions (with status: running/waiting/done/failed), recent completed work, captured tasks, and agent config. Everything glanceable. Toggles with `Cmd+B`.

**Center Workspace** — tiling panes, arranged however you want. Split horizontally, vertically, tab, zoom. Keyboard-driven (`Cmd+\` split right, `Cmd+Shift+\` split down, `Cmd+Shift+Z` zoom). This is where you do the actual work — watching agents, co-authoring plans, running shells.

**Right Panel** — contextual overlays that slide in and out. Quick reference without disrupting your layout. Each has its own shortcut, press again to dismiss:

- `Cmd+Shift+D` — git diff for the focused session's branch
- `Cmd+Shift+C` — CI status for the current PR
- `Cmd+Shift+S` — session summary (auto-generated catch-up)
- `Cmd+P` — file finder with live preview (television-style)
- `Cmd+Shift+.` — agent config (CLAUDE.md, active skills) for the focused session

### Pane Types

**Shell.** Real terminal emulation. Full VT100/ANSI, your shell, your aliases, your tools. No compromise — if it can't run `vim` or `htop`, developers will keep a separate terminal open and the workspace loses its gravitational pull.

**Agent Session.** Rich rendering of a headless agent process. The streaming JSON events from the agent are rendered as structured content blocks:

- Reasoning/narration as readable prose
- Tool calls as collapsible cards (file reads, writes, shell commands)
- Diffs with syntax highlighting, expandable/collapsible
- Progress indicators showing phase and step count
- Approval prompts surfaced inline with context and action buttons
- An input bar at the bottom for feedback/course correction mid-session

The header shows: session name, linked work item, branch, mode, status, elapsed time. Even in a small pane, you can identify what's happening at a glance.

**Document+Agent.** Side-by-side: a rendered, editable document on the left, an agent conversation on the right. This is the native plannotator experience, generalized beyond plan mode.

You edit the document directly. You leave inline comments on any section (`Cmd+M` to mark, type comment, `Enter`). Comments flow to the agent as contextualized feedback — "User commented on the Architecture section: 'Should this be async?'" The agent responds in the conversation thread and can modify the document in real-time. Changes appear as they're made — insertions fade in, deletions fade out.

This pane works for: plans/PRDs, tickets (ticketbook or Linear), CLAUDE.md, agent skill files, any markdown. The document is the artifact; the conversation is the process of refining it.

### Agent Modes

Agents engage in qualitatively different activities — planning, coding, reviewing, testing, git operations, exploration. Modes give each a distinct visual identity so you can scan multiple panes and immediately know what kind of work is happening.

Each mode has: a color accent on the pane border/header, a badge label, default rendering emphasis (plan mode foregrounds the document, build mode foregrounds diffs, review mode foregrounds annotations, test mode foregrounds pass/fail), and mode-specific quick actions in the pane toolbar.

Modes are lenses, not walls. A session can shift modes as work evolves. A Plan session can spawn a Build session with `Cmd+Shift+X` (execute). A Build session can shift to Review with `Cmd+Shift+M`.

### Key Interactions

**Quick Capture (`Cmd+K`).** A floating input for capturing thoughts without context switching. Type a title, choose "Capture" (saves to ticketbook) or "Capture + Run" (saves and spawns an agent immediately). Fast enough that you never lose a thought because you're in the middle of something else.

**Spawn Session.** Multiple entry points: from a work item in the rail (`Cmd+Enter`), from quick capture, from the command palette (`Cmd+Shift+P` → "new session"), or from within another session (`Cmd+N` to start a parallel task in the same repo context).

**The Briefing (`Cmd+Shift+B`).** Auto-generated summary of what's happened since you last looked. Completed sessions, failed sessions with CI errors, sessions waiting for input, captured tasks not yet started. Each entry has enough context for a quick decision (view, resume, approve, dismiss). This is how you pick up the pieces after stepping away.

**File Finder (`Cmd+P`).** Fuzzy search across the repo, with live syntax-highlighted preview. Context-aware — searches the relevant repo/worktree for the focused pane. `Enter` opens as a view pane. `Cmd+Enter` inserts the file path at your cursor (for composing agent prompts). `Cmd+Shift+Enter` inserts file contents.

**CI Status (`Cmd+Shift+C`).** Pipeline status for the active PR. Pass/fail per check, expandable failure logs. An "Ask Agent to Fix" button that takes the failing test output and sends it to an agent session pre-loaded with the error context.

---

## Design Principles

1. **Keyboard-first.** Every feature accessible without touching the mouse.

2. **Glanceable.** Status dots, mode badges, one-line summaries. You can monitor parallel sessions without reading every detail.

3. **Documents and agents are interleaved.** You don't write a plan and then separately tell an agent. You write the plan with the agent, annotate it, refine it. The tool supports that fluid back-and-forth natively.

4. **Scale-agnostic.** A one-liner and a 500-line PRD are both work items. The tool adapts its presentation without forcing you to choose a "type."

5. **Local-first, integrate-later.** Ticketbook is the default, zero-config backend. Linear and others are additive. The tool is fully useful with nothing but local markdown files.

6. **Agents at the core, humans at the helm.** The workspace assumes agents do most of the work. The human directs, observes, and makes consequential decisions. The UI is optimized for fast, well-informed decision-making.

7. **Capture is sacred.** `Cmd+K` is the fastest path from thought to tracked item. No forms, no metadata, no decisions. Everything else can be added later.

8. **The briefing recovers context.** Step away, come back, know where everything stands in 30 seconds.

---

## Platform Direction

**Tauri** is the likely starting point — Rust backend for subprocess management, process orchestration, and IPC; web frontend (React) for all UI rendering including rich agent output, document editing, and the tiling layout system. xterm.js for terminal emulation in shell panes. SQLite for session event persistence and workspace state.

The workspace ships as a **Claude Code plugin** (hooks + MCP server + skills) bundled with a **desktop application** (the GUI). Installing the workspace means: the Tauri app provides the GUI, and the bundled plugin registers with Claude Code to provide the hook-based integration.

---

## What Exists Today vs. What's New

**Ticketbook (exists):** Local-first work item management. Git-based. MCP server for agent integration. Kanban/list UI. This becomes the default backend.

**Plannotator (exists, external):** Hook-based plan interception, browser rendering, inline annotations, feedback to agent. The Document+Agent pane absorbs this functionality natively.

**Claude Code (exists, external):** The primary agent runtime. Provides hooks, streaming JSON, MCP, sessions, plugins. The workspace hooks into all of these.

**The workspace (new):** The GUI layer — tiling panes, session rendering, document co-authoring, the rail, the briefing, the panel overlays, the mode system. Plus the orchestration layer — spawning and managing multiple agent processes, assembling cross-session context, tracking work items across backends.
