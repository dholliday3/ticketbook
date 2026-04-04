# PRD: Ticketbook

A lightweight, git-backed ticket manager with a clean local UI and MCP server. Tickets are flat markdown files with YAML frontmatter, stored in-repo, readable by humans and agents alike. The UI is a standalone Vite + React app inspired by Linear's information density and Plannotator's focused simplicity.

**Status:** Draft
**Date:** April 2026

---

## 1. Why This Exists

PRDs are great for upfront planning but bad for tracking granular work. Linear is great for tracking but heavy for solo projects and lives outside the repo. There's no lightweight middle ground that:

- Stores tickets as plain files in git (diffable, greppable, version-controlled)
- Gives agents structured context they can read and update
- Has a UI that doesn't feel like editing raw markdown

Ticketbook fills that gap. It's a tool for developers who want to plan and track work in their repo with a clean interface, not a project management platform.

---

## 2. Design Principles

1. **Files are the source of truth.** Everything is a markdown file. No database, no sync, no lock-in. `git log` is your audit trail.
2. **Minimal viable metadata.** A few optional frontmatter fields, not a schema you have to fill out.
3. **Fast to create, fast to scan.** Creating a ticket should be faster than opening a new file. The list view should let you assess project state in seconds.
4. **Agents are first-class users.** The MCP server means Claude Code (or any MCP client) can read, create, and update tickets natively. Subtask checkboxes in the body are the agent's worklist.
5. **No opinions about workflow.** Statuses exist, but there are no enforced transitions, no required fields beyond title, no mandatory processes.

---

## 3. Ticket File Format

### 3.1 Location

All tickets live in a single flat directory at the repo root:

```
.tickets/
  TKT-001-setup-prisma-schema.md
  TKT-002-add-ticket-search.md
  TKT-003-fix-sse-reconnect.md
```

**File naming:** `{id}-{slugified-title}.md`. The slug is derived from the title at creation time and never changes, even if the title is edited. This keeps file paths stable for git history and agent references.

**Counter file:** `.tickets/.counter` stores the next ticket number as a plain integer. Incremented atomically on creation. Avoids ID collisions without needing a database.

**Config file:** `.tickets/.config.yaml` stores per-repo settings. Created by `ticketbook init` with defaults. Optional — if missing, defaults are used.

```yaml
prefix: TKT        # ticket ID prefix (default: TKT)
deleteMode: archive # "archive" moves to .tickets/.archive/, "hard" deletes the file (default: archive)
```

### 3.2 Frontmatter Schema

```yaml
---
id: TKT-042
title: Add ticket search
status: open            # backlog | open | in-progress | done | cancelled
priority: high          # low | medium | high | urgent  (optional)
order: 1                # manual sort order within status group (optional)
tags: [ui, search]      # freeform string array          (optional)
project: ticketbook     # project grouping                (optional)
epic: ui-polish         # epic grouping                   (optional)
sprint: week-14         # sprint/iteration grouping       (optional)
created: 2026-04-01T10:30:00Z
updated: 2026-04-03T14:15:00Z
---
```

**Required fields:** `id`, `title`, `status`, `created`, `updated`
**Optional fields:** `priority`, `order`, `tags`, `project`, `epic`, `sprint`

All optional fields are omitted from the file entirely when not set (no `priority: null` noise).

**`order`** is a float that controls manual sort position within a status group. When a ticket is dragged between two others, its order is set to the midpoint of its neighbors (e.g., dragging between order 1.0 and 2.0 gives 1.5). Tickets without an explicit order sort after ordered tickets, falling back to priority then updated-date. The core library includes a `rebalanceOrder()` function that normalizes order values to clean integers when the gaps get too small (called automatically when a midpoint would require more than 10 decimal places).

**Projects, epics, and sprints** are plain strings, not separate entities with their own metadata. The UI derives the list of available values by scanning existing tickets. This means you create a new project by simply typing a new project name on a ticket — no setup step.

### 3.3 Body

Everything below the frontmatter is freeform markdown. The convention (not enforced) is:

```markdown
## Context
Why this work exists, any relevant links or PRD references.

## Tasks
- [ ] First subtask
- [ ] Second subtask
- [x] Already completed subtask

## Notes
Anything else — decisions, blockers, open questions.
```

The `## Tasks` section with checkboxes is the primary integration point for agents. An agent working a ticket reads the body, works through the checklist, and checks items off as it goes.

