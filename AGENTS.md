# AGENTS.md

This project uses **ticketbook** for ticket and plan tracking. Tickets live in `.tickets/` and plans live in `.plans/` as markdown files with YAML frontmatter.

## If your agent supports Skills

The `ticketbook` skill at `skills/ticketbook/SKILL.md` covers the full workflow. Claude Code discovers it via the `.claude-plugin/` manifest; Codex discovers it via `.agents/skills/ticketbook/`. Nothing to configure — just ask about tickets or plans and the skill will load.

## If your agent does not support Skills

Use the `ticketbook` MCP server for all ticket and plan operations. Start it with:

```
bunx ticketbook --mcp
```

Never hand-edit files in `.tickets/` or `.plans/` — the MCP server owns ID assignment, file naming, ordering, and watcher sync. Direct edits will desync state.

### Core workflow

- **Start work:** set ticket `status: "in-progress"` and `assignee: "<your agent name>"`.
- **Finish work:** set `status: "done"`, append a debrief under a `<!-- agent-notes -->` marker in the body, and call `link_ref` with the commit SHA or PR URL.
- **Plans → tickets:** call `cut_tickets_from_plan` to parse unchecked checkboxes in a plan body into linked tickets in one step.
- **Commit convention:** include the ticket ID in the commit message (e.g. `TKTB-015: fix kanban reorder bug`).

### Enums

- **Ticket status:** `draft`, `backlog`, `open`, `in-progress`, `done`, `cancelled`
- **Ticket priority:** `low`, `medium`, `high`, `urgent`
- **Plan status:** `draft`, `active`, `completed`, `archived`

See the full MCP tool list in the ticketbook README or by connecting to the MCP server.
