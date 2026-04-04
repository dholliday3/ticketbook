# Agent Workspace: Technical Design Document

## Design Goal

A modular, extensible platform where every major capability — agent integration, work item management, UI surfaces, keyboard interactions — is a self-contained module that registers with a thin core. The architecture should support rapid iteration: swap out a provider, add a new pane type, rearrange UI zones, introduce a new work item backend — all without touching unrelated code.

The modularity isn't aspirational. It's a requirement driven by the reality that this tool will evolve fast. Agent protocols change. New agent tools appear. User workflows are diverse. The platform must accommodate this without rewrites.

---

## Architecture Overview

Two processes. One event bus connecting them.

```
┌─────────────────────────────────────────────────────┐
│                    FRONTEND (Tauri Webview)          │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ Layout   │  │ Pane     │  │ Panel / Overlay   │ │
│  │ Engine   │  │ Registry │  │ Registry          │ │
│  └──────────┘  └──────────┘  └───────────────────┘ │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ Command  │  │ Keybind  │  │ Rail              │ │
│  │ Registry │  │ Registry │  │ (contributes)     │ │
│  └──────────┘  └──────────┘  └───────────────────┘ │
│                                                     │
│                    ▲ events / commands ▼             │
├─────────────────────────────────────────────────────┤
│                    IPC BRIDGE (Tauri)                │
├─────────────────────────────────────────────────────┤
│                                                     │
│                    BACKEND (Rust / Bun)              │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ Provider │  │ Work Item│  │ Session           │ │
│  │ Registry │  │ Backend  │  │ Manager           │ │
│  │          │  │ Registry │  │                   │ │
│  └──────────┘  └──────────┘  └───────────────────┘ │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ Process  │  │ Event    │  │ MCP               │ │
│  │ Manager  │  │ Store    │  │ Gateway           │ │
│  └──────────┘  └──────────┘  └───────────────────┘ │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Frontend** handles all rendering, layout, user input, and interaction. It knows nothing about specific agents or work item backends — it only knows canonical events and commands.

**Backend** handles process management, agent communication, work item persistence, and external integrations. It knows nothing about how things are rendered — it only emits and receives canonical events.

**IPC Bridge** is the typed event/command channel between them. Frontend subscribes to event streams. Backend exposes commands. Both directions are typed contracts — changing one side without updating the contract is a compile error.

---

## Module System

Every capability is a **module** that registers with one or more **registries**. The core platform is just registries + an event bus + a layout engine. All behavior comes from modules.

### What a Module Is

A module is a self-contained package that:

1. Declares what it **provides** (pane types, commands, keybindings, panel views, rail sections, providers, backends)
2. Declares what it **depends on** (other modules, core services)
3. Registers its contributions during startup
4. Can be enabled/disabled/swapped without affecting other modules

Modules can span frontend and backend. A "Claude Code" module would include both a backend provider (process management, event translation) and frontend contributions (custom rendering for Claude Code-specific events, mode definitions). Or a module can be frontend-only (a new panel view) or backend-only (a new work item backend).

### Registry Pattern

Every extension point is a registry. Modules register their contributions; the core consumes them.

```
Registry<T>
  register(id, contribution: T)
  unregister(id)
  get(id): T
  getAll(): T[]
  onChange(callback)
```

Registries are typed. The pane registry expects pane contributions. The command registry expects command contributions. This keeps modules honest — you can't register a pane where a command is expected.

---

## Backend Modules

### Provider Registry

Providers are the bridge between the workspace and specific agent tools.

**The provider interface:**

```
Provider
  id: string                    // "claude-code", "codex", "aider"
  name: string                  // Human-readable name
  capabilities: Capability[]    // What this provider supports

  // Lifecycle
  startSession(config: SessionConfig): SessionHandle
  stopSession(handle: SessionHandle): void
  resumeSession(handle: SessionHandle): void

  // Communication
  sendMessage(handle, message: string): void
  sendApproval(handle, decision: ApprovalDecision): void
  sendFeedback(handle, feedback: Feedback): void

  // Event stream
  subscribe(handle): EventStream<CanonicalEvent>

  // Context injection
  injectContext(handle, context: SessionContext): void

  // Configuration
  getConfigSchema(): ConfigSchema   // What settings this provider needs
  validateConfig(config): Result    // Check if provider is properly configured
