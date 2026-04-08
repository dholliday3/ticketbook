---
id: TKTB-059
title: Native Mac terminal exploration (watch-only)
status: backlog
tags:
  - terminal
  - native
  - watch
  - deferred-desktop
created: '2026-04-06T07:30:50.069Z'
updated: '2026-04-08T05:19:39.598Z'
---

## Context

A watch-only ticket tracking the longer-term possibility of moving the terminal emulator off of xterm.js and onto a native Mac implementation (likely via libghostty, with cmux as a reference). **Not to be picked up until a concrete trigger fires.**

The strategic direction is explicit: stay with xterm.js as the primary primitive now because the terminal is the agent-integration layer, and UI iteration speed matters more than native fidelity during the phase where the product ideas are still churning. But we want to know when that calculus changes.

## Re-evaluation triggers

Revisit this decision when ANY of these are true:

1. **libghostty's embedding API stabilizes** and cmux (or a similar reference) shows a clear pattern for embedding it in a host application. Today: unstable API, unclear embedding story.

2. **xterm.js performance or fidelity becomes a measured blocker**, not a feeling. Concrete examples: input latency > 100ms p95 on a fast Mac, dropped output frames during `seq 1 100000`, visible rendering artifacts that persist after addon tuning. Must be measured, not vibes.

3. **The UI has stabilized** enough that SwiftUI's slower iteration speed is an acceptable cost. The current UI is still churning weekly — that's the wrong phase for a native pivot.

## What to monitor

- libghostty repo releases, embedding API changes
- cmux patterns and issues
- VSCode or Zed native terminal explorations (they're in a similar bind)
- Own performance measurements from TKTB-058 (terminal basics audit) — if they show a measured blocker, update this ticket with the data

## Not to do until a trigger fires

- Writing any native code
- Reading libghostty source beyond API surface understanding
- Spiking a SwiftUI terminal host
- Porting the TerminalSession abstraction to Swift

This ticket exists to prevent the decision from being forgotten, not to invite premature work.
