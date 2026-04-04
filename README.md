# Ticketbook

A local-first ticket tracker that stores tickets as markdown files in a `.tickets/` directory.

## Quick Start

```bash
# Initialize a new ticketbook in the current directory
bunx ticketbook init

# Start the web UI
bunx ticketbook

# Start with a specific directory
bunx ticketbook --dir /path/to/project
```

## CLI Options

```
ticketbook [command] [options] [path]

Commands:
  init        Scaffold a new .tickets/ directory
  (default)   Start the server and open the UI

Options:
  --dir <path>   Path to .tickets/ directory (or directory containing it)
  --port <num>   Server port (default: auto-assigned)
  --no-ui        Server only, no static UI serving
  --mcp          Start MCP server mode (stdio transport, no HTTP)
  -h, --help     Show this help message
```

## Claude Code MCP Integration

Ticketbook exposes an MCP server so Claude Code can read and manage your tickets directly.

Add this to your Claude Code MCP config (`.claude/settings.json` or project-level `.mcp.json`):

```json
{
  "mcpServers": {
    "ticketbook": {
      "command": "bunx",
      "args": ["ticketbook", "--mcp"],
      "cwd": "/path/to/your/repo"
    }
  }
}
```

Replace `/path/to/your/repo` with the absolute path to the directory containing your `.tickets/` folder.

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `list_tickets` | List tickets with optional filters (status, priority, project, epic, sprint, tags) |
| `get_ticket` | Get full ticket details including body content |
| `create_ticket` | Create a new ticket |
| `update_ticket` | Update ticket fields |
| `delete_ticket` | Delete (archive) a ticket |
| `complete_subtask` | Mark a subtask as done (by index or text match) |
| `add_subtask` | Add a new subtask to a ticket |
| `reorder_ticket` | Reorder a ticket within its status group |

### Available MCP Resources

| Resource | URI | Description |
|----------|-----|-------------|
| Ticket List | `tickets://list` | Full ticket list in compact format |

### Available MCP Prompts

| Prompt | Arguments | Description |
|--------|-----------|-------------|
| `ticket-context` | `id` (ticket ID) | Returns formatted context for a ticket including details, subtasks, and related tickets |