```

**SessionConfig** contains everything needed to start a session: the working directory, the prompt/task, the work item context, git worktree preferences, permission policies, and provider-specific settings.

**CanonicalEvent** is the normalized event format — the contract between providers and the rest of the system:

```
CanonicalEvent
  type: EventType       // reasoning, tool_call, file_change,
                        // shell_command, approval_request,
                        // progress, error, session_lifecycle
  timestamp: number
  sessionId: string
  payload: EventPayload // Type-specific data
```

Every provider translates its agent's native output into these events. The frontend renderer, the event store, the session manager — they all consume CanonicalEvents and never see provider-specific formats.

**Capability** declares what a provider supports so the workspace can adapt:

```
Capability
  "hooks"            // Provider supports lifecycle hooks (can intercept events)
  "structured_output" // Provider emits typed structured events (not just text)
  "resume"           // Sessions can be paused and resumed
  "worktree"         // Provider supports git worktree isolation
  "mcp"              // Provider can consume MCP tools
  "plan_mode"        // Provider has a distinct planning phase
  "approval_flow"    // Provider can block on human approval
```

If a provider doesn't support a capability, the workspace gracefully degrades. A provider without `structured_output` falls back to raw text rendering in the session pane. A provider without `hooks` can't intercept tool calls, so the workspace can only observe, not intervene. A provider without `plan_mode` doesn't get the Document+Agent plan review flow.

**The Claude Code provider** (first implementation) supports all capabilities. It uses `--output-format stream-json` for structured events, the hook system for lifecycle interception, MCP for bidirectional tools, `--resume` for session persistence, and plugin packaging for distribution. But none of this leaks past the provider boundary.

### Work Item Backend Registry

Work item backends are the bridge between the workspace and task tracking systems.

**The backend interface:**

```
WorkItemBackend
  id: string                     // "ticketbook", "linear", "github-issues"
  name: string
  capabilities: BackendCapability[]

  // CRUD
  list(filter: WorkItemFilter): WorkItem[]
  get(id: string): WorkItem
  create(input: CreateWorkItemInput): WorkItem
  update(id: string, changes: WorkItemChanges): WorkItem

  // Relationships
  getChildren(id: string): WorkItem[]
  getParent(id: string): WorkItem | null
  link(parentId, childId): void

  // Real-time (optional)
  subscribe(): EventStream<WorkItemEvent>

  // Search
  search(query: string): WorkItem[]

  // Configuration
  getConfigSchema(): ConfigSchema
```

**WorkItem** is the canonical format:

```
WorkItem
  id: string              // Backend-assigned (TB-42, LIN-1234)
  backendId: string       // Which backend this came from
  title: string
  body: string            // Markdown, any length
  status: Status          // Canonical: not_started, in_progress, done, blocked
  nativeStatus?: string   // Backend-specific status ("triage", "in review")
  metadata: Record<string, any>  // Priority, labels, assignee, dates, etc.
  sessions: SessionRef[]  // Linked session IDs
```

Backends map their native concepts onto this canonical format. Ticketbook maps its markdown frontmatter. Linear maps its GraphQL types. The workspace always works with the canonical WorkItem.

**BackendCapability** declares what a backend supports:

```
BackendCapability
  "realtime"      // Backend emits live change events
  "relationships" // Backend supports parent/child and blocking relationships
  "search"        // Backend supports full-text search
  "sync"          // Backend supports bidirectional sync (not just read)
