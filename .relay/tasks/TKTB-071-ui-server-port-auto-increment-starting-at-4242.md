---
id: TKTB-071
title: UI server port auto-increment starting at 4242
status: done
priority: medium
tags:
  - phase-0
  - ui
  - server
  - packaging
project: relay
assignee: claude-opus
created: '2026-04-11T07:05:51.605Z'
updated: '2026-04-11T07:30:15.462Z'
---

Replace the current "bind port 0, let OS pick a random port" behavior with deterministic auto-increment starting at 4242. Makes the multi-repo UX predictable — ports resolve in launch order instead of giving you `localhost:54987`-type randoms.

Part of PLAN-005 Phase 0. Independent of Tasks A/B/C/E.

## Current behavior

`bin/relay.ts:219`:
```ts
port: args.port ?? 0,
```

`0` tells Bun's `Bun.serve()` to auto-assign. Two relay instances = two random ports.

## Desired behavior

- Default start port: `4242` (already matches the `bun dev` script in `package.json:10`, familiar to anyone who's worked on relay)
- On `EADDRINUSE`, increment and retry up to 100 attempts (covers any realistic multi-repo setup; sanity cap prevents runaway)
- If the user passes `--port <N>` explicitly, hard-fail on collision — they opted in to a specific number, don't silently reassign
- When auto-increment kicks in, log the picked port *and* the ones that were in use, so the user understands what happened

## Changes

### `packages/server/src/index.ts` (where `startServer` lives)

Add a bind-with-retry helper:
```ts
function bindWithIncrement(
  startPort: number,
  maxTries: number,
  serveOptions: Omit<Parameters<typeof Bun.serve>[0], "port">,
): { server: ReturnType<typeof Bun.serve>; port: number; triedPorts: number[] } {
  const tried: number[] = [];
  for (let port = startPort; port < startPort + maxTries; port++) {
    try {
      const server = Bun.serve({ ...serveOptions, port });
      return { server, port, triedPorts: tried };
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("EADDRINUSE") || msg.includes("address already in use")) {
        tried.push(port);
        continue;
      }
      throw err;
    }
  }
  throw new Error(
    `No free port in range ${startPort}-${startPort + maxTries - 1}. ` +
    `Pass --port <N> to pick manually.`,
  );
}
```

Extend `startServer`'s options type with an `autoIncrement?: boolean` flag. When `autoIncrement` is true, use `bindWithIncrement`. When false (explicit `--port`), call `Bun.serve()` directly and let it throw on conflict. Return the actually-bound port and `triedPorts` in the `handle` object so the CLI can log them.

### `bin/relay.ts`

At line 219, change:
```ts
port: args.port ?? 0,
```
to:
```ts
port: args.port ?? 4242,
autoIncrement: args.port == null,
```

Then at the log line around `bin/relay.ts:224`, lean harder on the outcome:
```ts
if (handle.triedPorts && handle.triedPorts.length > 0) {
  console.log(
    `Relay server listening on http://localhost:${handle.port} ` +
    `(auto-selected; ${handle.triedPorts.join(", ")} in use)`,
  );
} else {
  console.log(`Relay server listening on http://localhost:${handle.port}`);
}
```

### Tests

Add `packages/server/src/port-bind.test.ts`:
- Binds to 4242 when free → returns `port: 4242`, `triedPorts: []`
- Binds to 4243 when 4242 is held → returns `port: 4243`, `triedPorts: [4242]`
- Throws a descriptive error after 100 attempts when every port in range is held
- Explicit port path: when `autoIncrement: false` and the port is held, the `EADDRINUSE` error propagates (no retry)

Simulate in-use ports by opening real `Bun.serve()` listeners on them in test setup and closing them in teardown. Use high port numbers in tests (e.g., 14242+) to avoid conflicting with real dev servers.

## Out of scope
- Persisting the chosen port per-repo (Task F — backlog follow-up)
- Changing the default from 4242 to something else
- Bundling the auto-increment with dev mode (`bun dev` already pins 4242; leave it alone)

## Acceptance
- `bun bin/relay.ts` in a fresh terminal binds to 4242
- A second `bun bin/relay.ts` in another terminal binds to 4243 (log line says so)
- Explicit `bun bin/relay.ts --port 4242` when 4242 is held errors out without retrying
- All tests pass (`bun test`)
- `bun run typecheck` clean

<!-- agent-notes -->

## claude-opus implementation + claude-code review — 2026-04-11

**Done.** Implemented by claude-opus in the shared working tree; claude-code reviewed, validated, and committed.

### Shipped
- **`packages/server/src/port-bind.ts`** (new file) — two exports:
  - `isAddressInUseError(err)` helper recognizing three message shapes: `EADDRINUSE`, `address already in use`, and Bun-specific `Failed to start server. Is port ... in use?`.
  - `bindWithIncrementUsing<S>(tryBind, startPort, maxTries)` — **generic callback-style binder** instead of the `Omit<Parameters<typeof Bun.serve>[0], "port">` approach I sketched in the task spec. The callback form is a smarter choice because the options union in Bun's type doesn't survive an `Omit<…, "port">` round-trip — callers would lose `ws.data` narrowing. With the callback form, the caller constructs their own `Bun.serve<WsData>({...})` and the helper just retries by invoking the closure. Elegant.
- **`packages/server/src/port-bind.test.ts`** (new file) — 11 tests:
  - `bindWithIncrementUsing` (6 tests): binds to startPort when free, increments past one held port, skips multiple held ports in order, throws descriptive error when every port in range is held, does NOT catch non-EADDRINUSE errors (they propagate), and a test that models the explicit-port path bypass.
  - `isAddressInUseError` (5 tests): recognizes `EADDRINUSE`, `address already in use`, Bun's `Failed to start server` message, rejects unrelated errors, rejects non-Error values (null, undefined, strings).
  - Uses real `Bun.serve()` instances in setup/teardown with a `holders[]` array and `afterEach` cleanup. `BASE_PORT = 14242` to avoid collision with actual dev servers.
- **`packages/server/src/index.ts`:**
  - Line 8: imports `bindWithIncrementUsing` from `./port-bind.js`
  - Line 34: `ServerConfig.autoIncrement?: boolean` — defaults to `false` (explicit opt-in)
  - Lines 46-52: `ServerHandle` now exposes `port` (actual bound port), `triedPorts` (ports that failed EADDRINUSE), and `close()`
  - Line 55: `PORT_AUTO_INCREMENT_MAX_TRIES = 100`
  - Line 82: `const autoIncrement = config.autoIncrement ?? false;`
  - Lines 158-159: `tryServe = (p) => Bun.serve<WsData>({...})` — callback closure preserves full Bun.serve options + WebSocket type narrowing through the retry loop
  - Lines 415-417: dispatch between auto-increment path (`bindWithIncrementUsing(tryServe, port, PORT_AUTO_INCREMENT_MAX_TRIES)`) and explicit path (`{ server: tryServe(port), port, triedPorts: [] as number[] }`)
- **`bin/relay.ts`:**
  - Line 58: help text updated — `--port <num>   Server port (default: 4242, auto-increment on collision)`
  - Lines 223-224: defaults to 4242, sets `autoIncrement: args.port == null` (only auto-increment when the user DIDN'T pass a specific port)
  - Lines 229-236: log line distinguishes auto-selected ports from direct hits — `Relay server listening on http://localhost:4243 (auto-selected; 4242 in use)` vs plain `Relay server listening on http://localhost:4242`

