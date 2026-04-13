---
id: TKTB-067
title: Session MCP tools
status: backlog
tags:
  - mcp
  - agent-experience
  - v1-foundations
  - agent-editor
relatedTo:
  - TKTB-055
created: '2026-04-08T05:18:27.871Z'
updated: '2026-04-12T03:56:56.211Z'
---

## Context

Make sessions a first-class primitive in the MCP API so that agents (the copilot, Claude Code via MCP, any coding agent) can interact with session data. This is what closes the loop: agents can link their work to tickets, query what happened in other sessions, and update session metadata.

## MCP tools to add

### `list_sessions`
List terminal sessions with optional filters.
- Filters: `workspaceId`, `ticketId`, `status` (active/idle/ended), `branch`
- Returns: session ID, workspace, branch, status, linked ticket, started_at, last_active_at

### `get_session`
Get full details of a session including its event stream.
- Params: `sessionId`
- Returns: session metadata + paginated events (command starts/ends, cwd changes)

### `link_session_to_ticket`
Associate a terminal session with a ticket.
- Params: `sessionId`, `ticketId`
- Idempotent — re-linking to the same ticket is a no-op

### `unlink_session_from_ticket`
Remove the ticket association from a session.
- Params: `sessionId`

### `list_workspaces`
List discovered workspaces with session counts and activity.
- Returns: workspace ID, repo root, branch, display name, active session count, last activity

### `get_session_diff`
Get the git diff for a session — what changed between session start and now.
- Params: `sessionId`
- Returns: diff output (or structured file change list)
- Uses the session's repo_root and the commits/working tree state

## Agent instruction updates

Update the MCP tool descriptions for existing ticket tools to reference sessions:
- When an agent picks up a ticket (`update_ticket` to in-progress), mention they can `link_session_to_ticket`
- When an agent completes a ticket (moves to feedback/done), mention they can include session context

## Dependencies

- TKTB-055 (session persistence in SQLite)
- Workspace model ticket (for `list_workspaces`)

## Non-goals

- Creating or destroying terminal sessions via MCP — sessions are created through the terminal UI
- Sending input to a session via MCP — the agent is already IN the session