```

### Session Manager

Not a registry — a core service. Manages the lifecycle of all sessions across all providers.

Responsibilities:
- Tracks all active and historical sessions
- Assigns and persists session IDs
- Links sessions to work items
- Delegates to the appropriate provider for actual agent communication
- Persists session events to the event store
- Provides session queries (active, by work item, by status, by provider)
- Handles session resume across workspace restarts

The session manager is the coordinator that sits between providers and the rest of the system. Frontend code never talks to providers directly — it talks to the session manager, which routes to the right provider.

### Event Store

Append-only log of all canonical events, indexed by session. Powers:
- Session replay and history
- The briefing (summarize what happened since timestamp X)
- Audit-level visibility
- Session resume (replay events to reconstruct state)

SQLite is the pragmatic choice. Each event is a row with session ID, timestamp, event type, and JSON payload. Indexes on session ID and timestamp. Simple, fast, battle-tested.

### Process Manager

Low-level subprocess management. Starts processes, captures stdout/stderr, sends stdin, monitors health, handles cleanup on crash or workspace shutdown.

Providers use the process manager — they don't spawn processes directly. This centralizes concerns like: what happens when the workspace crashes (clean up child processes), resource limits, process health monitoring.

### MCP Gateway

Runs MCP servers that agents can connect to. Provides workspace-level tools to any agent session regardless of provider:

- Work item tools (read, update, create — delegated to the backend registry)
- Session awareness tools (what other sessions are running, what files they're touching)
- Workspace interaction tools (request the human to make a decision, open a file in the UI)

The MCP gateway is a module, not core. Providers that support MCP capabilities get access to it. Providers that don't simply skip it.

---

## Frontend Modules

The frontend follows the same registry pattern. The core provides a layout engine and rendering framework. Everything else is contributed by modules.

### Layout Engine

The core's main responsibility. Manages the tiling tree of panes.

**Data model:** A tree where each node is either a split (horizontal/vertical with a ratio), a tab group (ordered list of panes), or a leaf (a single pane instance).

**Operations:** Split, close, resize, move, tab, untab, zoom/unzoom, focus navigation (directional). All operations are commands that can be triggered by keybindings or programmatically.

**Persistence:** The layout tree serializes to JSON for save/restore. Layout presets are just named JSON blobs.

The layout engine doesn't know what's inside each pane. It manages geometry and focus. Pane content is provided by the pane registry.

### Pane Registry

Modules register pane types. Each pane type defines:

```
PaneType
  id: string                    // "shell", "agent-session", "doc-agent", "view"
  name: string
  icon: ReactNode

  // Rendering
  component: React.FC<PaneProps> // The actual pane component
  headerComponent?: React.FC    // Custom header content (mode badge, status, etc.)

  // Behavior
  canSplit: boolean              // Can this pane be split?
  canTab: boolean                // Can this pane be tabbed?
  canZoom: boolean               // Can this pane be zoomed?

  // Serialization
  serialize(state): PaneState    // Save pane state for persistence
  deserialize(state): PaneProps  // Restore pane state
```

**PaneProps** includes what the pane needs from the system:

```
PaneProps
  paneId: string                 // Unique pane instance ID
  isFocused: boolean             // Is this pane currently focused?
  dimensions: { width, height }  // Current pixel dimensions
  eventBus: EventBus             // For communicating with backend
  commandRegistry: CommandRegistry
```

Built-in pane types (shell, agent session, document+agent) are just the first modules registered. The system doesn't privilege them over custom pane types.

### Panel Registry

The right panel system. Modules register panel views:

```
PanelView
  id: string                    // "git-diff", "ci-status", "file-finder"
  name: string
  icon: ReactNode
  shortcut: KeyCombo            // The toggle shortcut

  component: React.FC<PanelProps>

  // Context awareness
  isRelevant(context: FocusContext): boolean  // Should this panel be available given what's focused?
```

`isRelevant` is how panels adapt to context. The CI panel is relevant when the focused session has a linked PR. The git diff panel is relevant when there's a branch with changes. The file finder is always relevant. Irrelevant panels are hidden from the shortcut rotation but still accessible through the command palette.

**PanelProps** includes the current focus context so the panel can show information relevant to whatever the user is looking at.

### Command Registry

Every action in the workspace is a command. Commands are the abstraction that connects keybindings, the command palette, toolbar buttons, and programmatic actions.

```
Command
  id: string                    // "workspace.split-right", "session.send-message"
  name: string                  // Human-readable for command palette
  category: string              // Grouping for command palette

  execute(context: CommandContext): void
  isEnabled(context: CommandContext): boolean  // Grayed out if false
  isVisible(context: CommandContext): boolean  // Hidden if false