### Validation
- `bun test` → **318 pass / 0 fail / 645 expect() calls** across 28 files.
- `bun run typecheck` → all packages clean.
- Earlier today there was a transient `TS2552: Cannot find name 'bindWithIncrementUsing'` error in `index.ts:416` — that was from reading the file mid-edit. By the time I re-ran typecheck after my own work, the import at line 8 was already in place and the error was gone. False alarm.

### Design compliments
1. **Generic callback binder** (`bindWithIncrementUsing<S>(tryBind: (port) => S, ...)`) is strictly better than the concrete `Omit<…, "port">` approach in my original task spec. It preserves typed WebSocket `ws.data` narrowing through the retry loop — you could not have done that with an options-splat. Worth remembering as a pattern.
2. **`isAddressInUseError` handles three message shapes** instead of just two. The `Failed to start server. Is port ... in use?` variant is Bun-specific and would have been a latent foot-gun; it's now covered.
3. **Test port range starts at 14242** to avoid collision with the user's real dev servers on 4242. Small but correct detail.
4. **Explicit-port path bypass** goes through `tryServe(port)` directly (no retry loop), so the caller gets raw `EADDRINUSE` when they pass `--port <N>` explicitly. Honors user intent cleanly.

### Follow-up (Task F / TKTB-072 — backlog)
The pinned-per-repo UI port follow-up will build on both this work and TKTB-070's config schema. Let it stay backlog until real daily multi-repo use surfaces the launch-order-flipping pain.
