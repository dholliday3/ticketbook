---
id: TKTB-058
title: Terminal basics audit and polish
status: backlog
tags:
  - terminal
  - polish
  - agent-editor
created: '2026-04-06T07:30:30.314Z'
updated: '2026-04-12T03:56:49.651Z'
---

## Context

After the persistence refactor lands, there are a bunch of smaller terminal fundamentals that deserve a focused pass. Not blocking anything, but together they define whether the terminal feels like a daily-driver tool or a compromise.

## Scope

### Performance

- **Input latency measurement**: wire up a test that measures keystroke → pixel time with the Chrome DevTools MCP. Establish a baseline, set a budget (<50ms p95).
- **WebGL renderer**: xterm.js has a WebGL addon (`@xterm/addon-webgl`) that improves performance significantly. Enable it behind a config flag, measure the delta, make it the default if stable.
- **React re-render audit**: profile the terminal host component with React DevTools. Memoize anything that re-renders on ticket state changes. The terminal should be inert during ticketbook UI activity.

### Basics

- **Copy/paste**: verify keyboard shortcuts (Cmd+C/V on macOS, Ctrl+Shift+C/V on Linux) work correctly, including with multi-line selections.
- **Search**: add `@xterm/addon-search` and a Cmd+F binding to search within the terminal buffer.
- **Link detection**: `@xterm/addon-web-links` + a handler that opens URLs in the system browser.
- **Font config**: make font family, size, and line height configurable via `.tickets/.config.yaml` (`terminalFont`, `terminalFontSize`, `terminalLineHeight`).
- **Themes**: the current hardcoded dark theme is fine as a default, but expose a config option to override individual colors.

### User-facing scrollback setting

The persistence refactor added `terminalScrollback` to the config schema. Add a UI control (settings panel) so users don't have to edit YAML.

### Selection and highlighting

- Double-click to select word, triple-click to select line — standard behavior
- URL highlighting on hover (via web-links addon)
- Visual indicator for the current command range (needs shell integration — depends on TKTB-054)

## Dependencies

- Persistence refactor (in-progress, PR 1 of TKTB-042)
- Shell integration (TKTB-054) — only for the 'current command range' highlight; rest is independent

## Non-goals

- Changing the xterm.js version (stay on current major)
- Custom renderer — use xterm's WebGL addon, not a hand-rolled one
- Native Mac rewrite — that's a separate ticket