---

## 4. Architecture

```
ticketbook/
├── packages/
│   ├── core/              # Ticket CRUD library (pure TS, no framework)
│   │   ├── src/
│   │   │   ├── reader.ts      # Parse .tickets/ directory
│   │   │   ├── writer.ts      # Create/update/delete/archive ticket files
│   │   │   ├── schema.ts      # Zod schemas for frontmatter + config
│   │   │   ├── id.ts          # ID generation + counter management
│   │   │   ├── config.ts      # Read/write .config.yaml
│   │   │   ├── order.ts       # Midpoint calculation + rebalancing
│   │   │   └── types.ts       # Shared TypeScript types
│   │   └── package.json
│   ├── server/            # HTTP API + MCP server
│   │   ├── src/
│   │   │   ├── index.ts       # Bun.serve() entry point
│   │   │   ├── api.ts         # REST routes (used by UI)
│   │   │   ├── mcp.ts         # MCP tool registrations
│   │   │   └── watcher.ts     # fs.watch for live reload
│   │   └── package.json
│   └── ui/                # React frontend
│       ├── src/
│       │   ├── app.tsx
│       │   ├── components/
│       │   ├── hooks/
│       │   └── lib/
│       ├── index.html
│       └── package.json
├── package.json           # Bun workspace root
└── bin/
    └── ticketbook.ts      # CLI entry: `npx ticketbook`
```

### 4.1 Core Library (`packages/core`)

Pure TypeScript, no runtime dependencies beyond `gray-matter` (frontmatter parsing) and `zod` (schema validation). Uses Node-compatible `fs/promises` APIs (not Bun-specific `Bun.file()`) so the core remains portable. This is the single source of truth for reading and writing ticket files.

**Key functions:**

```typescript
// Reading
listTickets(dir: string, filters?: TicketFilters): Promise<Ticket[]>
getTicket(dir: string, id: string): Promise<Ticket | null>
searchTickets(dir: string, query: string): Promise<Ticket[]>

// Writing
createTicket(dir: string, input: CreateTicketInput): Promise<Ticket>
updateTicket(dir: string, id: string, patch: TicketPatch): Promise<Ticket>
deleteTicket(dir: string, id: string): Promise<void>  // archive or hard delete per config
restoreTicket(dir: string, id: string): Promise<Ticket> // restore from archive

// Ordering
reorderTicket(dir: string, id: string, afterId: string | null, beforeId: string | null): Promise<void>
rebalanceOrder(dir: string, status: string): Promise<void>

// Subtasks
toggleSubtask(dir: string, id: string, taskIndex: number): Promise<Ticket>
addSubtask(dir: string, id: string, text: string): Promise<Ticket>

// Metadata (derived from scanning tickets)
getProjects(dir: string): Promise<string[]>
getEpics(dir: string): Promise<string[]>
getSprints(dir: string): Promise<string[]>
getTags(dir: string): Promise<string[]>

// Config
getConfig(dir: string): Promise<TicketbookConfig>
updateConfig(dir: string, patch: Partial<TicketbookConfig>): Promise<TicketbookConfig>
```

`TicketFilters` supports: `status`, `priority`, `project`, `epic`, `sprint`, `tags`, and `search` (full-text across title + body).

### 4.2 Server (`packages/server`)

A single Bun process that serves two things:

1. **REST API** — for the web UI. Routes map 1:1 to core library functions.
2. **MCP server** — for Claude Code and other agents. Exposed via stdio transport (spawned by Claude Code as a subprocess).

The REST API and MCP server both call the same core library. No state duplication.

**REST routes:**

```
GET    /api/tickets              # list + filter (query params)
GET    /api/tickets/:id          # get one
POST   /api/tickets              # create
PATCH  /api/tickets/:id          # update frontmatter
PATCH  /api/tickets/:id/body     # update body (separate to avoid conflicts)
DELETE /api/tickets/:id          # archive or hard delete per config
POST   /api/tickets/:id/restore  # restore from archive
PATCH  /api/tickets/:id/reorder  # { afterId?, beforeId? } — set order between neighbors
PATCH  /api/tickets/:id/subtask  # toggle or add subtask
GET    /api/meta                 # { projects, epics, sprints, tags, statuses }
GET    /api/config               # get config
PATCH  /api/config               # update config
GET    /api/events               # SSE stream for live updates
```

