---
id: TKTB-072
title: Pin UI port per-repo in .tasks/.config.yaml (follow-up)
status: backlog
priority: low
tags:
  - ui
  - server
  - followup
project: relay
blockedBy:
  - TKTB-070
  - TKTB-071
created: '2026-04-11T07:06:07.586Z'
updated: '2026-04-11T07:07:35.090Z'
---

Follow-up to PLAN-005 Phase 0 Task D (UI port auto-increment). After auto-increment lands, each repo's UI port depends on launch order — if you launch projA then projB, projA gets 4242 and projB gets 4243, but the assignment flips when you launch in the other order. The fix: persist the first successfully bound port per repo so each repo has a stable URL across restarts.

**Not part of Phase 0.** Intentionally split off to keep Phase 0 tight. Only worth doing once the user is running relay across many repos daily and the launch-order port flipping has become annoying in practice.

## Why

Task D (auto-increment) resolves collisions deterministically but doesn't give each repo a stable identity. Bookmarking `localhost:4243` as "projB's relay" only works if projB was launched second every time. For daily multi-repo use, you want `localhost:4242` to always mean projA regardless of launch order.

## Design sketch

1. On the first successful bind, write `uiPort: <port>` to `.tasks/.config.yaml` if not already set.
2. On subsequent startups, read `uiPort` from the config and try it first.
3. If the persisted port is now in use (some other process grabbed it), fall back to auto-increment starting at 4242 — don't overwrite the persisted value unless the user passes `--port` explicitly.
4. `--port <N>` explicit: use it, update the persisted value (user opted in to pinning a new port).

## Dependencies

Blocked by **both**:
- **Task C** — adds the `name` field and the config schema work that this task piggybacks on. This task should use the same config read/write path Task C establishes.
- **Task D** — adds the auto-increment that this builds on.

Build on top of both; don't rework either.

## Out of scope

A workspace-switcher UI (one long-running relay process, dropdown to switch between known repos). Much bigger redesign; PLAN-005 explicitly scope-bounds against it. File separately if it ever becomes a real need.

## Acceptance

- First `relay` in a new repo picks a free port (starting at 4242), binds it, and writes `uiPort: <port>` to `.tasks/.config.yaml`
- Subsequent `relay` starts in the same repo try the persisted port first
- If the persisted port is held by something else, fall back to auto-increment without overwriting the persisted value
- Explicit `--port <N>` both uses the port and updates the persisted value
- All tests pass
