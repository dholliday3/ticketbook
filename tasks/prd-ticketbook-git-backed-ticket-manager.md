# PRD: Ticketbook — Git-Backed Ticket Manager

## Overview

Ticketbook is a lightweight, git-backed ticket manager with a clean local UI and MCP server. Tickets are flat markdown files with YAML frontmatter, stored in-repo, readable by humans and agents alike. The UI is a standalone Vite + React app inspired by Linear's information density and Plannotator's focused simplicity.

The problem: PRDs are great for upfront planning but bad for tracking granular work. Linear is great for tracking but heavy for solo projects and lives outside the repo. Ticketbook fills the gap — a tool for developers who want to plan and track work in their repo with a clean interface, not a project management platform.

## Goals

- Store tickets as plain markdown files in `.tickets/` — diffable, greppable, version-controlled
- Provide agents with structured context they can read and update via MCP
- Deliver a UI that doesn't feel like editing raw markdown (Linear-inspired, keyboard-first)
- Support both list and kanban board views with drag-and-drop reordering
- Keep the architecture minimal: pure TS core library, Bun server, React + Vite UI

## Quality Gates

These commands must pass for every user story:
- `bun test` — Unit and integration tests
- `bun run typecheck` — Type checking
- `bun run lint` — Linting

For UI stories, also include:
- Verify in browser using dev-browser skill

## User Stories

### US-001: Core Schema, Types, and Config
As a developer, I want validated Zod schemas and TypeScript types for tickets and config so that all modules share a single source of truth for the data format.

**Acceptance Criteria:**
- [ ] `packages/core/src/schema.ts` defines Zod schemas for ticket frontmatter (required: id, title, status, created, updated; optional: priority, order, tags, project, epic, sprint)
- [ ] Status enum: `backlog | open | in-progress | done | cancelled`
- [ ] Priority enum: `low | medium | high | urgent`
- [ ] `order` is an optional float
- [ ] Tags are validated as an array of lowercase strings
- [ ] Config schema for `.config.yaml` with `prefix` (default `TKT`) and `deleteMode` (default `archive`)
- [ ] `packages/core/src/types.ts` exports `Ticket`, `CreateTicketInput`, `TicketPatch`, `TicketFilters`, `TicketbookConfig`
- [ ] `packages/core/src/config.ts` reads/writes `.tickets/.config.yaml` with defaults when file is missing

### US-002: Core Reader Module
As a developer, I want to scan the `.tickets/` directory and get a typed, filtered, searchable list of tickets so that all downstream consumers (server, UI, MCP) share the same read logic.

**Acceptance Criteria:**
- [ ] `packages/core/src/reader.ts` implements `listTickets(dir, filters?)` — scans `.tickets/`, parses each `.md` file with `gray-matter`, validates with Zod, returns `Ticket[]`
- [ ] `getTicket(dir, id)` returns a single ticket by ID or null
- [ ] `searchTickets(dir, query)` does full-text search across title and body
- [ ] `TicketFilters` supports: status, priority, project, epic, sprint, tags, and search
- [ ] Ignores non-`.md` files, the `.counter` file, `.config.yaml`, and the `.archive/` directory
- [ ] `getProjects()`, `getEpics()`, `getSprints()`, `getTags()` derive available values by scanning existing tickets

### US-003: Core Writer Module
As a developer, I want to create, update, delete, archive, and restore tickets as files so that all mutations go through a single validated code path.

**Acceptance Criteria:**
- [ ] `packages/core/src/writer.ts` implements `createTicket(dir, input)` — generates ID, creates file with correct filename pattern (`{ID}-{slug}.md`), sets `created` and `updated` timestamps
- [ ] `updateTicket(dir, id, patch)` updates frontmatter fields and/or body, refreshes `updated` timestamp
- [ ] `deleteTicket(dir, id)` archives (moves to `.tickets/.archive/`) or hard-deletes per config `deleteMode`
- [ ] `restoreTicket(dir, id)` moves a ticket from `.tickets/.archive/` back to `.tickets/`
- [ ] `toggleSubtask(dir, id, taskIndex)` toggles a checkbox by 0-based index in the body
- [ ] `addSubtask(dir, id, text)` appends a checkbox item to the `## Tasks` section (creates the section if missing)
- [ ] Optional frontmatter fields are omitted entirely from the file when not set (no `priority: null`)
- [ ] Tags are normalized on write (trimmed, lowercased, deduplicated)

### US-004: Core ID Generation
As a developer, I want atomic ticket ID generation with configurable prefix so that IDs are unique, stable, and repo-customizable.