**File watcher:** The server watches `.tickets/` with `fs.watch`. When files change on disk (e.g., an agent edits a file directly, or the user edits in their editor), the server pushes an SSE event to all connected UI clients. This means the UI stays current even when tickets are modified outside the UI.

**Why raw Bun:** The server is simple enough that `Bun.serve()` with a manual router is sufficient. No need for Elysia's plugin system, validation decorators, or middleware chain. If routing gets complex later, we can drop in Hono or Elysia without changing the core library.

### 4.3 MCP Server

Registered tools for Claude Code:

| Tool | Description |
|---|---|
| `list_tickets` | List tickets with optional filters (status, project, sprint, epic, priority, tags). Returns compact summaries. |
| `get_ticket` | Get full ticket details including body, by ID. |
| `create_ticket` | Create a new ticket. Required: title. Optional: status, priority, order, tags, project, epic, sprint, body. |
| `update_ticket` | Update any frontmatter field or body on an existing ticket. |
| `delete_ticket` | Archive or hard-delete a ticket (per repo config). |
| `complete_subtask` | Mark a specific subtask checkbox as done (by index or text match). |
| `add_subtask` | Append a new subtask to the Tasks section. |
| `reorder_ticket` | Move a ticket to a new position within its status group (specify afterId/beforeId). |

**Resource:** `tickets://list` — a resource that returns the full ticket list, useful for agents that want to scan all tickets at the start of a session.

**Prompt:** `ticket-context` — a prompt template that takes a ticket ID and returns a formatted prompt with the ticket details, subtasks, and related context. Useful for kicking off agent work on a specific ticket.

### 4.4 Repo Discovery

Ticketbook is a standalone tool that points at any repo containing a `.tickets/` directory. It discovers the target directory using this precedence:

1. **Explicit `--dir` flag** — `ticketbook --dir ~/code/artisan/.tickets` points directly at a tickets directory.
2. **Positional path argument** — `ticketbook ~/code/artisan` looks for `.tickets/` inside the given path.
3. **Walk-up from cwd** — if no path is given, walk up from the current working directory looking for `.tickets/`, the same way `git` finds `.git/`. This means running `ticketbook` from anywhere inside a repo just works.

If no `.tickets/` directory is found, the CLI offers to run `ticketbook init` in the current directory.

For the MCP server, the discovery works the same way — Claude Code sets `cwd` to the repo root in its MCP config:

```json
{
  "mcpServers": {
    "ticketbook": {
      "command": "bunx",
      "args": ["ticketbook", "--mcp"],
      "cwd": "/Users/daniel/code/artisan"
    }
  }
}
```

The server reads `cwd`, walks up to find `.tickets/`, and all MCP tool calls operate on that directory. No extra configuration needed.

### 4.5 CLI

The CLI is thin — it just starts the server and/or opens the UI. Not a full ticket management CLI (the MCP tools and UI cover that).

```bash
ticketbook                          # Start server + open UI, discover .tickets/ from cwd
ticketbook ~/code/artisan           # Point at a specific repo
ticketbook --dir ~/code/artisan/.tickets  # Point at a specific .tickets/ dir
ticketbook --port 4444              # Custom port
ticketbook --no-ui                  # Server only (for MCP/API use)
ticketbook --mcp                    # MCP server mode (stdio transport, no HTTP)
ticketbook init                     # Create .tickets/ dir + .config.yaml + .counter in cwd
ticketbook init ~/code/artisan      # Create .tickets/ in a specific repo
```

---

## 5. UI Design

### 5.1 Design Language

The UI borrows from Linear's design philosophy: high information density, minimal chrome, keyboard-first, and a muted color palette that lets content breathe.

**Color palette:**
- Background: near-white (`#FAFAFA`) with pure white cards
- Text: dark gray (`#1A1A1A`) for primary, medium gray (`#6B7280`) for secondary
- Accent: a single saturated color for interactive elements and status indicators (indigo/blue family)
- Status colors: muted, not primary — status is indicated, not shouted

**Typography:**
- System font stack (Inter if available). One size for body, slightly larger for titles, slightly smaller for metadata. No more than 3 sizes.

**Spacing:**
- Generous but not wasteful. Enough padding to feel calm, tight enough that a list of 20 tickets fits on screen without scrolling.

**Micro-interactions:**
- Subtle transitions on hover and status changes (150ms ease). No bouncing, no sliding panels. Things appear and update in place.

### 5.2 View Modes

