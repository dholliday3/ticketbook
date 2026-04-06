#!/usr/bin/env bun

import { resolve, join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { stat, mkdir, writeFile, readFile, appendFile } from "node:fs/promises";

interface CliArgs {
  command: "serve" | "init";
  dir?: string;
  port?: number;
  noUi: boolean;
  mcp: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const result: CliArgs = { command: "serve", noUi: false, mcp: false };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "init") {
      result.command = "init";
    } else if (arg === "--dir" && i + 1 < args.length) {
      result.dir = args[++i];
    } else if (arg === "--port" && i + 1 < args.length) {
      result.port = parseInt(args[++i], 10);
    } else if (arg === "--no-ui") {
      result.noUi = true;
    } else if (arg === "--mcp") {
      result.mcp = true;
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
  console.log(`Usage: ticketbook [command] [options] [path]

Commands:
  init        Scaffold a new .tickets/ directory
  (default)   Start the server and open the UI

Options:
  --dir <path>   Path to .tickets/ directory (or directory containing it)
  --port <num>   Server port (default: auto-assigned)
  --no-ui        Server only, no static UI serving
  --mcp          Start MCP server mode (stdio transport, no HTTP)
  -h, --help     Show this help message`);
}

/** Walk up from startDir to find a .tickets/ directory (like git finds .git/) */
async function findTicketsDir(startDir: string): Promise<string | null> {
  let dir = resolve(startDir);
  while (true) {
    const candidate = join(dir, ".tickets");
    try {
      const s = await stat(candidate);
      if (s.isDirectory()) return candidate;
    } catch {
      // Not found at this level, keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Resolve a user-provided path to a .tickets/ directory */
async function resolveTicketsDir(givenPath: string): Promise<string> {
  const resolved = resolve(givenPath);

  // If the path itself is a .tickets directory, use it directly
  if (basename(resolved) === ".tickets") {
    try {
      const s = await stat(resolved);
      if (s.isDirectory()) return resolved;
    } catch {
      // Doesn't exist yet — that's OK for init
    }
    return resolved;
  }

  // Check if it contains a .tickets subdirectory
  const withTickets = join(resolved, ".tickets");
  try {
    const s = await stat(withTickets);
    if (s.isDirectory()) return withTickets;
  } catch {
    // No .tickets inside — assume the path IS the tickets dir
  }

  return withTickets;
}

/** Scaffold a new .tickets/ and .plans/ directory */
async function initTicketbook(baseDir: string): Promise<string> {
  const ticketsDir = join(baseDir, ".tickets");
  const ticketsArchiveDir = join(ticketsDir, ".archive");
  const plansDir = join(baseDir, ".plans");
  const plansArchiveDir = join(plansDir, ".archive");

  await mkdir(ticketsArchiveDir, { recursive: true });
  await mkdir(plansArchiveDir, { recursive: true });

  // Create .config.yaml with defaults (skip if exists)
  const configPath = join(ticketsDir, ".config.yaml");
  try {
    await stat(configPath);
  } catch {
    await writeFile(configPath, "prefix: TKT\nplanPrefix: PLAN\ndeleteMode: archive\n", "utf-8");
  }

  // Create .counter files initialized to 0
  for (const dir of [ticketsDir, plansDir]) {
    const counterPath = join(dir, ".counter");
    try {
      await stat(counterPath);
    } catch {
      await writeFile(counterPath, "0", "utf-8");
    }
  }

  // Add archive dirs to .gitignore
  const gitignorePath = join(baseDir, ".gitignore");
  const archivePatterns = [".tickets/.archive/", ".plans/.archive/"];
  try {
    let existing = await readFile(gitignorePath, "utf-8");
    for (const pattern of archivePatterns) {
      if (!existing.includes(pattern)) {
        const sep = existing.endsWith("\n") ? "" : "\n";
        existing += `${sep}${pattern}\n`;
      }
    }
    await writeFile(gitignorePath, existing, "utf-8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      await writeFile(gitignorePath, archivePatterns.join("\n") + "\n", "utf-8");
    } else {
      throw err;
    }
  }

  return ticketsDir;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // --- Init command ---
  if (args.command === "init") {
    const baseDir = args.dir ? resolve(args.dir) : process.cwd();
    const ticketsDir = await initTicketbook(baseDir);
    console.log(`Initialized ticketbook at ${ticketsDir}`);
    return;
  }

  // --- Resolve .tickets/ directory ---
  let ticketsDir: string | null = null;

  if (args.dir) {
    ticketsDir = await resolveTicketsDir(args.dir);
  } else {
    ticketsDir = await findTicketsDir(process.cwd());
  }

  if (!ticketsDir) {
    console.log("No .tickets/ directory found.");
    const answer = prompt("Would you like to initialize one here? (y/N) ");
    if (answer?.toLowerCase() === "y") {
      ticketsDir = await initTicketbook(process.cwd());
      console.log(`Initialized ticketbook at ${ticketsDir}`);
    } else {
      console.log("Run 'ticketbook init' to create a .tickets/ directory.");
      process.exit(1);
    }
  }

  // --- MCP mode ---
  if (args.mcp) {
    const { startMcpServer } = await import("../packages/server/src/mcp.ts");
    const mcpPlansDir = join(dirname(ticketsDir), ".plans");
    console.error(`Ticketbook MCP server (stdio) — tickets: ${ticketsDir}, plans: ${mcpPlansDir}`);
    await startMcpServer(ticketsDir, mcpPlansDir);
    return;
  }

  // --- HTTP server mode ---
  const { startServer } = await import("../packages/server/src/index.ts");

  const uiDistDir = args.noUi
    ? undefined
    : resolve(join(import.meta.dir, "../packages/ui/dist"));

  // Derive plans dir from tickets dir (sibling .plans/ directory)
  const plansDir = join(dirname(ticketsDir), ".plans");

  // Absolute path to this script — passed through so the copilot manager can
  // wire up an MCP config that re-invokes us in --mcp mode for tool access.
  const binPath = fileURLToPath(import.meta.url);

  const handle = startServer({
    ticketsDir,
    plansDir,
    port: args.port ?? 0,
    staticDir: uiDistDir,
    binPath,
  });

  console.log(`Ticketbook server listening on http://localhost:${handle.port}`);
  console.log(`Tickets directory: ${ticketsDir}`);
  console.log(`Plans directory: ${plansDir}`);
  if (!args.noUi && uiDistDir) {
    console.log(`UI: http://localhost:${handle.port}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
