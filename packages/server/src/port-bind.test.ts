import { describe, test, expect, afterEach } from "bun:test";
import { bindWithIncrementUsing, isAddressInUseError } from "./port-bind.js";

// Use a high starting port to avoid colliding with real dev servers. The
// range 14242+ is well away from 4242 (relay dev) and other common
// local services.
const BASE_PORT = 14242;

// Minimal Bun.serve handler — just needs to bind, it doesn't have to do
// anything useful for these tests.
function makeNoopServe(port: number): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port,
    fetch() {
      return new Response("ok");
    },
  });
}

describe("bindWithIncrementUsing", () => {
  const holders: Array<{ stop: () => void }> = [];

  afterEach(() => {
    while (holders.length > 0) {
      try {
        holders.pop()?.stop();
      } catch {
        /* already stopped */
      }
    }
  });

  test("binds to startPort when it is free", () => {
    const result = bindWithIncrementUsing(makeNoopServe, BASE_PORT, 10);
    holders.push(result.server);

    expect(result.port).toBe(BASE_PORT);
    expect(result.triedPorts).toEqual([]);
  });

  test("increments past a held port and records it in triedPorts", () => {
    // Hold BASE_PORT + 100 so the loop has to increment past it.
    const startPort = BASE_PORT + 100;
    const blocker = makeNoopServe(startPort);
    holders.push(blocker);

    const result = bindWithIncrementUsing(makeNoopServe, startPort, 10);
    holders.push(result.server);

    expect(result.port).toBe(startPort + 1);
    expect(result.triedPorts).toEqual([startPort]);
  });

  test("skips multiple held ports in order", () => {
    const startPort = BASE_PORT + 200;
    const b1 = makeNoopServe(startPort);
    const b2 = makeNoopServe(startPort + 1);
    const b3 = makeNoopServe(startPort + 2);
    holders.push(b1, b2, b3);

    const result = bindWithIncrementUsing(makeNoopServe, startPort, 10);
    holders.push(result.server);

    expect(result.port).toBe(startPort + 3);
    expect(result.triedPorts).toEqual([startPort, startPort + 1, startPort + 2]);
  });

  test("throws a descriptive error when every port in the range is held", () => {
    const startPort = BASE_PORT + 300;
    const maxTries = 3;
    for (let p = startPort; p < startPort + maxTries; p++) {
      holders.push(makeNoopServe(p));
    }

    expect(() =>
      bindWithIncrementUsing(makeNoopServe, startPort, maxTries),
    ).toThrow(/No free port in range/);
    expect(() =>
      bindWithIncrementUsing(makeNoopServe, startPort, maxTries),
    ).toThrow(/Pass --port/);
  });

  test("does not catch non-EADDRINUSE errors thrown by the binder", () => {
    const boom = () => {
      throw new Error("something else is broken");
    };
    expect(() =>
      bindWithIncrementUsing(boom as (p: number) => never, BASE_PORT + 400, 5),
    ).toThrow("something else is broken");
  });

  test("explicit path — calling Bun.serve directly still propagates EADDRINUSE", () => {
    // This models the explicit --port code path: the CLI bypasses
    // bindWithIncrementUsing and calls the binder callback exactly once,
    // so EADDRINUSE reaches the user with no retry.
    const startPort = BASE_PORT + 500;
    const blocker = makeNoopServe(startPort);
    holders.push(blocker);

    let caught: unknown;
    try {
      makeNoopServe(startPort);
    } catch (err) {
      caught = err;
    }
    expect(isAddressInUseError(caught)).toBe(true);
  });
});

describe("isAddressInUseError", () => {
  test("recognizes EADDRINUSE in the message", () => {
    expect(isAddressInUseError(new Error("bind EADDRINUSE 127.0.0.1:4242"))).toBe(true);
  });

  test("recognizes 'address already in use'", () => {
    expect(isAddressInUseError(new Error("listen: address already in use"))).toBe(true);
  });

  test("recognizes Bun's 'Failed to start server' message", () => {
    expect(
      isAddressInUseError(new Error("Failed to start server. Is port 4242 in use?")),
    ).toBe(true);
  });

  test("returns false for unrelated errors", () => {
    expect(isAddressInUseError(new Error("something else"))).toBe(false);
  });

  test("returns false for non-Error values", () => {
    expect(isAddressInUseError("not an error")).toBe(false);
    expect(isAddressInUseError(null)).toBe(false);
    expect(isAddressInUseError(undefined)).toBe(false);
  });
});