**Acceptance Criteria:**
- [ ] `packages/core/src/id.ts` reads `.tickets/.counter` for the next number, increments it atomically
- [ ] Generates IDs like `TKT-001` (3-digit zero-padded, grows naturally past 999)
- [ ] Respects configurable prefix from `.config.yaml`
- [ ] Slugifies title: lowercase, alphanumeric + hyphens only, max 50 chars, truncated at word boundaries
- [ ] Produces filenames like `TKT-042-add-ticket-search.md`

### US-005: Core Ordering Module
As a developer, I want midpoint-based ordering and automatic rebalancing so that drag-and-drop reordering works reliably without running out of precision.

**Acceptance Criteria:**
- [ ] `packages/core/src/order.ts` implements `reorderTicket(dir, id, afterId, beforeId)` — calculates midpoint order value between neighbors
- [ ] `rebalanceOrder(dir, status)` normalizes order values to clean integers when gaps get too small
- [ ] Rebalance triggers automatically when a midpoint would require more than 10 decimal places
- [ ] Tickets without an explicit `order` sort after ordered tickets, falling back to priority then updated date

### US-006: REST API Server
As a developer, I want a Bun HTTP server exposing all core functions as REST endpoints so that the UI has a clean API to consume.

**Acceptance Criteria:**
- [ ] `packages/server/src/index.ts` starts `Bun.serve()` with route matching
- [ ] `packages/server/src/api.ts` implements all REST routes: `GET /api/tickets`, `GET /api/tickets/:id`, `POST /api/tickets`, `PATCH /api/tickets/:id`, `PATCH /api/tickets/:id/body`, `DELETE /api/tickets/:id`, `POST /api/tickets/:id/restore`, `PATCH /api/tickets/:id/reorder`, `PATCH /api/tickets/:id/subtask`, `GET /api/meta`, `GET /api/config`, `PATCH /api/config`
- [ ] All routes call the core library — no state duplication
- [ ] CORS middleware allows localhost origins
- [ ] Server serves the built UI as static files from the same process
- [ ] Proper error responses (400 for validation errors, 404 for missing tickets)

### US-007: SSE Live Updates
As a developer, I want the server to push real-time events when ticket files change on disk so that the UI stays current when tickets are edited outside the UI (by agents, editors, or git operations).

**Acceptance Criteria:**
- [ ] `packages/server/src/watcher.ts` uses `fs.watch` on the `.tickets/` directory
- [ ] `GET /api/events` SSE endpoint pushes events to all connected clients
- [ ] Events include ticket ID and change type (created, updated, deleted)
- [ ] Rapid file changes are debounced (100ms window) to avoid hammering on bulk operations
- [ ] UI reconnects automatically if the SSE connection drops

### US-008: Basic UI — Ticket List Panel
As a user, I want a scrollable ticket list grouped by status so that I can assess project state at a glance.

**Acceptance Criteria:**
- [ ] Left panel (~300px) displays tickets grouped by status in order: In Progress → Open → Backlog → Done → Cancelled
- [ ] Each group has a collapsible header with status name and ticket count
- [ ] Each ticket row shows: title (bold), ID (muted), priority indicator, tags (small chips), relative timestamp
- [ ] Sorting within groups: by `order` first, then priority (urgent first), then updated date (newest first)
- [ ] Clicking a ticket row selects it and opens it in the detail panel
- [ ] Active ticket row is visually highlighted
- [ ] SSE events trigger automatic list refresh

### US-009: Basic UI — Ticket Detail Panel
As a user, I want to view and edit a ticket's metadata and body inline so that updating a ticket feels like editing a document, not filling out a form.

**Acceptance Criteria:**
- [ ] Right panel shows full ticket detail when a ticket is selected
- [ ] Title is large and editable inline — click to edit, blur or Enter to save
- [ ] Metadata row with editable dropdown chips: status, priority, project, epic, sprint, tags
- [ ] Status and priority are select-from-list; project/epic/sprint are comboboxes (select existing or type new); tags are a tag input
- [ ] Plain textarea for body (tiptap comes in Phase 2)
- [ ] Changes to metadata save immediately via API
- [ ] When no ticket is selected, shows an empty state with keyboard shortcut hints

### US-010: Basic UI — Create and Delete Tickets
As a user, I want to create new tickets quickly and delete tickets with confirmation so that ticket management is fast and safe.

