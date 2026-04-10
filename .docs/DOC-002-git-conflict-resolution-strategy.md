---
id: DOC-002
title: Git conflict resolution strategy
tags:
  - git
  - conflicts
  - merging
  - worktrees
project: ticketbook
created: '2026-04-10T08:20:37.948Z'
updated: '2026-04-10T08:20:37.948Z'
---

# Git conflict resolution strategy

Ticketbook is a local-first artifact tracker where tasks, plans, and docs live as markdown files with YAML frontmatter. When multiple branches or worktrees modify these files concurrently, git merges can produce conflicts. This doc describes what we handle automatically, what we leave to agents, and why.

## What we handle automatically: counter files

The only conflict that is genuinely hard to resolve manually is a **counter collision** — two branches both incrementing the same counter from the same base value, producing duplicate IDs.

This is prevented by a `.gitattributes` rule:

```
.tasks/.counter merge=ours
.plans/.counter merge=ours
.docs/.counter merge=ours
```

`merge=ours` tells git to always keep the current branch's counter value on merge, discarding the incoming branch's value. This avoids a conflict marker, but leaves the counter potentially stale (lower than the highest ID actually on disk).

The `doctor` command handles reconciliation: it scans all artifact files, finds the highest ID in use, and updates the counter if it's behind. Running `ticketbook doctor --fix` (or the MCP `doctor` tool with `fix: true`) after merging a branch corrects the counter automatically.

## What we leave to agents: task/plan/doc file conflicts

Conflicts in `.tasks/*.md`, `.plans/*.md`, and `.docs/*.md` files are standard git text conflicts — git leaves conflict markers in the file and the merge stops. We deliberately do **not** install a custom git merge driver for these files.

**Why not a merge driver?**

A custom merge driver that understands YAML frontmatter can auto-resolve many non-overlapping field changes (e.g. one branch changed `status`, the other changed `tags`). But it adds real complexity:

- Requires `ticketbook init` to register the driver in local git config — it doesn't activate just from `.gitattributes`
- Won't work if ticketbook is installed as a binary (the script file won't be present)
- Adds a post-merge hook that runs on every merge, even when there are no artifact conflicts
- 400+ lines of merge logic that needs to be tested and maintained

**Why agents are sufficient:**

Artifact file conflicts are structured and easy to reason about. The files have clear semantics — frontmatter fields have known meanings, the body is free-form markdown. An agent can read both sides of a conflict, understand what each change was trying to do, and resolve it correctly in seconds. This is exactly the kind of structured, low-ambiguity task agents are good at.

## Typical post-merge workflow

1. Merge (or pull) as normal.
2. If git reports conflicts in `.tasks/`, `.plans/`, or `.docs/` files, ask your agent to resolve them. The conflict markers make the two sides explicit.
3. After the merge is clean, run `ticketbook doctor --fix` (or call the MCP `doctor` tool) to reconcile counters if any were touched by both branches.

## Worktree awareness

When running ticketbook from a git worktree, the CLI and MCP server resolve `.tasks/`, `.plans/`, and `.docs/` relative to the **main worktree**, not the linked worktree's directory. This means all worktrees share a single set of artifacts, which is intentional — tasks and plans belong to the project, not to a particular branch.

If you create a task in one worktree and switch to another, the task is immediately visible. The same applies to agent sessions running in parallel worktrees: they read and write the same artifact store. Coordinate via task `status` and `assignee` fields to avoid stepping on each other.

