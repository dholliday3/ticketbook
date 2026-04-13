---
id: TKTB-048
title: Saved prompts with smart suggestions
status: backlog
tags:
  - agent-experience
  - agent-editor
created: '2026-04-05T07:30:00.000Z'
updated: '2026-04-12T03:56:40.367Z'
---

## Overview

Saved prompts that developers can easily reference in chat sessions. Cursor already has this, but we can go further with intelligent prompt curation.

## Core Feature

- Save frequently used prompts with a name and optional description
- Reference them in chat via autocomplete (e.g., type `/` or `@` to search saved prompts)
- Prompts can be global (user-level) or project-specific
- Support template variables (e.g., `{{ticket_id}}`, `{{file_path}}`) that get filled in on use
- Stored in SQLite or as files in `.prompts/` — same pattern as tickets/plans

## Smart Prompt Suggestions

A background agent (same approach as auto-memories) that evaluates the developer's prompts across sessions:

- **Detect repeated patterns**: "You've written a similar prompt about test coverage in 5 sessions — save it?"
- **Suggest refinements**: "This prompt worked well last time but you tweaked it — want to update the saved version?"
- **Autocomplete in context**: as the developer types, suggest relevant saved prompts based on what they're doing (current file, ticket context, recent commands)
- **Prompt effectiveness**: track which saved prompts lead to good outcomes vs. which get abandoned or heavily modified after use

## Examples

Saved prompts might look like:
- "Review this PR for security issues, focusing on input validation and auth"
- "Write tests for {{file_path}} covering edge cases and error paths"
- "Implement {{ticket_id}} following the existing patterns in this codebase"
- "Refactor this to use the shared MetaFields components"

## Connection to Harness (TKTB-047)

Saved prompts are essentially lightweight skills. The line between a saved prompt and a skill is fuzzy — a skill is a prompt with more structure and tooling. The eval agent from TKTB-047 could also evaluate saved prompts: which are used often, which are stale, which could be promoted to full skills.

## Open Questions

- Storage: SQLite table? Files in `.prompts/`? Part of the skills system?
- How does autocomplete work across different agent interfaces (terminal, UI chat, MCP)?
- Should prompts be version-controlled (git) or treated as ephemeral user preferences?
- How aggressive should the suggestion agent be? Passive notifications vs. inline suggestions?
