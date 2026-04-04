# Agent Workspace: Design Notes

## The Core Tension

The terminal is the most flexible computing interface ever built. Tabs, splits, panes — you self-organize as your mental model demands. You hop between directories, fire off parallel processes, and tear down contexts just as fast. VS Code inherited this same philosophy for files — open what you want, arrange how you want.

But terminals are dumb renderers. They draw text in a grid. When you're running an agent session, the output is a wall of streaming text where diffs, tool calls, progress indicators, and structured reasoning all look the same. The TUI can't distinguish "here's a 200-line diff the agent wrote" from "here's the agent thinking out loud." You lose signal in noise.

Agent-specific GUIs (T3 Code, Codex Desktop, Conductor) solve the rendering problem by running agents headlessly and controlling visualization. Diffs get syntax highlighting. Tool calls get structured cards. Progress is clear. But they trade away the terminal's flexibility — you're locked into their session model, their layout, their workflow assumptions. The composability disappears.

**The goal: terminal-grade flexibility with agent-aware rendering.**

---

## The Mental Model

Think of it as a **tiling workspace where every pane is polymorphic**.

In a terminal emulator, every pane is the same thing — a PTY connected to a shell. The power comes from the layout system (splits, tabs, stacks) and the fact that you can run anything in any pane.

The insight is to keep that layout system but make panes type-aware. A pane can be:

- **A shell** — actual terminal emulation, raw PTY, exactly like having a Ghostty pane. You `cd`, you `ls`, you run whatever you want.
- **An agent session** — a headless agent process whose output is rendered with rich UI (structured diffs, tool call cards, reasoning blocks, progress). The underlying process is still a subprocess (Claude Code, Codex, etc.), but the rendering layer understands the output protocol.
- **A view** — a read-only (or lightly interactive) panel showing something contextual: a file, a diff, a plan, a ticket, a git log, a running test suite.

The user can split, tab, stack, and rearrange these freely — the same keyboard-driven or drag-and-drop layout manipulation you'd do in a terminal, but the content in each pane renders appropriately for its type.

This is the key departure from existing agent GUIs: **the workspace doesn't prescribe a layout**. There's no hardcoded left sidebar of sessions with a main content area. You build your layout to match your current work context, just like you would in tmux or a tiled window manager.

---

## Pane Types in Detail

### Shell Panes

Identical to a terminal emulator pane. Full VT100/ANSI support, your shell, your aliases, your tools. This is the escape hatch that keeps the tool from ever feeling constraining — anything you can do in a terminal, you can do here.

The interesting question is whether to embed a real terminal emulator (using something like libghostty-vt or xterm.js) or to build a simpler output renderer. The answer is: **real terminal emulation, no compromise**. The moment your shell pane can't run `htop` or `vim` or handle cursor addressing, people will keep a separate terminal open and you've lost.

### Agent Session Panes

This is where the value lives. An agent session pane wraps a headless agent process and renders its output through a structured UI layer rather than raw terminal output.

The rendering needs to handle several distinct content types:

**Reasoning/narration** — the agent explaining what it's doing. Rendered as readable prose, visually distinct from actions.

**Tool calls** — file reads, writes, shell commands, searches. Rendered as collapsible cards showing the tool, its arguments, and its output. File writes show diffs. Shell commands show both the command and output.

**Diffs** — first-class rendering with syntax highlighting, context lines, and the ability to expand/collapse.

**Progress** — what the agent is currently doing, how long it's been running, what's queued. Not just a spinner — something that gives you a sense of phase and momentum.

**Decisions/approvals** — when the agent needs input, that request should be visually prominent and actionable from the pane.

