---
id: TKTB-071
title: UI server port auto-increment starting at 4242
status: open
priority: medium
tags:
  - phase-0
  - ui
  - server
  - packaging
project: ticketbook
created: '2026-04-11T07:05:51.605Z'
updated: '2026-04-11T07:05:51.605Z'
---

Replace the current "bind port 0, let OS pick a random port" behavior with deterministic auto-increment starting at 4242. Makes the multi-repo UX predictable — ports resolve in launch order instead of giving you `localhost:54987`-type randoms.

Part of PLAN-005 Phase 0. Independent of Tasks A/B/C/E.

## Current behavior

`bin/ticketbook.ts:219`:
```ts
port: args.port ?? 0,
```

`0` tells Bun's `Bun.serve()` to auto-assign. Two ticketbook instances = two random ports.

## Desired behavior

- Default start port: `4242` (already matches the `bun dev` script in `package.json:10`, familiar to anyone who's worked on ticketbook)
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

### `bin/ticketbook.ts`

At line 219, change:
```ts
port: args.port ?? 0,
```
to:
```ts
port: args.port ?? 4242,
autoIncrement: args.port == null,
```

Then at the log line around `bin/ticketbook.ts:224`, lean harder on the outcome:
```ts
if (handle.triedPorts && handle.triedPorts.length > 0) {
  console.log(
    `Ticketbook server listening on http://localhost:${handle.port} ` +
    `(auto-selected; ${handle.triedPorts.join(", ")} in use)`,
  );
} else {
  console.log(`Ticketbook server listening on http://localhost:${handle.port}`);
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
- `bun bin/ticketbook.ts` in a fresh terminal binds to 4242
- A second `bun bin/ticketbook.ts` in another terminal binds to 4243 (log line says so)
- Explicit `bun bin/ticketbook.ts --port 4242` when 4242 is held errors out without retrying
- All tests pass (`bun test`)
- `bun run typecheck` clean