**Acceptance Criteria:**
- [ ] `+` button in header and `Cmd+N` shortcut open a new ticket in the detail panel
- [ ] New ticket has: title focused and empty, status defaulted to `open`, all other fields empty
- [ ] Ticket file is created on disk when the user types a title and blurs/presses Enter (no empty files)
- [ ] Delete button with confirmation dialog shows "Archive" or "Delete" based on config `deleteMode`
- [ ] Search input in header with debounced filtering (200ms) across title and body content

### US-011: CLI Entry Point
As a developer, I want a `ticketbook` CLI command that starts the server and opens the UI so that launching is a single command from any directory in a repo.

**Acceptance Criteria:**
- [ ] `bin/ticketbook.ts` is the CLI entry point, runnable via `bunx ticketbook`
- [ ] Discovers `.tickets/` by walking up from cwd (like git finds `.git/`), or via `--dir` flag or positional path argument
- [ ] `ticketbook init` scaffolds `.tickets/` directory with `.config.yaml`, `.counter` (set to 1), and adds `.tickets/.archive/` to `.gitignore`
- [ ] `--port` flag (default: auto-assigned) and `--no-ui` flag (server only, for API/MCP use)
- [ ] `--mcp` flag starts MCP server mode (stdio transport, no HTTP)
- [ ] If no `.tickets/` found, offers to run `ticketbook init`

### US-012: Tiptap Rich Text Editor
As a user, I want a rich markdown editor with interactive checkboxes so that editing ticket bodies feels polished and task lists are clickable.

**Acceptance Criteria:**
- [ ] Replace the plain textarea with a tiptap editor in the ticket detail panel
- [ ] Extensions installed: StarterKit, TaskList, TaskItem, Link, CodeBlock (with lowlight/shiki syntax highlighting), Placeholder, Markdown
- [ ] Markdown round-trip: loads markdown → prosemirror on open, serializes prosemirror → markdown on save
- [ ] Interactive checkboxes toggle on click and update the file via API
- [ ] Placeholder text when body is empty: "Add context, tasks, notes..."
- [ ] No formatting toolbar — uses slash commands and keyboard shortcuts (Cmd+B, etc.)

### US-013: Tiptap Slash Commands and Auto-Save
As a user, I want slash commands for block types and auto-save so that I can write without reaching for a toolbar or save button.

**Acceptance Criteria:**
- [ ] Typing `/` opens a command menu with options: heading, checklist, code block, quote
- [ ] Selecting a command inserts the corresponding block type
- [ ] Auto-save triggers 500ms after the user stops typing (debounced)
- [ ] A subtle "Saving..." / "Saved" indicator appears near the title
- [ ] No manual save button needed

### US-014: List View Drag-and-Drop Reordering
As a user, I want to drag tickets within a status group to reorder them so that I can manually prioritize my work.

**Acceptance Criteria:**
- [ ] `@dnd-kit/core`, `@dnd-kit/sortable`, and `@dnd-kit/utilities` installed
- [ ] A drag handle (grip icon) appears on hover at the left edge of each ticket row
- [ ] Dragging a ticket within its status group reorders it — a thin drop indicator line shows the target position
- [ ] On drop, the ticket's `order` is updated via `PATCH /api/tickets/:id/reorder`
- [ ] Optimistic UI update (instant visual feedback, rolls back on API error)
- [ ] Keyboard DnD: Space to pick up, arrow keys to move, Space to drop
- [ ] Dragging between status groups in list view is not supported

### US-015: MCP Server with Tools
As an AI agent, I want MCP tools for full ticket CRUD so that I can read, create, and update tickets natively from Claude Code.

**Acceptance Criteria:**
- [ ] `packages/server/src/mcp.ts` registers all MCP tools with Zod schemas: `list_tickets`, `get_ticket`, `create_ticket`, `update_ticket`, `delete_ticket`, `complete_subtask`, `add_subtask`, `reorder_ticket`
- [ ] Uses `@modelcontextprotocol/sdk` with stdio transport
- [ ] `list_tickets` supports optional filters (status, project, sprint, epic, priority, tags) and returns compact summaries
- [ ] `get_ticket` returns full ticket details including body
- [ ] `complete_subtask` marks a subtask as done by index or text match
- [ ] All tools call the core library directly

### US-016: MCP Resources and Prompt Templates
As an AI agent, I want a ticket list resource and a ticket-context prompt so that I can efficiently scan all tickets and kick off work on a specific ticket.

**Acceptance Criteria:**
- [ ] Resource `tickets://list` returns the full ticket list (compact format)
- [ ] Prompt template `ticket-context` takes a ticket ID and returns formatted prompt with ticket details, subtasks, and related context
- [ ] README includes Claude Code MCP config instructions with example JSON (`bunx ticketbook --mcp` command, cwd pointing to the repo)