The key architectural decision: **agent session panes communicate through a protocol, not by screen-scraping terminal output.** The agent process emits structured events (JSON, or whatever the agent's native protocol is), and the pane's renderer translates those events into UI. This is similar to how T3 Code works — it speaks JSON-RPC to the Codex app-server over stdio and renders the domain events.

This means the pane renderer needs adapters per agent type. A Claude Code adapter parses Claude Code's output format. A Codex adapter speaks Codex's protocol. An adapter for a custom agent speaks whatever it speaks. The pane renderer itself is agent-agnostic — it understands a canonical set of content types (reasoning, tool_call, diff, progress, approval_request) and each adapter translates agent-specific output into those types.

### View Panes

Lightweight panels for contextual information. These could include:

- **File viewer** — syntax-highlighted read-only view of a file, possibly with annotations.
- **Diff viewer** — comparing two states (e.g., before/after an agent's changes).
- **Plan/ticket viewer** — showing a ticketbook plan or ticket, possibly with live status as agents work through subtasks.
- **Git log** — recent commits, maybe with agent attribution.
- **Session overview** — a high-level summary of all active agent sessions and their status.

View panes are the connective tissue. They're how you maintain awareness of the broader context while focused on a specific session or shell.

---

## The Layout System

Terminal emulators have converged on a good layout model: **a tree of splits (horizontal/vertical) with tabs at any node**. Ghostty, tmux, iTerm2, VS Code's terminal — they all work roughly this way.

The workspace should use the same model, extended slightly:

- **Splits** — divide any pane horizontally or vertically
- **Tabs** — group panes into tab sets at any level of the split tree
- **Stacks** — overlapping panes in the same space (like tabs but maybe with a different visual treatment for quick switching)
- **Zoom** — temporarily maximize any pane to full workspace, return to layout with a keystroke

The layout should be keyboard-driven first (like tmux prefix commands or VS Code shortcuts) with mouse/trackpad as a secondary input. Power users will live on the keyboard.

**Layout presets/templates** could be useful as starting points — "two agent sessions side by side with a git log below" — but should never be mandatory.

---

## Where Ticketbook Fits

Ticketbook becomes the planning and tracking layer that feeds into the workspace. The tight loop looks like:

1. **Brainstorm/plan** in ticketbook — create tickets, organize into epics/sprints, capture tasks.
2. **Spawn agent sessions** from tickets — select a ticket, choose an agent, and a new agent session pane opens with the ticket's context pre-loaded as the prompt or system context.
3. **Observe** agent sessions in the workspace — the agent works, you watch (or don't), you intervene when needed.
4. **Track completion** — as agents finish, ticket status updates automatically. Diffs, commits, and PRs are linked back to the ticket.
5. **Course correct** — if an agent goes sideways, you see it in the session pane, stop it, adjust the plan in ticketbook, and relaunch.

The integration doesn't need to be mandatory — you can use the workspace without ticketbook, or use ticketbook without the workspace. But when used together, the plan-to-execution-to-observation loop is seamless.

---

## The Agent Process Model

Each agent session is a subprocess. The workspace doesn't run agents itself — it orchestrates and renders.

**Subprocess management:**
- Start a process (e.g., `claude --print --output-format stream-json`, or codex in server mode)
- Capture its stdout/stderr
- Send input to its stdin
- Monitor its lifecycle (running, waiting for input, completed, failed)

**Git worktrees** for isolation. Each agent session can optionally operate in its own worktree, so parallel agents don't step on each other. The workspace manages worktree creation/cleanup. This is already how Claude Code's `--worktree` flag works, and T3 Code uses git checkpoints for a similar purpose.

**Session persistence.** Agent sessions should survive workspace restarts. The event log from each session should be stored so you can review what happened, resume interrupted sessions, or audit agent behavior after the fact. This is where T3 Code's event-sourcing approach is smart — the session is a sequence of immutable events, and the current state is a projection.

---

## Protocol & Adapter Layer

The central architectural bet: **a canonical intermediate representation for agent activity**.

Agent tools all have different output formats. Claude Code emits streaming JSON. Codex speaks JSON-RPC. Others use different protocols. The workspace needs a stable internal format that all adapters translate into.

Rough shape of the canonical event types:

- `session.started` / `session.completed` / `session.failed`
- `turn.started` / `turn.completed`
- `reasoning` — agent's explanatory text
- `tool_call.started` / `tool_call.completed` — with tool name, arguments, output
- `file.read` / `file.write` / `file.create` / `file.delete` — file operations with content/diffs
- `shell.command` — shell execution with command and output
- `approval.requested` / `approval.granted` / `approval.denied`
- `progress.update` — phase, status, estimated completion
- `checkpoint` — a git state snapshot

This intermediate format is the contract between adapters and the renderer. New agents just need a new adapter. The renderer never changes.

---

## Platform & Technology Considerations

### The Native vs. Web Question

**Option A: Native app (Swift/macOS, GTK/Linux, etc.)**
- Best performance, especially for terminal emulation
- Can embed libghostty-vt directly for shell panes
- Native look and feel
- Platform-specific code, slower iteration, smaller team bandwidth

**Option B: Electron/Tauri desktop app with web rendering**
- Cross-platform from one codebase
- xterm.js for terminal emulation (battle-tested, used by VS Code's terminal)
- React/web ecosystem for rich UI
- Tauri specifically gives near-native performance with Rust backend and web frontend, much lighter than Electron

**Option C: Web-first (local server + browser)**
- Fastest iteration speed
- xterm.js for terminal emulation
- Any web framework for rich UI
- Feels less "native," but tools like T3 Code prove it can work
- Easiest path to remote/collaborative use later

The pragmatic choice is probably **Tauri or web-first**, depending on how important native feel is to you. Tauri gives you a Rust backend for subprocess management and IPC (fast, safe, good at process orchestration) with a web frontend for all UI (React, rich rendering, xterm.js). You get near-native performance without writing platform-specific UI code.

If terminal emulation fidelity is non-negotiable and you don't want to depend on xterm.js, the native route with libghostty-vt is there — but it's a much larger investment.

### Key Libraries / Dependencies to Evaluate

**Terminal emulation:**
- xterm.js — the standard for web-based terminal emulation. VS Code, Hyper, and many others use it. Mature, well-maintained, supports addons for fit, search, web links, image protocol.
- libghostty-vt — if going native. Proven, extremely performant, but Zig-based and young as a standalone library.

**Layout system:**
- Custom tiling layout — most terminal emulators build their own. The logic isn't complex (it's a tree of splits), but getting the UX right (resize handles, drag-and-drop, keyboard navigation) takes polish.
- Consider looking at how VS Code implements its editor group layout, or how Zed handles panes.

**Agent communication:**
- stdio/subprocess spawning — the baseline for talking to CLI-based agents.
- WebSocket for agents that run as servers (like T3 Code's pattern with Codex app-server).
- A unified transport abstraction that can handle both modes.

**State management / persistence:**
- SQLite for session event logs and workspace state (proven by T3 Code's approach).
- File-based storage that stays git-friendly (consistent with ticketbook's philosophy).

**Rendering / UI framework:**
- React for the web/Tauri frontend. The ecosystem for rendering diffs, markdown, code blocks, and structured data is deep.
- Consider Solid or Svelte if bundle size and raw rendering performance matter more than ecosystem breadth.

---

## What Distinguishes This From Existing Tools

**vs. T3 Code / Codex Desktop / Conductor:** These are session-first GUIs — they organize everything around agent sessions. This workspace is layout-first — it gives you terminal-grade flexibility and agent sessions are one type of content in the layout. You can also have shells, views, and whatever else you need.

**vs. Terminal + Claude Code:** The terminal can't render agent output richly. This workspace can — diffs, tool calls, progress, and approvals are all first-class rendered content, not a text stream.

**vs. VS Code + Extensions:** VS Code is an editor first. Its terminal is secondary. This workspace is a terminal/agent-runner first. Code viewing is secondary (view panes for context, not full editing).

**The unique positioning: it's a workspace for orchestrating parallel work, not an editor for writing code.** The code gets written by agents. Your job is to plan, delegate, observe, and steer. The tool should be optimized for that job.

---

## Open Questions

1. **How tightly coupled should the workspace be to specific agents?** The adapter layer provides abstraction, but in practice, Claude Code might be 90% of usage. Is it worth building the adapter abstraction early, or start Claude Code-native and generalize later?

2. **Should view panes be extensible?** Could third parties (or the user) create custom view panes? This starts looking like a plugin system, which adds a lot of complexity but also a lot of power.

3. **Collaboration / remote use.** If the workspace is web-based, multi-user/remote use becomes possible. Is that a goal, or is this firmly a single-developer tool?

4. **Relationship to the editor.** Developers will still need to read and sometimes edit code. Should the workspace include a code editor (even a simple one), or is the expectation that VS Code / Zed / etc. runs alongside?

5. **Mobile / tablet.** Monitoring agent sessions from a phone while away from the desk is an interesting use case. Does the architecture support thin clients?

6. **Ticketbook coupling.** Should the workspace have its own lightweight task/plan tracking, or strictly delegate to ticketbook as a separate tool? The tighter the integration, the more powerful the loop — but also the more opinionated the workflow.
