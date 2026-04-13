---
id: TKTB-064
title: Worktree/branch detection for terminal sessions
status: backlog
tags:
  - terminal
  - workspace
  - agent-experience
  - v1-foundations
  - agent-editor
blockedBy:
  - TKTB-054
relatedTo:
  - TKTB-054
  - TKTB-055
created: '2026-04-08T05:17:35.220Z'
updated: '2026-04-12T03:56:53.874Z'
---

## Context

When a terminal session starts, we need to automatically detect the git context it's running in: repo root, worktree path (if any), and current branch. This is the automatic association that makes workspace grouping work without any user config.

This is the bridge between raw terminal sessions and the workspace model. Without it, sessions are just unorganized PTYs.

## Approach

At session creation time (when the PTY spawns), resolve the initial cwd:

```bash
# Get repo root (works in both regular repos and worktrees)
git -C <cwd> rev-parse --show-toplevel

# Detect if we're in a worktree
git -C <cwd> rev-parse --git-common-dir   # returns the main .git dir
git -C <cwd> rev-parse --git-dir          # returns the worktree's .git link

# Get current branch
git -C <cwd> rev-parse --abbrev-ref HEAD
```

If `--git-common-dir` != `--git-dir`, we're in a worktree. The common dir gives us the parent repo.

### On cwd change

When the session emits a `cwdChanged` event (from OSC 7/633, see TKTB-054), re-resolve the git context. If the user cd's into a different repo or worktree, the session's workspace binding updates.

### Data shape

Add to the `terminal_sessions` table (from TKTB-055):

```sql
ALTER TABLE terminal_sessions ADD COLUMN repo_root TEXT;      -- /Users/dan/workspace/ticketbook
ALTER TABLE terminal_sessions ADD COLUMN worktree_path TEXT;  -- /Users/dan/workspace/worktrees/ticketbook/feature-x (null if not a worktree)
ALTER TABLE terminal_sessions ADD COLUMN branch TEXT;          -- feature-x
ALTER TABLE terminal_sessions ADD COLUMN is_worktree BOOLEAN DEFAULT FALSE;
```

### Server-side implementation

In the `TerminalSession` class:
1. On spawn, run the git commands above (use `simple-git` or `Bun.spawn`)
2. Store the results on the session object and in SQLite
3. Subscribe to `cwdChanged` events and re-resolve on change
4. Emit a `workspaceChanged` event when the git context changes

### Edge cases

- **Not a git repo:** session has no workspace — that's fine, it's ungrouped
- **Bare repo:** unlikely for our use case, but handle gracefully
- **Detached HEAD:** branch is null, show commit hash instead
- **Submodules:** resolve to the submodule's own repo root, not the parent
- **Graphite stacks:** branch name is enough for the UI to show stack relationships (gt branch info can give parent chain, but that's a follow-up)

## Dependencies

- TKTB-054 for `cwdChanged` events (but initial detection works without it — just won't update on cd)

## Non-goals

- Graphite stack awareness — just detect the branch, stack UI is a follow-up
- Worktree creation/management — we observe, we don't create worktrees
