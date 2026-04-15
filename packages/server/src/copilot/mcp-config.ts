import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, unlink, mkdtemp } from "node:fs/promises";

/**
 * Generates a per-session MCP config file pointing at relay's own MCP
 * server, so the spawned `claude` (or future `codex`) gets read/write access
 * to the user's tasks, plans, and docs without us building a parallel tool layer.
 *
 * The shape matches Claude Code's `--mcp-config` expectation:
 *   { "mcpServers": { "<name>": { "command": "...", "args": ["..."] } } }
 *
 * Codex uses the same shape — when we add a CodexProvider, this file is
 * untouched.
 */

export interface BuildRelayMcpConfigInput {
  /** Absolute path to the bin/relay.ts entry script (the one that started the server). */
  binPath: string;
  /** Absolute path to the .relay directory the server is managing. */
  relayDir: string;
  /**
   * Bun executable to invoke the bin script with. Defaults to "bun" so it
   * resolves on PATH.
   */
  bunPath?: string;
  /**
   * When running from a compiled standalone binary, pass `process.execPath`
   * here. The generated config will then invoke the binary directly in
   * `--mcp` mode (`execPath --mcp --dir …`) instead of `bun run <binPath>`.
   *
   * Required in compiled-binary mode because `binPath` resolves to a
   * `$bunfs/…` virtual path that only the parent Bun process can read —
   * a freshly spawned `bun run` child can't open it, so MCP would fail
   * to start with no visible error. When set, `binPath` is ignored.
   */
  execPath?: string;
}

export function buildRelayMcpConfig(
  input: BuildRelayMcpConfigInput,
): Record<string, unknown> {
  if (input.execPath) {
    return {
      mcpServers: {
        relay: {
          command: input.execPath,
          args: ["--mcp", "--dir", input.relayDir],
        },
      },
    };
  }
  const bun = input.bunPath ?? "bun";
  return {
    mcpServers: {
      relay: {
        command: bun,
        args: ["run", input.binPath, "--mcp", "--dir", input.relayDir],
      },
    },
  };
}

/**
 * Writes an MCP config to a private tmp file and returns its path.
 * Caller is responsible for `removeMcpConfigFile` when the session ends.
 *
 * Each session gets its own directory so collisions are impossible and the
 * cleanup step can remove the directory wholesale.
 */
export async function writeMcpConfigFile(
  config: Record<string, unknown>,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "tb-copilot-"));
  const path = join(dir, "mcp.json");
  await writeFile(path, JSON.stringify(config, null, 2), "utf-8");
  return {
    path,
    cleanup: async () => {
      try {
        await unlink(path);
      } catch {
        // already gone
      }
    },
  };
}
