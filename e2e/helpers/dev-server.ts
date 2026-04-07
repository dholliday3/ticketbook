#!/usr/bin/env bun
/**
 * E2E dev-server launcher.
 *
 * Creates a tmp directory with empty .tickets/.plans subdirs, then spawns
 * `bun bin/ticketbook.ts --dir <tmp> --port <E2E_PORT>` with the UI's built
 * static assets served from `packages/ui/dist`. Cleans up the tmp dir on exit.
 *
 * Playwright's `webServer` config runs this as its command and waits for the
 * URL to return 200 before starting tests.
 *
 * The UI MUST be built before invoking this — `pretest:e2e` handles that.
 */

import { mkdtemp, mkdir, writeFile, rm, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..", "..");

async function assertUiBuilt(): Promise<void> {
  const indexPath = join(REPO_ROOT, "packages", "ui", "dist", "index.html");
  try {
    const s = await stat(indexPath);
    if (!s.isFile()) throw new Error("not a file");
  } catch {
    console.error(`[e2e] UI is not built. Missing ${indexPath}.`);
    console.error(`[e2e] Run: bun --filter "@ticketbook/ui" build`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  await assertUiBuilt();

  const tmpRoot = await mkdtemp(join(tmpdir(), "ticketbook-e2e-"));
  const ticketsDir = join(tmpRoot, ".tickets");
  const plansDir = join(tmpRoot, ".plans");
  await mkdir(join(ticketsDir, ".archive"), { recursive: true });
  await mkdir(join(plansDir, ".archive"), { recursive: true });
  await writeFile(join(ticketsDir, ".counter"), "0", "utf-8");
  await writeFile(join(plansDir, ".counter"), "0", "utf-8");
  await writeFile(
    join(ticketsDir, ".config.yaml"),
    "prefix: TKT\nplanPrefix: PLAN\ndeleteMode: archive\n",
    "utf-8",
  );

  const port = process.env.E2E_PORT ?? "4343";
  // eslint-disable-next-line no-console
  console.log(`[e2e] tmp=${tmpRoot} port=${port}`);

  const child: ChildProcess = spawn(
    "bun",
    ["bin/ticketbook.ts", "--dir", ticketsDir, "--port", port],
    {
      stdio: "inherit",
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        NODE_ENV: "production",
        // E2E tests use a scripted stub provider so they don't need
        // Claude Code installed and don't burn LLM tokens.
        COPILOT_PROVIDER: "stub",
      },
    },
  );

  let cleaningUp = false;
  const cleanup = async (code = 0): Promise<void> => {
    if (cleaningUp) return;
    cleaningUp = true;
    try { child.kill("SIGTERM"); } catch { /* already dead */ }
    try { await rm(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    process.exit(code);
  };

  process.on("SIGINT", () => void cleanup(0));
  process.on("SIGTERM", () => void cleanup(0));
  child.on("exit", (code) => void cleanup(code ?? 0));
}

void main();
