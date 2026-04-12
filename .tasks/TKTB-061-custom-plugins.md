---
id: TKTB-061
title: Custom plugins
status: backlog
tags:
  - plugins
  - extensibility
  - architecture
  - ideas
  - deferred-desktop
  - agent-editor
created: '2026-04-07T00:00:00.000Z'
updated: '2026-04-12T03:56:52.382Z'
---

## Context

Builders should be able to create custom UI/plugins with agents that have their own custom UI, rendered natively inside ticketbook. The UI lives in a local registry and carries its own metadata (prompt, structured output schema, etc.) so that any plugin can be defined, discovered, and rendered without forking the app.

The bigger architectural bet: build our own first-class features on top of this same plugin framework. If our internal surfaces (tickets, plans, terminal panes, etc.) consume the same plugin contract that third-party plugins use, then:

- The plugin API is dogfooded continuously and stays honest.
- Custom plugins get a real, capable shared interface for interacting with the backend — not a bolted-on second-class extension surface.
- New features can be prototyped as plugins first and graduated into core only when they earn it.

## What this unlocks

- Users describe a plugin in natural language → an agent generates the UI + prompt + structured output schema → it lands in the local registry and is immediately usable.
- A shared plugin contract that exposes ticketbook primitives (tickets, plans, sessions, terminal, file context) so plugins are powerful without escape hatches.
- Composability: plugins can render into known slots (sidebar, ticket detail, command menu, kanban card, etc.) instead of being isolated iframes.

## Open questions

- What's the registry storage shape? Local filesystem under `.tickets/.plugins/` or similar, with each plugin as a directory of metadata + UI bundle?
- What's the rendering sandbox model? Trusted (in-process React) vs. sandboxed (iframe / web component)? Trust matters when agent-generated UI talks to our backend.
- What's the structured output contract? JSON Schema? Zod? Something agent-friendly that doubles as the prompt scaffolding?
- Which of our existing built-in features are the best candidates to migrate onto the plugin framework first, as the forcing function for the API design?
- How do plugins declare which slots they render into, and how do they declare which ticketbook capabilities they need (tickets read/write, terminal, files, etc.)?

## Not in scope (yet)

- A public marketplace or remote registry — local-first first.
- Cross-user plugin sharing — figure out the single-user shape before worrying about distribution.
- Sandboxing hardening for untrusted third-party plugins — start with trusted, agent-authored plugins for the plugin author themselves.