The app has two view modes, toggled via a segmented control in the header bar: **List** (default) and **Board** (kanban). Both views share the same header bar (filters, search, new ticket button). Selecting a ticket in either view opens the detail panel.

### 5.3 List View Layout

Two-panel layout:

```
┌──────────────────────────────────────────────────────┐
│  [Ticketbook]        [filters]  [search]   [+ New]   │
├──────────────────────┬───────────────────────────────┤
│                      │                               │
│  Ticket List         │  Ticket Detail                │
│                      │                               │
│  ┌────────────────┐  │  Title (editable)             │
│  │ TKT-042        │  │  Status · Priority · Tags     │
│  │ Add search     │  │  Project · Epic · Sprint      │
│  │ high · ui      │  │                               │
│  │ 2 min ago      │  │  ─────────────────────        │
│  └────────────────┘  │                               │
│                      │  [Tiptap editor]              │
│  ┌────────────────┐  │                               │
│  │ TKT-041        │  │  Rich markdown body with      │
│  │ Fix reconnect  │  │  interactive checkboxes,      │
│  │ medium · infra │  │  headings, code blocks,       │
│  │ 1 hr ago       │  │  and links.                   │
│  └────────────────┘  │                               │
│                      │                               │
│  ...                 │                               │
│                      │                               │
├──────────────────────┴───────────────────────────────┤
│  12 tickets · 3 open · 2 in progress                 │
└──────────────────────────────────────────────────────┘
```

**Left panel (ticket list):** ~300px wide. Each ticket row shows: title (bold), ID (muted), priority indicator (colored dot), tags (small chips), relative timestamp. Rows are grouped by status with collapsible section headers. Active ticket is highlighted.

**Right panel (ticket detail):** Takes remaining width. Shows the full ticket with all metadata editable inline and the tiptap editor for the body.

**No detail selected state:** When no ticket is selected, the right panel shows a minimal empty state — just a muted message and keyboard shortcut hints.

### 5.4 Board View Layout (Kanban)

A horizontal kanban board with one column per status. Columns are ordered: Backlog → Open → In Progress → Done → Cancelled.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  [Ticketbook]  [List | Board]  [filters]  [search]            [+ New]   │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Backlog (3)      Open (5)        In Progress (2)     Done (8)          │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐       ┌──────────┐       │
│  │ TKT-012  │    │ TKT-042  │    │ TKT-007  │       │ TKT-001  │       │
│  │ Research  │    │ Add      │    │ SSE live │       │ Setup    │       │
│  │ ● high   │    │ search   │    │ reload   │       │ schema   │       │
│  │ ui, ux   │    │ ● high   │    │ ● high   │       │          │       │
│  └──────────┘    │ ui       │    └──────────┘       └──────────┘       │
│  ┌──────────┐    └──────────┘    ┌──────────┐       ┌──────────┐       │
│  │ TKT-015  │    ┌──────────┐    │ TKT-041  │       │ TKT-003  │       │
│  │ Explore  │    │ TKT-038  │    │ Fix      │       │ Add auth │       │
│  │ tiptap   │    │ API      │    │ reconnect│       │          │       │
│  └──────────┘    │ docs     │    │ ● medium │       └──────────┘       │
│                  └──────────┘    └──────────┘                           │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Columns:** Each column has a header with the status name and ticket count. Columns scroll vertically independently if tickets overflow.

