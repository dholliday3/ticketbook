import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runUpgrade,
  fetchLatestVersion,
  getCurrentVersion,
} from "./upgrade.js";
import { VERSION } from "./version.js";

// Tiny mock Response — just enough surface area for fetchLatestVersion
// and runUpgrade. We intentionally don't import the global Response type
// because we only need the shape.
type MockResponseInit =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; statusText: string };

function mockResponse(init: MockResponseInit): Response {
  if (init.ok) {
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => init.body,
    } as unknown as Response;
  }
  return {
    ok: false,
    status: init.status,
    statusText: init.statusText,
    json: async () => {
      throw new Error("unreachable");
    },
  } as unknown as Response;
}

function mockFetch(
  response: Response,
  capture?: { url?: string },
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    if (capture) {
      capture.url = typeof input === "string" ? input : input.toString();
    }
    return response;
  }) as unknown as typeof fetch;
}

describe("getCurrentVersion", () => {
  test("returns the VERSION constant from ./version.ts", () => {
    const version = getCurrentVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
    expect(version).toBe(VERSION);
  });
});

describe("VERSION sync", () => {
  test("packages/core/src/version.ts and packages/core/package.json stay in lockstep", () => {
    // Version.ts is the runtime source of truth (read by upgrade.ts and
    // packages/server/src/mcp.ts); package.json is the workspace-manager
    // source of truth. Keeping them in sync by hand is a known footgun,
    // so this test fires if they drift. To bump for a release, edit
    // BOTH files to the new semver string.
    const testFileDir = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(testFileDir, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      version?: string;
    };
    expect(pkg.version).toBeDefined();
    expect(VERSION).toBe(pkg.version!);
  });
});

describe("fetchLatestVersion", () => {
  test("strips the leading v from tag_name", async () => {
    const fetchFn = mockFetch(mockResponse({ ok: true, body: { tag_name: "v0.2.5" } }));
    const version = await fetchLatestVersion(fetchFn);
    expect(version).toBe("0.2.5");
  });

  test("leaves tag_name alone when there's no v prefix", async () => {
    const fetchFn = mockFetch(mockResponse({ ok: true, body: { tag_name: "1.0.0" } }));
    const version = await fetchLatestVersion(fetchFn);
    expect(version).toBe("1.0.0");
  });

  test("hits the correct GitHub Releases endpoint", async () => {
    const capture: { url?: string } = {};
    const fetchFn = mockFetch(
      mockResponse({ ok: true, body: { tag_name: "v0.1.0" } }),
      capture,
    );
    await fetchLatestVersion(fetchFn);
    expect(capture.url).toBe(
      "https://api.github.com/repos/dholliday3/relay/releases/latest",
    );
  });

  test("throws on HTTP error with status in the message", async () => {
    const fetchFn = mockFetch(
      mockResponse({ ok: false, status: 404, statusText: "Not Found" }),
    );
    await expect(fetchLatestVersion(fetchFn)).rejects.toThrow(
      /404.*Not Found/,
    );
  });

  test("throws when tag_name is missing from the response", async () => {
    const fetchFn = mockFetch(mockResponse({ ok: true, body: {} }));
    await expect(fetchLatestVersion(fetchFn)).rejects.toThrow(/tag_name/);
  });
});

describe("runUpgrade — --check mode", () => {
  test("reports upToDate=true when current matches latest", async () => {
    const current = getCurrentVersion();
    const result = await runUpgrade({
      check: true,
      fetch: mockFetch(
        mockResponse({ ok: true, body: { tag_name: `v${current}` } }),
      ),
    });
    expect(result).toEqual({
      action: "checked",
      current,
      latest: current,
      upToDate: true,
    });
  });

  test("reports upToDate=false when latest is different", async () => {
    const current = getCurrentVersion();
    const result = await runUpgrade({
      check: true,
      fetch: mockFetch(
        mockResponse({ ok: true, body: { tag_name: "v99.0.0" } }),
      ),
    });
    expect(result.action).toBe("checked");
    if (result.action !== "checked") throw new Error("unreachable");
    expect(result.current).toBe(current);
    expect(result.latest).toBe("99.0.0");
    expect(result.upToDate).toBe(false);
  });

  test("does not spawn install.sh in --check mode", async () => {
    let spawned = false;
    await runUpgrade({
      check: true,
      fetch: mockFetch(
        mockResponse({ ok: true, body: { tag_name: "v99.0.0" } }),
      ),
      spawn: () => {
        spawned = true;
        return { exitCode: 0 };
      },
    });
    expect(spawned).toBe(false);
  });
});

describe("runUpgrade — default mode", () => {
  test("returns unchanged when current matches latest", async () => {
    const current = getCurrentVersion();
    const result = await runUpgrade({
      fetch: mockFetch(
        mockResponse({ ok: true, body: { tag_name: `v${current}` } }),
      ),
    });
    expect(result).toEqual({
      action: "unchanged",
      current,
      latest: current,
    });
  });

  test("does not spawn install.sh when already up to date", async () => {
    const current = getCurrentVersion();
    let spawned = false;
    await runUpgrade({
      fetch: mockFetch(
        mockResponse({ ok: true, body: { tag_name: `v${current}` } }),
      ),
      spawn: () => {
        spawned = true;
        return { exitCode: 0 };
      },
    });
    expect(spawned).toBe(false);
  });

  test("spawns install.sh via curl | bash when stale", async () => {
    let spawnedCmd: string[] | undefined;
    const current = getCurrentVersion();
    const result = await runUpgrade({
      fetch: mockFetch(
        mockResponse({ ok: true, body: { tag_name: "v99.0.0" } }),
      ),
      spawn: (cmd) => {
        spawnedCmd = cmd;
        return { exitCode: 0 };
      },
    });
    expect(result).toEqual({
      action: "upgraded",
      previous: current,
      latest: "99.0.0",
    });
    expect(spawnedCmd).toBeDefined();
    expect(spawnedCmd?.[0]).toBe("sh");
    expect(spawnedCmd?.[1]).toBe("-c");
    expect(spawnedCmd?.[2]).toContain("curl -fsSL");
    expect(spawnedCmd?.[2]).toContain("install.sh");
    expect(spawnedCmd?.[2]).toContain("| bash");
  });

  test("throws a descriptive error when install.sh exits non-zero", async () => {
    await expect(
      runUpgrade({
        fetch: mockFetch(
          mockResponse({ ok: true, body: { tag_name: "v99.0.0" } }),
        ),
        spawn: () => ({ exitCode: 1 }),
      }),
    ).rejects.toThrow(/install\.sh exited with code 1/);
  });

  test("error message includes the manual fallback command", async () => {
    await expect(
      runUpgrade({
        fetch: mockFetch(
          mockResponse({ ok: true, body: { tag_name: "v99.0.0" } }),
        ),
        spawn: () => ({ exitCode: 42 }),
      }),
    ).rejects.toThrow(/curl -fsSL.*install\.sh.*bash/);
  });
});
