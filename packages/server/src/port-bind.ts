/**
 * Port-binding helpers for the relay HTTP server.
 *
 * The CLI defaults to port 4242 and auto-increments on EADDRINUSE so that
 * multi-repo setups produce deterministic, predictable port assignments
 * (4242 → 4243 → 4244 …) instead of random OS-assigned ports. When the user
 * passes `--port <N>` explicitly we bypass the retry loop and let the EADDRINUSE
 * error propagate — if they opted into a specific number, silently reassigning
 * would be surprising.
 */

/** Bun surfaces EADDRINUSE with a few different message shapes across versions. */
export function isAddressInUseError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  return (
    msg.includes("EADDRINUSE") ||
    msg.includes("address already in use") ||
    msg.includes("Failed to start server. Is port")
  );
}

export interface BindWithIncrementResult<S> {
  server: S;
  port: number;
  /** Ports we tried and got EADDRINUSE on before landing on `port`. Empty when the first attempt succeeded. */
  triedPorts: number[];
}

/**
 * Generic retry-on-EADDRINUSE helper. The caller supplies a `tryBind` closure
 * that constructs and returns their server for a given port (typically
 * `(p) => Bun.serve<WsData>({ port: p, ... })`). We call it starting at
 * `startPort` and increment on EADDRINUSE until we succeed or exhaust
 * `maxTries` attempts.
 *
 * Passing a closure (rather than a Bun.serve options object) lets callers
 * preserve their narrow WebSocket data types — the options union in Bun's
 * type doesn't survive an `Omit<…, "port">` round-trip.
 */
export function bindWithIncrementUsing<S>(
  tryBind: (port: number) => S,
  startPort: number,
  maxTries: number,
): BindWithIncrementResult<S> {
  const tried: number[] = [];
  for (let port = startPort; port < startPort + maxTries; port++) {
    try {
      const server = tryBind(port);
      return { server, port, triedPorts: tried };
    } catch (err) {
      if (isAddressInUseError(err)) {
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