### US-017: Kanban Board Layout
As a user, I want a horizontal kanban board with one column per status so that I can visualize work across all stages.

**Acceptance Criteria:**
- [ ] Board view renders columns in order: Backlog → Open → In Progress → Done → Cancelled
- [ ] Each column has a header with status name and ticket count
- [ ] Compact ticket cards show: title (bold), ID (muted), priority dot, tags
- [ ] Each column scrolls vertically independently when tickets overflow
- [ ] Done and Cancelled columns can be collapsed to a narrow strip with rotated label and count

### US-018: Kanban Board Drag-and-Drop
As a user, I want to drag tickets between kanban columns to change status and within columns to reorder so that I can manage workflow visually.

**Acceptance Criteria:**
- [ ] Reorder within a column: dragging a card up/down updates its `order` value
- [ ] Move between columns: dragging a card to a different column updates both `status` and `order` in a single operation
- [ ] Drop indicator line between cards at the target position
- [ ] Target column gets a subtle highlight border on drag-over
- [ ] Optimistic UI updates with rollback on API error
- [ ] Keyboard DnD: cards are focusable, Space picks up, arrow keys move, Space drops

### US-019: Kanban Detail Slide-Over
As a user, I want clicking a kanban card to open the ticket detail in a slide-over panel so that I can view and edit without leaving the board context.

**Acceptance Criteria:**
- [ ] Clicking (not dragging) a card opens a detail panel sliding in from the right (~60% board width)
- [ ] Panel content is the same as the list view detail panel (editable title, metadata, tiptap editor)
- [ ] Click outside the panel or press Escape to close it
- [ ] Board remains visible and scrollable behind the overlay

### US-020: View Toggle (List / Board)
As a user, I want to switch between list and board views so that I can use whichever layout suits my current task.

**Acceptance Criteria:**
- [ ] Segmented control in the header bar: `List | Board`
- [ ] View selection persists in localStorage across sessions
- [ ] Both views share the same header bar (filters, search, new ticket button)
- [ ] Active filters and search query apply to both views

### US-021: Keyboard Shortcut System
As a power user, I want keyboard shortcuts for common actions so that I can navigate and manage tickets without touching the mouse.

**Acceptance Criteria:**
- [ ] `Cmd+N` creates a new ticket
- [ ] `Cmd+K` focuses the search input
- [ ] `Cmd+Shift+L` switches to list view; `Cmd+Shift+B` switches to board view
- [ ] `↑` / `↓` navigate the ticket list
- [ ] `Enter` opens the selected ticket (focuses body editor)
- [ ] `Escape` returns to list / closes detail slide-over
- [ ] `Cmd+Backspace` deletes (archives) ticket with confirmation
- [ ] `1`-`4` set priority when a ticket is selected and the editor is not focused

### US-022: Filter Chips and Search Polish
As a user, I want multi-select filter dropdowns in the header so that I can quickly narrow down tickets by status, project, epic, or sprint.

**Acceptance Criteria:**
- [ ] Dropdown chips in header for: Status, Project, Epic, Sprint
- [ ] Each chip opens a multi-select dropdown; active filters show as filled chips
- [ ] Clicking a chip toggles/opens its dropdown
- [ ] Search input shows result count
- [ ] Filters and search compose (e.g., filter by project AND search by keyword)

### US-023: Visual Polish — Priority, Tags, Transitions
As a user, I want polished visual indicators and smooth micro-interactions so that the UI feels responsive and professional.

**Acceptance Criteria:**
- [ ] Priority dot indicators with color coding: urgent = red, high = orange, medium = yellow, low = gray, none = no dot
- [ ] Tag chips with add/remove interaction on ticket detail
- [ ] Combobox for project/epic/sprint supports type-to-create (select existing or type a new value)
- [ ] Subtle transitions on hover and status changes (150ms ease)
- [ ] Status bar at bottom showing ticket count, open count, in-progress count

### US-024: Responsive Layout and Empty States
As a user, I want the UI to degrade gracefully on narrow screens and show helpful empty states so that the experience is never broken or confusing.

**Acceptance Criteria:**
- [ ] Below 768px, layout switches to single-panel: list or detail, with a back button to return to the list
- [ ] Empty state for no tickets: shows a welcome message and create shortcut hint
- [ ] Empty state for no search results: shows "No tickets match" message
- [ ] Empty state for no ticket selected: shows shortcut hints in the detail panel
- [ ] Done and Cancelled groups in list view are collapsed by default

