---
id: TKTB-042
title: Terminal shell in the web
status: done
order: 500
tags:
  - ideas
created: '2026-04-04T07:49:54.841Z'
updated: '2026-04-09T03:02:14.156Z'
---

Is it possible to render a terminal emulator in the web? If so, let's add a terminal that can open from the right side, NOT as a sheet uses a modal, but something more similar to the sidebar component, that shifts over the other content and is inline in the page. For now we'll have one side inline panel where we can open a terminal emulator so we can kick off a coding agent.

## Status — 2026-04-06

Initial implementation landed and then went through a major refactor. Current state:

- **Handshake-based WebSocket protocol** (client sends its real dimensions first, server only spawns PTY after)
- **Server-authoritative tab state** in SQLite
- **Close-last-tab-closes-pane** behavior (persists session for reattach)
- **Only-active-tab mounted** xterm (no hidden-tab dimension bugs)
- **Server-side headless xterm mirror + SerializeAddon** for output persistence across tab switches and page refreshes
- **`TerminalSession` abstraction** as the seam for future native backends (libghostty/cmux path)
- **Debug logging** via `DEBUG=terminal,ws,api`
- **Tests**: 11 server-side protocol tests + 6 Playwright e2e tests, both asserting full output persistence

## Follow-up tickets

The terminal as a daily-driver and as an agent-integration layer requires more work, broken out into focused tickets:

- **TKTB-054**: Shell integration via OSC 133/633 — the semantic layer that gives us command boundaries, exit codes, and cwd events
- **TKTB-055**: SessionRecord model tied to tickets — persists `SessionEvent` streams to SQLite
- **TKTB-056**: Git diff / file review UI scoped by terminal session
- **TKTB-057**: Relay-native planning chat (the ONE place we do deep agent integration — everywhere else is terminal-based)
- **TKTB-058**: Terminal basics audit (input latency, WebGL renderer, copy/paste, search, font config, scrollback UI)
- **TKTB-059**: Native Mac terminal exploration (watch-only, specific re-eval triggers)

Keep this ticket as the parent/anchor for the terminal work. Moving to feedback once TKTB-054 lands enough of the shell integration to validate the architecture end-to-end.
