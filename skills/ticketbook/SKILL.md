---
name: ticketbook
description: Use whenever the user mentions tickets, plans, TKT-*/TKTB-*/PLAN-* IDs, the .tickets/ or .plans/ directories, creating/updating/reviewing tickets or plans, picking up work, handing off tickets to an agent, reviewing what an agent did, breaking plans into actionable tickets, linking commits/PRs to tickets, or asking "what should I work on next". Covers the full ticketbook workflow via the ticketbook MCP server.
---

# Ticketbook

Ticketbook is a local-first ticket and plan tracker. Tickets live in `.tickets/` and plans live in `.plans/` as markdown files with YAML frontmatter. The `ticketbook` MCP server exposes tools for reading and writing them — **always prefer the MCP tools over editing the markdown files directly**. Direct edits skip ID assignment, file naming, ordering, and watcher sync.

## Primitives

**Plans** (`PLAN-*`) are strategic documents — PRDs, feature specs, brainstorms. They are higher-level than tickets and can link to the tickets that implement them. Statuses: `draft`, `active`, `completed`, `archived`.

**Tickets** (`TKT-*`, or a project prefix like `TKTB-*`) are the unit of work. Statuses: `draft`, `backlog`, `open`, `in-progress`, `done`, `cancelled`. Priorities: `low`, `medium`, `high`, `urgent`. Tickets can have subtasks (markdown checkboxes in the body), be blocked by other tickets, relate to other tickets, and link to commits/PRs via `refs`.

The typical flow is: brainstorm in a plan → cut tickets from the plan → pick up a ticket → hand off to an agent → review what changed → mark done and link the commit.

## When the user asks what to work on

Call `list_tickets` with `status: "open"` (optionally add `priority: "high"` or a `project`/`epic`/`sprint` filter). Results come back sorted by priority and order — the top item is the recommendation. Don't open every ticket; the summary line is enough to propose what to pick up. If there are no open tickets, check `status: "backlog"` before telling the user there's nothing to do.

## When the user wants to start work on a ticket

1. Call `get_ticket` to load the full body, subtasks, refs, and any prior agent notes.
2. Call `update_ticket` to set `status: "in-progress"` and `assignee: "<your agent name>"` (e.g. `"claude-code"`, `"codex"`). This is how humans and other agents see who is working on what.
3. Read the body carefully before doing anything. Subtasks are markdown checkboxes (`- [ ]`), and any section after a `<!-- agent-notes -->` marker contains debriefs from prior agents — read these so you don't repeat their mistakes or redo their work.

## When the user wants to create a ticket

Call `create_ticket` with at minimum a `title`. Defaults: `status: "open"`, no priority. Only set a `priority` if the user specified one or the context clearly calls for it. If a `project`, `epic`, `sprint`, `blockedBy`, or `relatedTo` is obvious from context, include it — but don't interrogate the user for metadata they didn't ask to set. **Never invent projects, epics, or sprints that don't already exist** — call `list_tickets` first to see what's in use if you need to check.

## When the user wants to break a plan into tickets

If the plan has a checklist of unchecked items in its body, call `cut_tickets_from_plan` with the plan ID. One tool call parses every unchecked checkbox, creates a ticket for each, links them back to the plan, and checks off the items. Preview the plan with `get_plan` first if you're unsure what will be cut, especially for plans with many items.

If the plan has prose instead of a checklist, ask whether to (a) add checklist items to the plan first (so the user can review and edit before cutting), or (b) create tickets directly with `create_ticket` and then link them via `link_ticket_to_plan`. Default to (a) unless the user wants to move fast.

## When finishing work on a ticket

1. Check off completed subtasks: `complete_subtask` with either `index` (0-based) or `text` (substring match).
2. Add a debrief to the ticket body under a `<!-- agent-notes -->` marker. Use `update_ticket` with a new `body` that **preserves the original content** and appends `<!-- agent-notes -->` plus your notes (or appends underneath the existing marker if one is already there). Notes should cover: what changed, what you deliberately didn't do, what the user should verify, and any follow-up tickets that should be filed.
3. Set `status: "done"` via `update_ticket`.
4. If you created a commit or PR, call `link_ref` with the commit SHA or PR URL. Convention: include the ticket ID in the commit message itself (e.g. `"TKTB-015: fix kanban reorder bug"`) so the link is discoverable from git history too.

## When the user wants to review what an agent did on a ticket

Call `get_ticket`. The `<!-- agent-notes -->` section, linked `refs`, and current `status` are the sources of truth. If refs point to commits or PR URLs, offer to read them for the user. Summarize: what was the goal, what actually landed, what's still open, and what follow-up tickets were filed (if any).

## When the user wants to create a plan

Call `create_plan`. Plans default to `status: "draft"`. Put the brainstorm or spec content in `body`. If the user wants to kick off work immediately, finish writing the body first, then use `cut_tickets_from_plan` to break it into tickets — don't interleave plan writing with ticket creation.

## Reference: MCP tools

**Tickets**
| Tool | Purpose |
|---|---|
| `list_tickets` | List with filters (status, priority, project, epic, sprint, tags). Sorted. |
| `get_ticket` | Full ticket including body, subtasks, refs, agent notes |
| `create_ticket` | New ticket; `title` required |
| `update_ticket` | Change any field; only provided fields update |
| `delete_ticket` | Archive a ticket |
| `link_ref` | Attach a commit SHA or PR URL to a ticket |
| `complete_subtask` | Check off a subtask by `index` or `text` match |
| `add_subtask` | Append a new checkbox to a ticket body |
| `reorder_ticket` | Move a ticket within its status column |

**Plans**
| Tool | Purpose |
|---|---|
| `list_plans` | List with filters (status, project, tags) |
| `get_plan` | Full plan including body and linked ticket IDs |
| `create_plan` | New plan; `title` required |
| `update_plan` | Change any field |
| `delete_plan` | Archive a plan |
| `link_ticket_to_plan` | Attach an existing ticket to a plan |
| `cut_tickets_from_plan` | Parse unchecked checkboxes into tickets and link them |

## Rules of thumb

- **Never edit `.tickets/*.md` or `.plans/*.md` directly.** Use the MCP tools.
- **Never invent ticket or plan IDs.** IDs are assigned by `create_ticket` / `create_plan`.
- **Preserve prior agent notes when updating a body.** Append to the existing `<!-- agent-notes -->` section; don't overwrite it.
- **Prefer `list_tickets` filters over loading everything.** The server already sorts and filters.
- **Confirm before bulk operations.** For `cut_tickets_from_plan` on a plan with many items, show the user what will be created first unless they've told you to just go.
- **Status changes are how work is coordinated.** Always flip to `in-progress` when starting and `done` when finishing — don't leave tickets in the wrong state because it looks cosmetic.