```

Modules register commands. The core provides the command palette UI and the execution framework. Keybindings map to command IDs, not to functions directly.

### Keybinding Registry

Maps key combinations to command IDs.

```
Keybinding
  key: KeyCombo                 // "Cmd+Shift+D"
  command: string               // Command ID
  when?: string                 // Context condition: "focusedPane == agent-session"
```

The `when` clause is how the same key can do different things in different contexts. `Enter` in the command palette executes the selected command. `Enter` in an agent session input bar sends the message. `Enter` in the rail opens the selected item. The keybinding registry resolves the right binding based on the current context.

Default keybindings are registered by modules. Users can override them through settings. The override mechanism is the same as VS Code's `keybindings.json` — a list of rebinds that takes precedence over defaults.

### Rail Module

The left rail is itself a module, not core. It registers:
- A dedicated UI zone (the left sidebar slot)
- Rail sections (active sessions, recent, tasks, config) — each section is a sub-module

Rail sections implement a common interface:

```
RailSection
  id: string
  name: string
  icon: ReactNode
  order: number                 // Position in the rail

  component: React.FC<RailSectionProps>
  badge?: (state) => number | null  // Count badge (e.g., 3 active sessions)
```

New modules can contribute rail sections. A CI module could add a "Pipelines" section. A git module could add a "Branches" section. The rail renders whatever sections are registered, in order.

### Theme / Visual System

Mode colors, status indicators, density settings — all contributed through a theme registry. Modes don't hardcode colors; they reference theme tokens.

```
Theme
  mode.plan.accent: Color
  mode.build.accent: Color
  mode.review.accent: Color
  status.running: Color
  status.done: Color
  status.failed: Color
  status.waiting: Color
  surface.primary: Color
  surface.secondary: Color
  text.primary: Color
  text.secondary: Color
  ...
```

---

## Event Bus

The communication backbone. Both frontend and backend publish and subscribe to typed events.

**Backend → Frontend events** (things that happened):
- `session.event` — a canonical event from an agent session
- `session.lifecycle` — session started, stopped, resumed, failed
- `workitem.changed` — a work item was created/updated/deleted
- `approval.requested` — an agent needs a human decision
- `ci.updated` — CI pipeline status changed
- `conflict.detected` — parallel sessions touching same files

**Frontend → Backend commands** (things the user wants):
- `session.start` — start a new agent session
- `session.send` — send a message to a session
- `session.stop` — stop a session
- `session.approve` — approve a pending action
- `workitem.create` — create a work item
- `workitem.update` — update a work item
- `context.request` — request context for a session (other sessions, work item data)

The event bus is typed end-to-end. Both sides share the same type definitions. IPC serialization/deserialization is generated from these types, so mismatches are caught at compile time.

### Event Bus Implementation

In Tauri, the IPC bridge provides this naturally. Tauri commands (backend functions callable from frontend) handle the command direction. Tauri events (backend → frontend push) handle the event direction. Both are typed through `tauri::command` and `tauri::Event`.

If the architecture shifts to web-first (no Tauri), the same interface works over WebSocket with typed message envelopes.

---

## Module Dependency and Loading

Modules declare dependencies explicitly:

```
ModuleManifest
  id: string
  version: string
  depends: string[]              // Module IDs this module requires
  provides: ContributionType[]   // What registries this module contributes to
