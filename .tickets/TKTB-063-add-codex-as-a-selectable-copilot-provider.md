---
id: TKTB-063
title: Add Codex as a selectable copilot provider
status: backlog
tags:
  - copilot
  - codex
  - claude
  - providers
created: '2026-04-08T00:00:00.000Z'
updated: '2026-04-08T00:00:00.000Z'
---

Add Codex as a first-class app copilot provider alongside Claude Code, with a provider selector in the UI and provider-neutral persistence/history.

## Scope

The current copilot architecture is only partially provider-agnostic. Message rendering is normalized, but session management, conversation persistence, history loading, and API semantics are still Claude-specific.

Implement the complete version of multi-provider copilot support:

- Add a provider registry and provider-aware manager so the app can run both Claude Code and Codex.
- Add a Codex provider adapter using the local Codex CLI resume and JSON event streaming surface.
- Make the copilot API provider-aware for health, session start, conversation listing, resume, and message history.
- Add provider selection to the copilot panel so the user can switch between Claude Code and Codex when starting or resuming conversations.
- Make conversation persistence provider-neutral. Store provider ownership in SQLite and persist normalized transcript history in app storage instead of relying on Claude's local JSONL store.
- Keep the existing normalized message part model in the UI so rendering stays shared across providers.
- Preserve resume semantics per provider and make the conversation list/history work correctly for both.
- Add tests for provider adapters, persistence, API behavior, and provider switching flows.

## Acceptance

- [ ] Copilot supports both Claude Code and Codex as selectable providers
- [ ] Provider selection is visible in the copilot UI before sending a message
- [ ] New and resumed conversations are scoped to the selected provider
- [ ] Conversation metadata persists with provider ownership in SQLite
- [ ] Prior messages render from app-managed normalized transcript history for both providers
- [ ] Claude Code behavior continues to work after the refactor
- [ ] Codex turns stream into the existing copilot UI with text, reasoning, tool use, and tool results when available
- [ ] Automated tests cover the provider-neutral manager and at least one provider selection and resume flow