### US-025: Settings Panel
As a user, I want a settings panel to configure the ticket ID prefix and delete behavior so that I can customize Ticketbook per repo without editing YAML files.

**Acceptance Criteria:**
- [ ] Settings accessible from a gear icon in the header bar
- [ ] Allows editing `prefix` (ticket ID prefix, e.g., `TKT`, `ART`)
- [ ] Allows toggling `deleteMode` between `archive` and `hard`
- [ ] Changes save to `.tickets/.config.yaml` via `PATCH /api/config`
- [ ] Settings panel can be a dialog or slide-over

## Functional Requirements

- FR-1: All ticket data is stored as markdown files in `.tickets/` — no database, no external state
- FR-2: The core library is pure TypeScript with no framework dependencies (only `gray-matter` and `zod`)
- FR-3: The server uses `Bun.serve()` with manual routing — no web framework
- FR-4: REST API routes map 1:1 to core library functions
- FR-5: MCP server uses stdio transport and the official `@modelcontextprotocol/sdk`
- FR-6: The UI is a standalone Vite + React app using Tailwind CSS 4 and a subset of shadcn/ui components
- FR-7: The tiptap editor round-trips markdown faithfully (no data loss on load/save cycles)
- FR-8: `fs.watch` triggers SSE events for any file change in `.tickets/` — UI stays in sync with disk
- FR-9: Drag-and-drop uses `@dnd-kit` and is keyboard-accessible
- FR-10: Ticket IDs are immutable after creation; file slugs never change even if the title is edited
- FR-11: The CLI discovers `.tickets/` by walking up from cwd, or via explicit `--dir` / positional argument
- FR-12: `ticketbook init` creates `.tickets/`, `.config.yaml`, `.counter`, and adds `.archive/` to `.gitignore`
- FR-13: Optional frontmatter fields are omitted entirely when not set (no null values in YAML)
- FR-14: Tags are normalized on write: trimmed, lowercased, deduplicated
- FR-15: The `rebalanceOrder()` function normalizes order values when midpoint precision exceeds 10 decimal places

## Non-Goals (Out of Scope)

- **Multi-user / collaboration.** No assignees, no permissions, no conflict resolution beyond git merge
- **Notifications / reminders.** No due dates, no alerts
- **Time tracking.** No estimates, no time logged, no velocity
- **GitHub/Linear sync.** No bidirectional sync with external tools — tickets live in git
- **Rich media in tickets.** No image uploads or file attachments — links to external resources only
- **Full CLI ticket management.** No `ticketbook add` or `ticketbook list` — MCP tools and UI cover this
- **Kanban-only mode.** Board is a view mode, not a standalone app

## Technical Considerations

- **Monorepo structure:** Bun workspaces with `packages/core`, `packages/server`, `packages/ui`
- **Core portability:** Core uses `fs/promises` (not `Bun.file()`) so it remains Node-compatible
- **shadcn/ui scaffolding:** Initialize with `bunx --bun shadcn@latest init --preset b1Zh5UfpA --template vite`, then add only: Button, DropdownMenu, Popover, Command, Badge, Dialog, Tooltip
- **Editor:** tiptap with StarterKit, TaskList, TaskItem, Link, CodeBlock (lowlight/shiki), Placeholder, Markdown extensions
- **DnD library:** `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` — reference [ReUI kanban component](https://reui.io/docs/components/base/kanban) for shadcn integration patterns
- **Color palette:** Background `#FAFAFA`, white cards, dark gray text `#1A1A1A`, secondary `#6B7280`, accent in indigo/blue family
- **Typography:** System font stack (Inter if available), max 3 sizes

## Success Metrics

- All ticket CRUD operations work end-to-end: UI → API → core → disk → SSE → UI refresh
- MCP tools are functional in Claude Code — an agent can list, create, update, and complete subtasks
- Tickets round-trip through the tiptap editor without markdown data loss
- Drag-and-drop works in both list and kanban views with keyboard accessibility
- The UI renders a list of 100+ tickets without perceptible lag
- A file change on disk (by an agent or editor) reflects in the UI within 1 second

## Open Questions

- Should the archive directory (`.tickets/.archive/`) be gitignored by default, or tracked? (Current decision: gitignored, user can opt-in to tracking)
- Should `ticketbook init` add a `.tickets/.gitkeep` for empty initial commit?
- Should the MCP server support HTTP transport in addition to stdio for non-Claude-Code clients?
- What's the upper bound on ticket count before in-memory filtering becomes a bottleneck? (Likely thousands, but worth benchmarking)