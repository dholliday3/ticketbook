#!/usr/bin/env bun
/**
 * Validation: prove that a compiled `relay` binary responds to an MCP
 * handshake when invoked as `<binary> --mcp --dir <relayDir>`.
 *
 * Why this matters: the copilot fix (see packages/server/src/copilot/mcp-config.ts)
 * emits exactly that spawn pattern in compiled-binary mode. If this script
 * succeeds, the fix works end-to-end. If it fails, the compiled binary
 * doesn't support re-invocation as its own MCP child.
 *
 * Usage: BINARY=<path> RELAY_DIR=<path> bun scripts/validate-mcp-handshake.ts
 */
import { spawn } from "node:child_process";

const BINARY = process.env.BINARY;
const DIR = process.env.RELAY_DIR;
if (!BINARY || !DIR) {
  console.error("Set BINARY and RELAY_DIR env vars");
  process.exit(2);
}

const proc = spawn(BINARY, ["--mcp", "--dir", DIR], {
  stdio: ["pipe", "pipe", "pipe"],
});

let buf = "";
const responses: Record<string, unknown>[] = [];
proc.stdout.on("data", (chunk: Buffer) => {
  buf += chunk.toString();
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      responses.push(JSON.parse(line));
    } catch {
      console.error(`[stdout non-JSON] ${line}`);
    }
  }
});
proc.stderr.on("data", (c: Buffer) => {
  process.stderr.write(`[mcp stderr] ${c.toString()}`);
});

function send(msg: Record<string, unknown>): void {
  proc.stdin.write(JSON.stringify(msg) + "\n");
}

// MCP initialize handshake
send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "validate-mcp-handshake", version: "0.0.0" },
  },
});

await new Promise((r) => setTimeout(r, 400));

send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

await new Promise((r) => setTimeout(r, 800));

proc.kill("SIGTERM");

const initResp = responses.find((r) => r.id === 1) as
  | { result?: { serverInfo?: { name?: string } } }
  | undefined;
const toolsResp = responses.find((r) => r.id === 2) as
  | { result?: { tools?: { name: string }[] } }
  | undefined;

if (!initResp?.result) {
  console.error("FAIL: no initialize response");
  console.error("responses:", JSON.stringify(responses, null, 2));
  process.exit(1);
}
if (!toolsResp?.result?.tools?.length) {
  console.error("FAIL: tools/list empty or missing");
  console.error("responses:", JSON.stringify(responses, null, 2));
  process.exit(1);
}

const serverName = initResp.result.serverInfo?.name;
const toolNames = toolsResp.result.tools.map((t) => t.name).sort();

console.log(`PASS: serverInfo.name = ${serverName}`);
console.log(`PASS: tools/list returned ${toolNames.length} tools`);
console.log(`      first few: ${toolNames.slice(0, 5).join(", ")}`);
