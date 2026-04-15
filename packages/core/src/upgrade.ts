/**
 * `relay upgrade` — self-update the installed binary.
 *
 * Contract:
 *   - Current version comes from ./version.ts, a plain TS constant
 *     bumped at release time. Keeping it as a constant (rather than
 *     reading package.json or using ES2023 import attributes) means
 *     this module stays portable — core's tsconfig targets ES2022
 *     without Bun-specific types, so no runtime-specific APIs here.
 *   - Latest version comes from the GitHub Releases API. We strip the
 *     leading `v` so comparisons match the version.ts semver form.
 *   - The upgrade itself re-invokes `scripts/install.sh` via
 *     `curl | bash`, trusting install.sh's verify+replace pipeline
 *     instead of duplicating it here. This mirrors seeds' pattern
 *     (which re-runs `bun install -g`) and keeps this module small.
 *
 * Dependency-injected `fetch` + `spawn` so unit tests can run without
 * hitting the network or actually executing install.sh. Default spawn
 * uses `node:child_process.spawnSync` (portable; Bun implements it),
 * not `Bun.spawnSync`, so this file is Bun-agnostic.
 */

import { spawnSync } from "node:child_process";
import { VERSION } from "./version.js";

/**
 * GitHub repository slug. Must match the repo your binaries are
 * released to — this is where both the releases API and install.sh
 * resolve to. Hardcoded rather than env-var-driven because the
 * compiled binary ships as a single artifact and shouldn't have a
 * runtime-configurable upgrade target.
 */
const REPO = "dholliday3/relay";

/**
 * Raw GitHub URL for the install script. `main` branch (not a tagged
 * revision) so `relay upgrade` always pulls the most recent
 * installer — fixes to install.sh itself shouldn't require cutting
 * a new binary release.
 */
const INSTALL_SH_URL =
  "https://raw.githubusercontent.com/dholliday3/relay/main/scripts/install.sh";

export interface RunUpgradeOptions {
  /** Report version info without actually upgrading. */
  check?: boolean;
  /**
   * Override `fetch` for tests. Defaults to the global `fetch` — live
   * upgrades hit the real GitHub API.
   */
  fetch?: typeof fetch;
  /**
   * Override the spawn helper for tests. Defaults to `Bun.spawnSync` with
   * stdio piped through to the parent so the user sees install.sh's
   * progress output in real time.
   */
  spawn?: (cmd: string[]) => { exitCode: number };
}

export type RunUpgradeResult =
  | {
      action: "checked";
      current: string;
      latest: string;
      upToDate: boolean;
    }
  | {
      action: "unchanged";
      current: string;
      latest: string;
    }
  | {
      action: "upgraded";
      previous: string;
      latest: string;
    };

/**
 * Returns the compile-time version of @relay/core, from the
 * VERSION constant in ./version.ts. Synchronous — no filesystem
 * access is involved at runtime in either dev or compiled-binary mode.
 */
export function getCurrentVersion(): string {
  return VERSION;
}

/**
 * Fetch the latest release tag from GitHub's releases API and strip the
 * leading `v` so comparisons match the package.json semver form.
 * Accepts an optional `fetchFn` for testing.
 */
export async function fetchLatestVersion(
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const url = `https://api.github.com/repos/${REPO}/releases/latest`;
  const res = await fetchFn(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch latest release from GitHub: ${res.status} ${res.statusText}`,
    );
  }
  const data = (await res.json()) as { tag_name?: string };
  if (!data.tag_name) {
    throw new Error(
      "GitHub releases API response missing tag_name field.",
    );
  }
  return data.tag_name.startsWith("v")
    ? data.tag_name.slice(1)
    : data.tag_name;
}

/**
 * Run the upgrade flow. Returns a structured result; the CLI in
 * bin/relay.ts formats it for human and --json output.
 *
 * Exit-code semantics (set by the CLI, not this function):
 *   - `checked` with upToDate=false → exit 1 (mirrors `onboard --check`)
 *   - any other success state → exit 0
 */
export async function runUpgrade(
  options: RunUpgradeOptions = {},
): Promise<RunUpgradeResult> {
  const fetchFn = options.fetch ?? fetch;
  const spawnFn =
    options.spawn ??
    ((cmd: string[]): { exitCode: number } => {
      // node:child_process.spawnSync — portable across Bun and Node.
      // stdio inherit so the user sees install.sh's download progress.
      const [command, ...rest] = cmd;
      if (!command) return { exitCode: -1 };
      const result = spawnSync(command, rest, { stdio: "inherit" });
      return { exitCode: result.status ?? -1 };
    });

  const current = getCurrentVersion();
  const latest = await fetchLatestVersion(fetchFn);

  if (options.check) {
    return {
      action: "checked",
      current,
      latest,
      upToDate: current === latest,
    };
  }

  if (current === latest) {
    return { action: "unchanged", current, latest };
  }

  // Stale — re-invoke install.sh and trust its verify+replace pipeline.
  // We pipe curl → bash so the user can see progress; our spawn helper
  // inherits stdio by default.
  const result = spawnFn(["sh", "-c", `curl -fsSL ${INSTALL_SH_URL} | bash`]);
  if (result.exitCode !== 0) {
    throw new Error(
      `install.sh exited with code ${result.exitCode}. ` +
        `Try re-running the installer manually: ` +
        `curl -fsSL ${INSTALL_SH_URL} | bash`,
    );
  }

  return { action: "upgraded", previous: current, latest };
}
