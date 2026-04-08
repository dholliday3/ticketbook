---
id: TKTB-056
title: Git diff and file review UI scoped by terminal session
status: open
tags:
  - terminal
  - ui
  - review
  - v1-foundations
blockedBy:
  - TKTB-055
relatedTo:
  - TKTB-046
  - TKTB-054
created: '2026-04-06T07:29:45.406Z'
updated: '2026-04-08T05:18:45.483Z'
---

## Context

Agent-agnostic diff viewer that shows what changed in a terminal session without relying on any agent's output formatting. Reads from git and the `SessionRecord` event stream, not from Claude/Codex/Aider transcripts.

This is the core of 'validating what the agent did' — a real review surface that works with any coding agent because it reads the filesystem, not the agent's output.

## Scope

### 1. Diff data source

- For each linked `SessionRecord`, compute the file changes between the session's start commit and its current HEAD (or latest command's cwd state).
- Use `git diff` via `simple-git` or raw git invocations — whichever is already in use.
- Per-command granularity: if OSC 133 command boundaries are captured, attribute changes to the specific command that caused them (by diffing between the exit timestamps of adjacent commands).

### 2. UI

New side panel or embedded in the ticket detail view:
- File tree of changed files
- Inline diff viewer (use a library — look at react-diff-viewer-continued or similar)
- Filter by: file type, command that caused the change, accept/reject state
- Per-file approve/reject checkmarks that don't modify the files — just a UI state for review

### 3. Integration with sessions

Accessed from two places:
- Ticket detail view → 'Review changes' button → diff UI scoped to the linked sessions
- Terminal pane → a 'Diff' tab or button that shows what's changed since the session started

## Dependencies

- SessionRecord model (TKTB-055)
- OSC 133 ideally (for per-command attribution), but not strictly required — can work with session-level diffs

## Non-goals

- Editing files from the diff UI — read-only review
- Git staging / commit from the UI — that happens in the terminal or a separate git UI
- Three-way merge or conflict resolution

## Open questions

- How do we handle sessions that span multiple repos or cwds? Probably scope by cwd at session start.
- What's the review 'state' — is it persisted, or just session-scoped in the UI?