```

The module loader resolves dependencies, detects cycles, and loads modules in topological order. Missing dependencies produce clear errors at startup, not runtime crashes.

**Built-in modules** (ship with the workspace):
- `core.layout` — layout engine
- `core.shell` — shell pane type
- `core.agent-session` — agent session pane type
- `core.doc-agent` — document+agent pane type
- `core.rail` — left rail
- `core.command-palette` — command palette UI
- `provider.claude-code` — Claude Code provider
- `backend.ticketbook` — ticketbook work item backend
- `panel.git-diff` — git diff panel view
- `panel.ci` — CI status panel view
- `panel.file-finder` — file finder panel view
- `panel.session-summary` — session summary panel view

**Future modules** (added later):
- `provider.codex` — Codex provider
- `provider.aider` — Aider provider
- `backend.linear` — Linear work item backend
- `backend.github-issues` — GitHub Issues backend
- `panel.conflicts` — conflict detection panel

Each of these is a directory with a manifest and source code. Disabling a module removes its contributions from all registries. The workspace continues to function with whatever modules remain.

---

## Data Flow: Session Lifecycle Example

To illustrate how modules interact through the system, here's a session from start to completion:

**1. User spawns a session from a work item**

```
Frontend                              Backend
────────                              ───────
User clicks "Run" on TB-42
  → Command: session.start
    { workItemId: "TB-42",
      providerId: "claude-code" }
                          ───IPC───→  Session Manager receives command
                                      → Fetches work item from Backend Registry
                                        (ticketbook returns TB-42 data)
                                      → Assembles SessionContext
                                        (work item body, parent context,
                                         sibling sessions, agent config)
                                      → Calls Provider Registry → claude-code
                                        provider.startSession(config)
                                      → Claude Code provider uses Process Manager
                                        to spawn: claude --print --output-format
                                        stream-json --resume ...
                                      → Provider starts translating stream-json
                                        into CanonicalEvents
                                      → Session Manager persists events
                                        to Event Store
                          ←───IPC───  Event: session.lifecycle
                                      { type: "started", sessionId: "..." }
Pane Registry creates agent-session
pane, subscribes to session events
Rail updates with new active session
```

**2. Agent produces output**

```
                                      Provider receives stream-json:
                                      { type: "assistant", content: "..." }
                                      → Translates to CanonicalEvent:
                                        { type: "reasoning", payload: "..." }
                                      → Event Store appends
                          ←───IPC───  Event: session.event
                                      { type: "reasoning", ... }
Agent session pane renders
reasoning block

                                      Provider receives stream-json:
                                      { type: "tool_use", name: "Edit", ... }
                                      → Translates to CanonicalEvent:
                                        { type: "file_change", payload: { diff } }
                          ←───IPC───  Event: session.event
                                      { type: "file_change", ... }
Agent session pane renders
collapsible diff card
```

**3. Agent requests approval**

```
                                      Provider receives hook callback:
                                      PermissionRequest on git push
                                      → Translates to CanonicalEvent:
                                        { type: "approval_request",
                                          payload: { action: "git push", ... } }
                          ←───IPC───  Event: approval.requested
                                      { sessionId, action, context }
Agent session pane renders
approval prompt with [Approve] [Deny]
Rail shows amber pulse on session

User clicks Approve
  → Command: session.approve
    { sessionId, decision: "allow" }
                          ───IPC───→  Session Manager routes to provider
                                      → Provider sends approval via
                                        hook stdout response
                                      → Agent unblocks and continues
```

**4. Session completes**

```
                                      Provider detects session end
                                      → CanonicalEvent: session_complete
                                      → Event Store finalizes session
                          ←───IPC───  Event: session.lifecycle
                                      { type: "completed", sessionId, summary }