**Cards:** Compact ticket cards showing: title (bold), ID (muted), priority dot, tags. Clicking a card opens the detail panel as a slide-over from the right (overlays the board, doesn't replace it).

**Drag and drop:** Powered by `@dnd-kit` (specifically `@dnd-kit/core` + `@dnd-kit/sortable`). Two drag operations:

1. **Reorder within a column** — dragging a card up/down within the same status group changes its `order` value. The card animates into its new position. On drop, the server receives a `PATCH /api/tickets/:id/reorder` with the IDs of the cards above and below.

2. **Move between columns** — dragging a card to a different column changes its `status` and inserts it at the drop position. This is a single API call: `PATCH /api/tickets/:id` with the new status + `PATCH /api/tickets/:id/reorder` with the new neighbors. The UI optimistically updates both the source and target columns.

**Drop indicators:** A thin colored line appears between cards at the drop position. The target column gets a subtle highlight border when a card is dragged over it.

**Keyboard accessibility:** Cards are focusable. `Space` picks up a card, arrow keys move it, `Space` again drops it. Screen readers announce the card title and drop position.

**Collapsed columns:** Done and Cancelled columns can be collapsed to a narrow strip showing just the status name rotated vertically and the count. Click to expand.

**Detail slide-over:** When a card is clicked (not dragged), a detail panel slides in from the right, covering roughly 60% of the board width. It shows the full ticket detail (same as the list view's right panel). Clicking outside or pressing Escape closes it.

### 5.5 Header Bar

Minimal. Contains:

- **App name** (left) — "Ticketbook" in the logo font, not a link to anything.
- **View toggle** (left of center) — segmented control: `List | Board`. Remembers last selection in localStorage.
- **Filter controls** (center) — dropdown chips for: Status, Project, Epic, Sprint. Each is a multi-select dropdown that filters the list/board. Active filters show as filled chips. Clicking a chip toggles/opens its dropdown.
- **Search** (center-right) — a search input that filters by title and body content. Debounced 200ms. Shows result count.
- **New ticket button** (right) — `+` button or `Cmd+N` shortcut.

### 5.6 Ticket List

Each row in the list:

```
┌─────────────────────────────┐
│  ● Add ticket search        │  ← priority dot + title
│  TKT-042 · ui, search       │  ← id + tags
│  ticketbook · 2 min ago      │  ← project + relative time
└─────────────────────────────┘
```

**Grouping:** Tickets are grouped by status in this order: In Progress → Open → Backlog → Done → Cancelled. Each group has a header showing the status name and count. Done and Cancelled are collapsed by default.

**Sorting within groups:** By `order` field first (ascending), then by priority (urgent first), then by updated date (most recent first). Tickets with an explicit `order` always sort before those without one.

**Drag-and-drop reordering:** Tickets can be dragged within their status group to reorder. A thin line indicator shows the drop position. On drop, the ticket's `order` is updated to slot between its new neighbors. Drag-and-drop uses `@dnd-kit/sortable` — the same library as the kanban view. Dragging between status groups in the list view is not supported (use the metadata dropdown or the board view for that).

**A subtle drag handle** (⠿ grip icon) appears on hover at the left edge of each ticket row. The handle is the drag target — clicking the row itself still selects the ticket.

**Priority indicators:** A small colored dot before the title. Urgent = red, high = orange, medium = yellow, low = gray. No priority = no dot.

### 5.7 Ticket Detail

**Title:** Large, editable inline. Click to edit, blur or Enter to save. Feels like typing into a document title, not filling out a form field.

**Metadata row:** Horizontal row of editable chips below the title:

```
[In Progress ▾]  [High ▾]  [ticketbook ▾]  [ui-polish ▾]  [week-14 ▾]  [ui] [search] [+]
 status          priority    project         epic           sprint       tags
```

Each chip is a dropdown/combobox. Status and priority are select-from-list. Project, epic, and sprint are comboboxes — you can select an existing value or type a new one. Tags are a tag input — type and press Enter to add.

**Divider** — a thin rule separating metadata from body.

**Body (tiptap editor):**

The markdown editor is the heart of the detail view. It uses tiptap with these extensions:

- **StarterKit** — headings, bold, italic, code, blockquote, lists, hard break, horizontal rule
- **TaskList + TaskItem** — interactive checkboxes that map to `- [ ]` / `- [x]` in markdown
- **Link** — clickable links
- **Code Block** — syntax-highlighted code blocks (via lowlight/shiki)
- **Placeholder** — gray hint text when the body is empty: "Add context, tasks, notes..."
- **Markdown** — serialize/deserialize to and from markdown (tiptap markdown extension)

**No formatting toolbar.** The editor uses slash commands (`/`) for block types and standard keyboard shortcuts (Cmd+B, etc.) for inline formatting. This keeps the UI minimal and lets the content area breathe.

**Auto-save:** The body auto-saves 500ms after the user stops typing (debounced). A subtle "Saving..." / "Saved" indicator appears near the title. No manual save button.

### 5.8 Creating a New Ticket

`Cmd+N` or the `+` button opens a new ticket in the detail panel with:
- Title focused and empty (cursor blinking, ready to type)
- Status defaulted to `open`
- All other fields empty
- Body empty with placeholder text

The ticket file is created on disk as soon as the user types a title and blurs/presses Enter. This avoids empty ticket files but makes creation feel instant.

### 5.9 Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+N` | New ticket |
| `Cmd+K` | Focus search |
| `Cmd+Shift+L` | Switch to list view |
| `Cmd+Shift+B` | Switch to board view |
| `↑` / `↓` | Navigate ticket list |
| `Enter` | Open selected ticket (focus body) |
| `Escape` | Back to list / close detail slide-over |
| `Cmd+Backspace` | Delete (archive) ticket with confirmation |
| `1`-`4` | Set priority (when ticket selected, not in editor) |

### 5.10 Responsive Behavior

Below 768px, the layout switches to single-panel: list view or detail view, with a back button to return to the list. This isn't a core use case (it's a dev tool), but it prevents the UI from breaking on smaller screens.

---

## 6. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| **Runtime + package manager** | Bun | Fast, native TS, good fs APIs. Used as both runtime (`Bun.serve()`) and package manager (`bun install`, `bun run`). Bun workspaces for the monorepo. |
| **Core library** | Pure TS + gray-matter + zod | No framework dependency, testable in isolation |
| **Server** | Bun.serve() | Simple enough for a few REST routes + SSE |
| **MCP** | @modelcontextprotocol/sdk | Official SDK, stdio transport for Claude Code |
| **UI framework** | React 19 + Vite | Standard, fast dev experience |
| **Styling** | Tailwind CSS 4 | Consistent with your existing projects |
| **Components** | shadcn/ui (select subset) | Don't import the whole library — just: Button, DropdownMenu, Popover, Command (for combobox), Badge, Dialog, Tooltip |
| **Drag and drop** | @dnd-kit/core + @dnd-kit/sortable + @dnd-kit/utilities | Best React DnD library — accessible, performant, works with virtualized lists. Used for both list reordering and kanban board. Reference: [ReUI kanban component](https://reui.io/docs/components/base/kanban) for shadcn integration patterns. |
| **Editor** | tiptap + @tiptap/pm + extensions | Best prosemirror wrapper, first-class React, markdown round-trip |
| **Markdown** | tiptap markdown extension | Bidirectional markdown ↔ prosemirror conversion |

### 6.1 UI Scaffolding

The `packages/ui/` package is initialized with shadcn's Vite preset:

```bash
cd packages/ui
bunx --bun shadcn@latest init --preset b1Zh5UfpA --template vite
```

This gives us a pre-configured Vite + React + Tailwind + shadcn setup. Individual components are added as needed:

```bash
bunx --bun shadcn@latest add button dropdown-menu popover command badge dialog tooltip
```

---

## 7. Implementation Phases

### Phase 1 — Core + Server + Bare-Bones UI

The goal is a working loop: create a ticket in the UI, see it on disk, edit it in the UI, see the changes in git.

**Core library:**
- [ ] Zod schema for frontmatter (required + optional fields, including `order` as optional float)
- [ ] `reader.ts`: scan `.tickets/`, parse each file with gray-matter, validate with zod, return typed array
- [ ] `writer.ts`: serialize ticket to frontmatter + body, write to disk with correct filename
- [ ] `id.ts`: read/increment `.counter` file, generate slugified filename, respect configurable prefix
- [ ] `config.ts`: read/write `.tickets/.config.yaml` (prefix, deleteMode), with defaults
- [ ] `types.ts`: `Ticket`, `CreateTicketInput`, `TicketPatch`, `TicketFilters`, `TicketbookConfig`
- [ ] Filter and search functions (in-memory, the dataset is small)
- [ ] Subtask toggle and add (regex-based checkbox manipulation in body string)
- [ ] `deleteTicket()` — archive mode (move to `.tickets/.archive/`) or hard delete, per config
- [ ] `restoreTicket()` — move from `.tickets/.archive/` back to `.tickets/`
- [ ] Ordering: `reorderTicket()` (midpoint calculation) + `rebalanceOrder()` (normalize to integers)

**Server:**
- [ ] `Bun.serve()` with route matching for REST API
- [ ] All REST endpoints wired to core library (including reorder, restore, config)
- [ ] CORS middleware (localhost only)
- [ ] SSE endpoint with fs.watch on `.tickets/` directory
- [ ] Serve the built UI as static files from the same server

**UI (functional, not polished):**
- [ ] Two-panel list layout with ticket list and detail
- [ ] Ticket list with status grouping and sorting (respecting `order` field)
- [ ] Ticket detail with inline-editable title and metadata dropdowns
- [ ] Plain textarea for body (tiptap comes in phase 2)
- [ ] Create new ticket flow
- [ ] Delete ticket with confirmation (shows "archive" or "delete" based on config)
- [ ] SSE integration for live updates
- [ ] Search input with debounced filtering

**CLI:**
- [ ] `ticketbook` command that starts server and opens browser
- [ ] `ticketbook init` to scaffold `.tickets/` directory + `.config.yaml` + `.counter`
- [ ] `--port` and `--no-ui` flags

### Phase 2 — Tiptap Editor + MCP Server + Drag-and-Drop

**Tiptap integration:**
- [ ] Replace textarea with tiptap editor
- [ ] Extensions: StarterKit, TaskList, TaskItem, Link, CodeBlock (lowlight), Placeholder, Markdown
- [ ] Slash command menu for block types (`/heading`, `/checklist`, `/code`, `/quote`)
- [ ] Markdown round-trip: load markdown → prosemirror on open, prosemirror → markdown on save
- [ ] Auto-save with debounce (500ms) and save indicator
- [ ] Interactive checkboxes that update the file on toggle

**Drag-and-drop (list view):**
- [ ] Install `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities`
- [ ] Drag handle on ticket rows (grip icon on hover)
- [ ] Sortable within status groups — reorder via drag
- [ ] Drop indicator line between cards
- [ ] Optimistic UI update + `PATCH /api/tickets/:id/reorder` on drop
- [ ] Keyboard DnD: Space to pick up, arrows to move, Space to drop

**MCP server:**
- [ ] MCP tool registrations with zod schemas for all tools (list, get, create, update, complete_subtask, add_subtask, reorder)
- [ ] Stdio transport setup for Claude Code integration
- [ ] Resource: `tickets://list`
- [ ] Prompt template: `ticket-context`
- [ ] README with Claude Code MCP config instructions

### Phase 3 — Kanban Board View

**Board layout:**
- [ ] Horizontal column layout with one column per status (Backlog → Open → In Progress → Done → Cancelled)
- [ ] Column headers with status name + ticket count
- [ ] Compact ticket cards (title, ID, priority dot, tags)
- [ ] Independent vertical scroll per column
- [ ] Collapsible Done/Cancelled columns (narrow strip with rotated label)

**Board drag-and-drop:**
- [ ] Reorder within columns (updates `order`)
- [ ] Move between columns (updates `status` + `order` in one operation)
- [ ] Drop indicator line + column highlight on drag-over
- [ ] Optimistic updates with rollback on error
- [ ] Keyboard DnD accessibility

**Detail slide-over:**
- [ ] Panel slides in from right on card click (~60% board width)
- [ ] Same content as list view detail panel
- [ ] Click outside or Escape to close
- [ ] Board remains visible and scrollable behind the overlay

**View toggle:**
- [ ] Segmented control in header: List | Board
- [ ] Persists selection in localStorage
- [ ] Filters and search apply to both views

### Phase 4 — UI Polish + Keyboard Shortcuts

- [ ] Keyboard shortcut system (Cmd+N, Cmd+K, arrow keys, etc.)
- [ ] Priority dot indicators with color coding
- [ ] Tag chips with add/remove
- [ ] Combobox for project/epic/sprint (type-to-create)
- [ ] Filter chips in header with multi-select dropdowns
- [ ] Collapse/expand status groups in list view (Done/Cancelled collapsed by default)
- [ ] Empty states (no tickets, no search results, no ticket selected)
- [ ] Responsive single-panel layout below 768px
- [ ] Subtle transitions and hover states (150ms ease)
- [ ] Status bar at bottom (ticket count, open/in-progress counts)
- [ ] Settings panel (accessible from header) for prefix and delete mode config

---

## 8. File Format Spec (Detailed)

This section is the canonical reference for anyone (human or agent) creating or parsing ticket files.

### 8.1 Filename

Pattern: `{ID}-{slug}.md`

- `{ID}` — uppercase prefix (configurable via `.config.yaml`, default `TKT`) + hyphen + zero-padded number, e.g., `TKT-001`. Padding is 3 digits initially, grows naturally (`TKT-1000`). For the artisan repo, you'd set `prefix: ART` to get `ART-001`.
- `{slug}` — lowercase, alphanumeric + hyphens only. Max 50 characters. Derived from title at creation time. Truncated at word boundaries.
- Example: `TKT-042-add-ticket-search.md`

### 8.2 Counter File

`.tickets/.counter` contains a single integer (the next ID number to assign), newline-terminated.

```
43
```

### 8.3 Frontmatter Rules

- YAML between `---` fences at the top of the file.
- `id` and `title` must be present and non-empty.
- `status` must be one of: `backlog`, `open`, `in-progress`, `done`, `cancelled`. Defaults to `open` on creation.
- `priority`, when present, must be one of: `low`, `medium`, `high`, `urgent`.
- `order`, when present, is a float. Used for manual sort ordering within a status group. Set automatically by drag-and-drop operations. Can be omitted — tickets without `order` sort after ordered tickets.
- `tags` is an array of lowercase strings. Normalized on write (trimmed, lowercased, deduplicated).
- `project`, `epic`, `sprint` are plain strings. No validation beyond non-empty when present.
- `created` is set once at creation time. ISO 8601 with timezone.
- `updated` is refreshed on every write. ISO 8601 with timezone.
- Optional fields are omitted entirely from the file when not set. The parser treats missing fields as undefined.

### 8.4 Body Conventions

The body is freeform markdown. The core library does not enforce structure, but the UI and MCP tools recognize:

- `## Tasks` section — contains checkbox items (`- [ ]` / `- [x]`). The `complete_subtask` and `add_subtask` tools target this section.
- If no `## Tasks` heading exists, `add_subtask` creates it.
- Subtask indices are 0-based from the first checkbox found in the body (regardless of heading).

### 8.5 Example Complete File

```markdown
---
id: TKT-007
title: Implement SSE live reload for ticket changes
status: in-progress
priority: high
order: 1
tags: [server, real-time]
project: ticketbook
epic: core-infrastructure
sprint: week-14
created: 2026-04-01T10:30:00-07:00
updated: 2026-04-03T14:15:00-07:00
---

## Context

When a ticket file is modified outside the UI (by an agent, a text editor, or
a git pull), the UI should update without a manual refresh. This is critical
for the agent workflow — you kick off an agent on a ticket and watch it check
off subtasks in real time.

See: [MDN EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)

## Tasks

- [x] Add fs.watch on .tickets/ directory
- [x] Create SSE endpoint at /api/events
- [ ] Debounce rapid file changes (100ms window)
- [ ] Push ticket ID + change type in SSE event data
- [ ] UI: EventSource hook with auto-reconnect
- [ ] UI: Invalidate and refetch affected ticket on event

## Notes

Bun's fs.watch is reliable on macOS and Linux. On macOS it uses FSEvents
under the hood, which batches changes — we still want our own debounce to
avoid hammering the reader on bulk operations (e.g., git checkout that
touches many ticket files at once).
```

---

## 9. Resolved Design Decisions

1. **Ticket prefix customization** — Yes. Configurable via `.tickets/.config.yaml`. Default is `TKT`. Set `prefix: ART` for the artisan repo, etc.

2. **Archive vs. delete** — Both, user's choice. `deleteMode` in `.config.yaml` defaults to `archive` (moves files to `.tickets/.archive/`). Can be set to `hard` for permanent deletion. Archived tickets can be restored via the API. The archive directory is gitignored by default (added to `.gitignore` during `ticketbook init`), but users can remove that line if they want archive history in git.

3. **Manual ordering** — Yes. An `order` float field in frontmatter supports drag-and-drop reordering in both the list view and kanban board. Midpoint insertion with automatic rebalancing when gaps get too small.

4. **CLI scope** — Launcher only. MCP tools handle agent interaction, UI handles human interaction. No `ticketbook add` or `ticketbook list` commands — those would be a third interface to maintain for minimal benefit.

5. **Kanban board** — Included as a first-class view mode (Phase 3), not a future nice-to-have. Powered by `@dnd-kit` with drag-and-drop between columns for status changes and within columns for reordering.

---

## 10. Non-Goals (Explicitly Out of Scope)

- **Multi-user / collaboration.** This is a solo dev tool. No assignees, no permissions, no conflict resolution beyond git merge.
- **Notifications / reminders.** No due dates, no alerts. If you want a reminder, use a separate tool.
- **Time tracking.** No estimates, no time logged, no velocity.
- **Kanban-only mode.** The kanban board is a view mode alongside the list, not a standalone app. No separate kanban URL or configuration.
- **GitHub/Linear sync.** No bidirectional sync with external tools. Tickets live in git, period.
- **Rich media in tickets.** No image uploads, no file attachments. Links to external resources are fine.
