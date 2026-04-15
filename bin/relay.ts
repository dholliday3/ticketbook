#!/usr/bin/env bun

import { resolve, join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { stat } from "node:fs/promises";
import {
  initRelay,
  codexMcpInstructions,
} from "../packages/core/src/init.ts";
import { findRelayDirWithWorktree } from "../packages/core/src/worktree.ts";
import { runOnboard } from "../packages/core/src/onboard.ts";
import { runUpgrade } from "../packages/core/src/upgrade.ts";
import { startMcpServer } from "../packages/server/src/mcp.ts";
import { startServer } from "../packages/server/src/index.ts";
import { isAddressInUseError } from "../packages/server/src/port-bind.ts";
import {
  describePortSquatter,
  formatPortInUseMessage,
} from "../packages/server/src/port-diagnose.ts";
// Embed SKILL.md via Bun's `with { type: "file" }` import attribute.
// In dev mode this returns the real filesystem path; inside a compiled
// binary it returns a `$bunfs/` virtual path. Both forms are readable
// via Bun.file() and node:fs's readFile(), which is how initRelay
// copies the skill into a target project's .claude/skills/ directory.
import SKILL_SOURCE from "../skills/relay/SKILL.md" with { type: "file" };

interface CliArgs {
  command: "serve" | "init" | "onboard" | "upgrade";
  dir?: string;
  port?: number;
  noUi: boolean;
  mcp: boolean;
  /** --check — report state without side effects. Used by onboard + upgrade. */
  check: boolean;
  /** --stdout (onboard only) — print the wrapped section to stdout, touch no files. */
  stdout: boolean;
  /** --json — emit structured JSON instead of human-readable lines (onboard + upgrade). */
  json: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const result: CliArgs = {
    command: "serve",
    noUi: false,
    mcp: false,
    check: false,
    stdout: false,
    json: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "init") {
      result.command = "init";
    } else if (arg === "onboard") {
      result.command = "onboard";
    } else if (arg === "upgrade") {
      result.command = "upgrade";
    } else if (arg === "--dir" && i + 1 < args.length) {
      result.dir = args[++i];
    } else if (arg === "--port" && i + 1 < args.length) {
      result.port = parseInt(args[++i], 10);
    } else if (arg === "--no-ui") {
      result.noUi = true;
    } else if (arg === "--mcp") {
      result.mcp = true;
    } else if (arg === "--check") {
      result.check = true;
    } else if (arg === "--stdout") {
      result.stdout = true;
    } else if (arg === "--json") {
      result.json = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (!arg.startsWith("-")) {
      result.dir = arg;
    }
    i++;
  }

  return result;
}

function printUsage(): void {
  console.log(`Usage: relay [command] [options] [path]

Commands:
  init        Scaffold .relay/ directory, .mcp.json, and skill files
  onboard     Write/update the relay agent instructions section in CLAUDE.md (or AGENTS.md)
  upgrade     Upgrade relay to the latest release from GitHub
  (default)   Start the server and open the UI

Options:
  --dir <path>   Path to .relay/ directory (or directory containing it)
  --port <num>   Server port (default: 4242, auto-increment on collision)
  --no-ui        Server only, no static UI serving
  --mcp          Start MCP server mode (stdio transport, no HTTP)
  --check        Report status without side effects (onboard + upgrade); exits 1 if stale
  --stdout       (onboard only) Print the onboarding section to stdout, touching no files
  --json         Emit structured JSON output (onboard + upgrade)
  -h, --help     Show this help message`);
}

/** Walk up from startDir to find a .relay/ directory, with worktree awareness. */
async function findRelayDir(startDir: string): Promise<string | null> {
  const { relayDir, isWorktree } = await findRelayDirWithWorktree(startDir);
  if (relayDir && isWorktree) {
    console.error(
      `Detected git worktree — using main repo artifacts at ${relayDir}`,
    );
  }
  return relayDir;
}

/** Resolve a user-provided path to a .relay/ directory */
async function resolveRelayDir(givenPath: string): Promise<string> {
  const resolved = resolve(givenPath);

  // If the path itself is a .relay directory, use it directly
  if (basename(resolved) === ".relay") {
    try {
      const s = await stat(resolved);
      if (s.isDirectory()) return resolved;
    } catch {
      // Doesn't exist yet — that's OK for init
    }
    return resolved;
  }

  // Check if it contains a .relay subdirectory
  const withRelay = join(resolved, ".relay");
  try {
    const s = await stat(withRelay);
    if (s.isDirectory()) return withRelay;
  } catch {
    // No .relay inside — assume the path IS the relay dir
  }

  return withRelay;
}

/**
 * Resolve the path to the bundled SKILL.md. Just returns the embedded
 * path from the top-of-file `with { type: "file" }` import — Bun handles
 * both dev-mode (real path) and compiled-binary (`$bunfs/`) resolution
 * transparently, so the caller doesn't need to care which mode we're in.
 */
function resolveSkillSourcePath(): string {
  return SKILL_SOURCE;
}

/** Print a summary of what init created and next-step instructions. */
function printInitSummary(
  baseDir: string,
  result: Awaited<ReturnType<typeof initRelay>>,
): void {
  console.log(`Initialized relay at ${result.relayDir}`);

  const created: string[] = [];
  if (result.wroteSkill) {
    created.push("  .claude/skills/relay/SKILL.md");
    created.push("  .agents/skills/relay/SKILL.md");
  }
  if (result.wroteMcpConfig) {
    created.push("  .mcp.json");
  } else if (result.mergedMcpConfig) {
    created.push("  .mcp.json (merged relay entry)");
  }

  if (created.length > 0) {
    console.log("\nAgent integration files:");
    for (const line of created) console.log(line);
  }

  if (result.devMode) {
    console.log(
      `\nDetected relay source repo — .mcp.json uses dev-mode command (bun bin/relay.ts --mcp).`,
    );
  }

  console.log(`\nClaude Code: the .mcp.json will auto-load on next session.`);
  console.log(`\nCodex: add this to ~/.codex/config.toml:\n`);
  console.log(codexMcpInstructions());
  console.log("");
  console.log(
    `Next: run 'relay onboard' to add agent instructions to CLAUDE.md.`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // --- Init command ---
  if (args.command === "init") {
    const baseDir = args.dir ? resolve(args.dir) : process.cwd();
    const result = await initRelay({
      baseDir,
      skillSourcePath: resolveSkillSourcePath(),
    });
    printInitSummary(baseDir, result);
    return;
  }

  // --- Onboard command ---
  if (args.command === "onboard") {
    const baseDir = args.dir ? resolve(args.dir) : process.cwd();
    const result = await runOnboard({
      baseDir,
      check: args.check,
      stdout: args.stdout,
    });

    // --stdout already printed the wrapped snippet; nothing more to say.
    if (result.action === "stdout") return;

    if (args.json) {
      // Mirror seeds' envelope shape: always success=true on the happy
      // path, command name, plus whatever action-specific fields exist.
      const envelope: Record<string, unknown> = {
        success: true,
        command: "onboard",
        action: result.action,
      };
      if ("file" in result) envelope.file = result.file;
      if ("status" in result) envelope.status = result.status;
      console.log(JSON.stringify(envelope));
    } else {
      switch (result.action) {
        case "created":
          console.log(`Created ${result.file} with relay section`);
          break;
        case "updated":
          console.log(`Updated relay section in ${result.file}`);
          break;
        case "unchanged":
          console.log(
            `Relay section is already up to date (${result.file})`,
          );
          break;
        case "appended":
          console.log(`Added relay section to ${result.file}`);
          break;
        case "checked":
          console.log(
            `Status: ${result.status}${result.file ? ` (${result.file})` : " (no candidate file)"}`,
          );
          break;
      }
    }

    // --check mode: exit 1 when the section is missing or outdated so CI
    // can use it as a freshness gate (mirrors seeds' sd onboard --check).
    if (result.action === "checked" && result.status !== "current") {
      process.exitCode = 1;
    }
    return;
  }

  // --- Upgrade command ---
  if (args.command === "upgrade") {
    // Catch network/spawn failures cleanly — the 404-before-first-release
    // case and any other runUpgrade error should surface as a one-line
    // message, not a stack trace. In --json mode we wrap the error in the
    // envelope shape so scripts can parse it.
    let result: Awaited<ReturnType<typeof runUpgrade>>;
    try {
      result = await runUpgrade({ check: args.check });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (args.json) {
        console.log(
          JSON.stringify({ success: false, command: "upgrade", error: msg }),
        );
      } else {
        console.error(`relay upgrade failed: ${msg}`);
      }
      process.exit(1);
    }

    if (args.json) {
      // Mirror seeds' envelope shape across all upgrade actions.
      const envelope: Record<string, unknown> = {
        success: true,
        command: "upgrade",
        action: result.action,
      };
      if (result.action === "checked") {
        envelope.current = result.current;
        envelope.latest = result.latest;
        envelope.upToDate = result.upToDate;
      } else if (result.action === "unchanged") {
        envelope.current = result.current;
        envelope.latest = result.latest;
      } else if (result.action === "upgraded") {
        envelope.previous = result.previous;
        envelope.latest = result.latest;
      }
      console.log(JSON.stringify(envelope));
    } else {
      switch (result.action) {
        case "checked":
          if (result.upToDate) {
            console.log(`Already up to date (${result.current})`);
          } else {
            console.log(
              `Update available: ${result.current} → ${result.latest}`,
            );
            console.log(
              `Run 'relay upgrade' to install the latest release.`,
            );
          }
          break;
        case "unchanged":
          console.log(`Already up to date (${result.current})`);
          break;
        case "upgraded":
          console.log(
            `Upgraded relay from ${result.previous} to ${result.latest}`,
          );
          break;
      }
    }

    // --check mode: exit 1 when we're behind the latest release so CI
    // and shell prompt integrations can use it as a staleness gate.
    if (result.action === "checked" && !result.upToDate) {
      process.exitCode = 1;
    }
    return;
  }

  // --- Resolve .relay/ directory ---
  let relayDir: string | null = null;

  if (args.dir) {
    relayDir = await resolveRelayDir(args.dir);
  } else {
    relayDir = await findRelayDir(process.cwd());
  }

  if (!relayDir) {
    console.log("No .relay/ directory found.");
    const answer = prompt("Would you like to initialize one here? (y/N) ");
    if (answer?.toLowerCase() === "y") {
      const result = await initRelay({
        baseDir: process.cwd(),
        skillSourcePath: resolveSkillSourcePath(),
      });
      relayDir = result.relayDir;
      printInitSummary(process.cwd(), result);
    } else {
      console.log("Run 'relay init' to create a .relay/ directory.");
      process.exit(1);
    }
  }

  // Derive subdirectories from the .relay/ root
  const tasksDir = join(relayDir, "tasks");
  const plansDir = join(relayDir, "plans");
  const docsDir = join(relayDir, "docs");

  // --- MCP mode ---
  if (args.mcp) {
    console.error(
      `Relay MCP server (stdio) — tasks: ${tasksDir}, plans: ${plansDir}, docs: ${docsDir}`,
    );
    await startMcpServer(relayDir, tasksDir, plansDir, docsDir);
    return;
  }

  // --- HTTP server mode ---
  const uiDistDir = args.noUi
    ? undefined
    : resolve(join(import.meta.dir, "../packages/ui/dist"));

  // Absolute path to this script — passed through so the copilot manager can
  // wire up an MCP config that re-invokes us in --mcp mode for tool access.
  //
  // In a `bun build --compile` standalone binary, `import.meta.url` resolves
  // to a `$bunfs/…` virtual path. That path is only readable by the parent
  // Bun process that created the embedded filesystem — a freshly spawned
  // `bun run $bunfs/…` child cannot open it, which silently breaks the
  // copilot's MCP server. Detect that case and hand the compiled binary
  // path through as `execPath`; the copilot manager will emit a config
  // that re-invokes the binary itself (`execPath --mcp --dir …`) instead
  // of `bun run <binPath>`.
  const binPath = fileURLToPath(import.meta.url);
  const isCompiledBinary = binPath.includes("$bunfs");
  const execPath = isCompiledBinary ? process.execPath : undefined;

  // Default start port 4242 with auto-increment on EADDRINUSE. Multi-repo
  // setups get a deterministic sequence (4242 → 4243 → …) instead of random
  // OS-assigned ports. When the user passes --port explicitly, disable
  // auto-increment so a collision surfaces clearly instead of being hidden.
  //
  // On the explicit-port path, EADDRINUSE is the most common "first contact"
  // failure — usually an orphaned `bun dev` from a previous session. Catch it
  // here and replace the stack trace with a friendly message that identifies
  // the squatter by PID and shows the exact `kill` command to run.
  const serverPort = args.port ?? 4242;
  let handle: ReturnType<typeof startServer>;
  try {
    handle = startServer({
      relayDir,
      tasksDir,
      plansDir,
      docsDir,
      port: serverPort,
      autoIncrement: args.port == null,
      staticDir: uiDistDir,
      binPath,
      execPath,
    });
  } catch (err) {
    if (isAddressInUseError(err)) {
      const squatter = await describePortSquatter(serverPort);
      console.error(formatPortInUseMessage(serverPort, squatter));
      process.exit(1);
    }
    throw err;
  }

  if (handle.triedPorts.length > 0) {
    console.log(
      `Relay server listening on http://localhost:${handle.port} ` +
        `(auto-selected; ${handle.triedPorts.join(", ")} in use)`,
    );
  } else {
    console.log(`Relay server listening on http://localhost:${handle.port}`);
  }
  console.log(`Relay directory: ${relayDir}`);
  if (!args.noUi && uiDistDir) {
    console.log(`UI: http://localhost:${handle.port}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
