---
id: TKTB-054
title: Terminal session event stream + OSC 133/633 shell integration
status: open
tags:
  - terminal
  - shell-integration
  - agent-experience
  - v1-foundations
relatedTo:
  - TKTB-055
  - TKTB-064
  - TKTB-046
created: '2026-04-06T07:28:38.615Z'
updated: '2026-04-08T05:18:43.256Z'
---

## Context

After the persistence refactor (PR 1 for terminal architecture) the server runs an `@xterm/headless` mirror per session. This ticket lights up the semantic layer on top: shell integration via OSC 133 (FinalTerm) + OSC 633 (VSCode extensions), wired into the `TerminalSession.onEvent` stream.

This is the unlock for the agent feedback loop (TKTB-046), SessionRecord, and the diff UI. It's the highest-leverage single feature we can add to the terminal.

## Scope

### 1. Shell integration addon

Create a `ShellIntegrationAddon` that attaches to the headless xterm. Registers OSC parser handlers for:
- OSC 133 (`A`/`B`/`C`/`D`) — prompt start, command start, command executed, command finished
- OSC 633 — VSCode's extended sequences (command line capture, continuation, rich command detection)
- OSC 7 / OSC 9 — set cwd (xterm.js / Windows variant)

Reference: VSCode's `src/vs/platform/terminal/common/xterm/shellIntegrationAddon.ts` uses the exact same pattern on `@xterm/headless`. Study it before implementing.

### 2. Inject shell integration scripts

Copy VSCode's shell integration scripts (MIT licensed, in `src/vs/workbench/contrib/terminal/common/scripts/`):
- `shellIntegration-bash.sh`
- `shellIntegration-rc.zsh`, `shellIntegration-env.zsh`, `shellIntegration-login.zsh`, `shellIntegration-profile.zsh`
- `shellIntegration.fish`
- `shellIntegration.ps1`

Inject via shell-specific mechanisms at PTY spawn time:
- bash: `--rcfile` pointing at our copy
- zsh: set `ZDOTDIR` to a dir containing our `.zshrc`
- fish: `--init-command`
- pwsh: profile import

### 3. Emit structured events

The `SessionEvent` type was defined in PR 1 but no events are emitted yet. Wire the OSC handlers to emit:
- `commandStart`: OSC 133;B — captures the command text between B and C
- `commandEnd`: OSC 133;D — includes exit code
- `cwdChanged`: OSC 7 or OSC 633;P cwd=...

Expose via `session.onEvent(cb)`.

### 4. Tests

- Unit: backend test that simulates OSC sequences via `session.write` on the headless terminal and asserts the correct events come out of `onEvent`.
- Integration: spawn a real shell with injection enabled, run a command, assert `commandStart` and `commandEnd` events fire with the right payload.
- Shell matrix: at minimum bash and zsh on macOS. fish/pwsh nice to have.

## Dependencies

Depends on the persistence refactor — the `TerminalSession.onEvent` API and headless xterm are in place after PR 1.

## Non-goals

- Per-shell customization of the integration scripts — take VSCode's as-is.
- Rich command detection (OSC 633 multi-line edge cases) — defer to follow-up.
- Mapping commands to file changes — that's SessionRecord's job.
