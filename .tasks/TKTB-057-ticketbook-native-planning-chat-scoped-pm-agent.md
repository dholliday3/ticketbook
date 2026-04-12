---
id: TKTB-057
title: TicketBook-native planning chat (scoped PM agent)
status: backlog
tags:
  - agent-experience
  - chat
  - planning
  - deferred-desktop
  - agent-editor
created: '2026-04-06T07:30:04.583Z'
updated: '2026-04-12T03:56:48.941Z'
---

## Context

A small chat panel for TicketBook's own planning/PM agent — NOT a host for coding agents. Coding agents (Claude Code, Codex, Aider, etc.) live in the terminal, unchanged. This chat is specifically for planning, brainstorming, and ticket management conversations where we own both ends of the integration.

This is the ONE place we do a deep agent integration. Everywhere else is terminal-based.

## Scope

### Agent capabilities

First-class tool access to:
- Ticket CRUD (via existing MCP tools or direct API)
- Plan CRUD
- `SessionRecord` reads — 'what have I worked on this week?'
- File system reads (scoped to the project dir)
- Git log / diff reads

No shell execution — that's what the terminal is for. No file writes outside of ticket/plan content.

### UI

- Dedicated chat panel (new layout region, or toggled via a button in the chrome)
- Markdown rendering (reuse TipTap or a lighter library)
- Slash commands for common actions: `/new-ticket`, `/review-session`, `/plan`
- Thread persistence in SQLite — conversations are first-class objects
- Reference system: `@ticket TKTB-123`, `@plan PLAN-001`, `@session <id>` auto-link and the agent can see the linked object

### Agent runtime

Use Claude directly via the Anthropic SDK (or whatever agent SDK we settle on). This is NOT pluggable — it's an opinionated integration with a single model.

## Dependencies

- SessionRecord model (TKTB-055) — needed for 'review my session' workflows
- Existing MCP tools for ticket/plan CRUD (already in place)

## Non-goals

- Hosting coding agents (they stay in terminals)
- Supporting multiple model providers pluggably — one provider, done right
- Offline support
- Voice

## Explicit constraint from strategic direction

This is the ONLY place we do deep agent integration in the app. If we find ourselves wanting to embed other agents, that's a signal we're drifting — pull back to the terminal.
