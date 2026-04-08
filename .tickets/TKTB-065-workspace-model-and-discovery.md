---
id: TKTB-065
title: Workspace model and discovery
status: open
tags:
  - workspace
  - data-model
  - agent-experience
  - v1-foundations
created: '2026-04-08T05:17:54.830Z'
updated: '2026-04-08T05:17:54.830Z'
---

## Context

A workspace is the organizational primitive — the thing sessions, tickets, and plans are scoped to. It represents a git context that the developer is working in.

This ticket defines the workspace data model, lazy discovery from terminal sessions, and the API surface.

## Data model

```sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,                -- generated, e.g. uuid or hash of repo_root+worktree
  repo_root TEXT NOT NULL,            -- /Users/dan/workspace/ticketbook
  worktree_path TEXT,                 -- null for main checkout, path for worktrees
  branch TEXT,                        -- current branch (updated as sessions report changes)
  display_name TEXT,                  -- derived: repo name or "repo/branch" for worktrees
  parent_workspace_id TEXT,           -- FK to self: worktrees point to their repo's workspace
  discovered_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,       -- updated when any session in this workspace has activity
  UNIQUE(repo_root, worktree_path)
);

CREATE INDEX idx_workspaces_repo ON workspaces(repo_root);
CREATE INDEX idx_workspaces_parent ON workspaces(parent_workspace_id);
```

**Key relationships:**
- A repo root creates one "parent" workspace (worktree_path is null)
- Each worktree creates a "child" workspace with parent_workspace_id pointing to the repo workspace
- `terminal_sessions.workspace_id` FK ties sessions to workspaces
- Tickets and plans can optionally have a `workspace_id` (maps to the existing `project` field conceptually)

## Lazy discovery

Workspaces are **not** configured or scanned. They are created on-demand:

1. Terminal session starts → worktree/branch detection runs (previous ticket)
2. If no workspace exists for that `(repo_root, worktree_path)`, create one
3. If the repo root workspace doesn't exist, create it first (as the parent)
4. Link the session to the workspace

This means the workspace table starts empty and fills up organically as the user works.

## API endpoints

```
GET  /api/workspaces                    -- list all known workspaces (with session counts, last activity)
GET  /api/workspaces/:id                -- workspace detail
GET  /api/workspaces/:id/sessions       -- sessions in this workspace
GET  /api/workspaces/:id/tickets        -- tickets scoped to this workspace
DELETE /api/workspaces/:id              -- remove a stale workspace (doesn't delete sessions/tickets, just unlinks)
```

## Display name derivation

- Main checkout: repo directory name (e.g., `ticketbook`)
- Worktree: `ticketbook / feature-auth` (repo name + branch)
- Multiple repos: just the repo name, disambiguated if needed

## Open questions resolved

- **Discovery:** lazy from terminal sessions (decided)
- **Multi-repo:** repo is parent workspace, worktrees are children (decided)
- **Workspace lifetime:** workspaces persist in SQLite, can be manually removed if stale. No auto-cleanup for now.

## Dependencies

- Worktree/branch detection ticket (for the git context data)
- TKTB-055 (for `terminal_sessions` table to add workspace_id FK)