Agent session pane updates header
to "Done" state
Rail updates: green check
Session summary becomes available
in panel registry
```

Every step flows through the typed event bus. The frontend never knows it's talking to Claude Code. The backend never knows how things are rendered. The provider translates in one direction. The pane component translates in the other. Everything else is canonical.

---

## Technology Choices

**Backend runtime:** Rust (via Tauri) for process management, IPC, and system-level concerns. Bun/Node for provider modules that need to interface with JS-based agent tools (Claude Code's streaming JSON, MCP servers). The Tauri sidecar pattern supports this — Rust core with JS sidecar processes for provider-specific logic.

**Frontend framework:** React. The ecosystem for rendering diffs (react-diff-viewer), markdown (react-markdown, MDX), code (Prism, Shiki), and structured data is unmatched. The component model maps naturally to the pane/panel/rail module system.

**Terminal emulation:** xterm.js for shell panes. Battle-tested, used by VS Code's terminal, supports addons for fit, search, web links. The shell pane module wraps xterm.js and registers it as a pane type.

**Persistence:** SQLite for the event store and workspace state (layout, settings, session metadata). File-based for work items (ticketbook's `.tickets/` directory). Provider-specific storage for agent session transcripts (e.g., Claude Code's JSONL files in `~/.claude/sessions/`).

**IPC:** Tauri's built-in IPC for the desktop app. WebSocket as an alternative transport if the architecture shifts to web-first. The event bus abstraction makes the transport swappable without changing module code.

**State management (frontend):** Zustand for global workspace state (layout tree, active sessions, focused pane). React context for module-scoped state. No Redux — Zustand is simpler and the module system means state is already well-partitioned.

---

## Module Boundaries: What Goes Where

| Concern | Module | Side |
|---------|--------|------|
| Spawning Claude Code process | `provider.claude-code` | Backend |
| Translating stream-json to canonical events | `provider.claude-code` | Backend |
| Hook registration and response | `provider.claude-code` | Backend |
| Rendering a reasoning block | `core.agent-session` | Frontend |
| Rendering a diff card | `core.agent-session` | Frontend |
| Layout splits/tabs/zoom | `core.layout` | Frontend |
| xterm.js terminal | `core.shell` | Frontend |
| Document editor + inline comments | `core.doc-agent` | Frontend |
| Reading/writing ticketbook files | `backend.ticketbook` | Backend |
| Syncing Linear issues | `backend.linear` | Backend |
| Git diff panel | `panel.git-diff` | Frontend |
| CI status panel | `panel.ci` | Frontend + Backend (CI polling) |
| Quick capture overlay | `core.capture` | Frontend + Backend (creates work item) |
| Briefing overlay | `core.briefing` | Frontend + Backend (queries event store) |
| Session awareness MCP tools | `core.mcp-gateway` | Backend |
| Keybinding resolution | `core.keybindings` | Frontend |
| Command palette | `core.command-palette` | Frontend |

---

## Iteration Strategy

The module system is designed for iteration. Here's how the architecture supports common changes:

**"We need to support a new agent tool"** → Write a new provider module. Implement the provider interface. Register it. No changes to frontend, session manager, or event store.

**"We want to add a new panel view"** → Write a new panel module. Implement the PanelView interface. Register it. No changes to layout engine, other panels, or backend.

**"We need to rearrange the UI"** → The layout engine is data-driven. Change the layout tree. Panes don't care where they are. The rail can be moved to the right. Panels can become panes. The layout is just geometry.

**"We want to replace ticketbook with a different default"** → Swap the backend module. The WorkItem interface stays the same. Frontend code doesn't change.

**"We want to add a new pane type"** → Write a new pane module. Implement the PaneType interface. Register it. It immediately works with splits, tabs, zoom, focus navigation.

**"Agents now support a new capability"** → Add the capability to the Capability enum. Update the relevant provider. The workspace gracefully enables the new functionality where the capability is present.

**"We need a completely different rendering for a specific agent"** → Providers can contribute custom frontend components through the pane registry. A provider module can register a provider-specific pane type that renders its events with custom UI, while still using canonical events for everything else (session manager, event store, rail status).

---

## What to Build First

Phase 0 is the skeleton: the core registries, the event bus, the IPC bridge, and the layout engine with one pane type (shell). This proves the architecture — if you can render a tiling terminal emulator where pane types are pluggable, the foundation works.

Phase 1 adds the agent session pane and the Claude Code provider. This proves the provider abstraction — canonical events flowing from Claude Code through the system to rich rendering.

Phase 2 adds the Document+Agent pane and ticketbook backend. This proves the work item abstraction and the document co-authoring model.

Phase 3 adds panels (git diff, CI, file finder), the rail, quick capture, and the briefing. This proves the panel/rail registry pattern and rounds out the core experience.

Each phase is independently useful and testable. Each phase validates a specific architectural abstraction before building on top of it.
