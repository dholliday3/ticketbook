#!/usr/bin/env bun
/**
 * term-debug — interactive debug tool for the terminal WebSocket protocol.
 *
 * Subcommands:
 *   list               List current sessions on the running server
 *   connect <id>       Open an interactive PTY session through the protocol
 *   inspect <id>       Passively log every protocol frame (no init)
 *
 * Environment:
 *   RELAY_PORT    Server port (default 4242)
 *
 * Notes:
 *   `connect` uses Ctrl-] (telnet convention) as the disconnect key, so
 *   Ctrl-C is forwarded to the remote shell as expected.
 *
 *   `connect` will hijack the output stream from any browser tab currently
 *   attached to the same session — the server overwrites session.onData on
 *   every init. Document and live with it.
 */

const port = parseInt(process.env.RELAY_PORT ?? "4242", 10);
const base = `http://localhost:${port}`;
const wsBase = `ws://localhost:${port}`;

const args = process.argv.slice(2);
const sub = args[0];

function printUsage(): void {
  console.error(`Usage: bun scripts/term-debug.ts <command>

Commands:
  list               List sessions on the running server
  connect <id>       Interactive shell through a session (Ctrl-] to disconnect)
  inspect <id>       Log every WebSocket frame for a session (no init)

Env:
  RELAY_PORT    Server port (default 4242)
`);
}

async function listSessions(): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${base}/api/terminal/sessions`);
  } catch (err) {
    console.error(`Failed to reach ${base}: ${(err as Error).message}`);
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`HTTP ${res.status}`);
    process.exit(1);
  }
  const { sessions } = await res.json() as { sessions: Array<{ id: string; title: string; tabNumber: number; alive: boolean }> };
  if (sessions.length === 0) {
    console.log("(no sessions)");
    return;
  }
  const rows = sessions.map((s) => [s.id, s.title, String(s.tabNumber), s.alive ? "alive" : "dead"]);
  const headers = ["ID", "Title", "Tab", "State"];
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmt = (r: string[]) => r.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(fmt(headers));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) console.log(fmt(r));
}

async function connectSession(id: string): Promise<void> {
  if (!id) {
    console.error("usage: term-debug connect <sessionId>");
    process.exit(1);
  }
  const cols = process.stdout.columns ?? 80;
  const rows = process.stdout.rows ?? 24;

  const ws = new WebSocket(`${wsBase}/api/terminal/${encodeURIComponent(id)}`);

  const restoreTty = (): void => {
    try { process.stdin.setRawMode?.(false); } catch { /* ignore */ }
    try { process.stdin.pause(); } catch { /* ignore */ }
  };
  process.on("exit", restoreTty);

  ws.addEventListener("open", () => {
    process.stderr.write(`[connected to ${id} — press Ctrl-] to disconnect]\n`);
    ws.send(JSON.stringify({ type: "init", cols, rows }));
  });

  ws.addEventListener("message", (ev) => {
    const raw = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer);
    try {
      const msg = JSON.parse(raw);
      if (msg.type === "output" || msg.type === "replay") {
        process.stdout.write(msg.data);
      }
      // ready/other: silent
    } catch {
      // non-JSON frame — ignore
    }
  });

  ws.addEventListener("close", (ev) => {
    restoreTty();
    process.stderr.write(`\n[disconnected code=${ev.code}]\n`);
    process.exit(0);
  });

  ws.addEventListener("error", () => {
    restoreTty();
    process.stderr.write("\n[connection error]\n");
    process.exit(1);
  });

  try { process.stdin.setRawMode?.(true); } catch { /* ignore */ }
  process.stdin.resume();

  process.stdin.on("data", (chunk: Buffer) => {
    // Ctrl-] disconnect
    if (chunk.length === 1 && chunk[0] === 0x1d) {
      restoreTty();
      try { ws.close(1000, "user disconnect"); } catch { /* ignore */ }
      process.exit(0);
      return;
    }
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", data: chunk.toString("utf8") }));
    }
  });

  process.stdout.on("resize", () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "resize",
        cols: process.stdout.columns ?? cols,
        rows: process.stdout.rows ?? rows,
      }));
    }
  });
}

async function inspectSession(id: string): Promise<void> {
  if (!id) {
    console.error("usage: term-debug inspect <sessionId>");
    process.exit(1);
  }
  const ws = new WebSocket(`${wsBase}/api/terminal/${encodeURIComponent(id)}`);
  ws.addEventListener("open", () => {
    process.stderr.write(`[inspect: connected to ${id}, not sending init]\n`);
    process.stderr.write(`[note: server only forwards PTY output to the most recent init handshake — use this for frame inspection only]\n`);
  });
  ws.addEventListener("message", (ev) => {
    const raw = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer);
    const ts = new Date().toISOString().slice(11, 23);
    process.stdout.write(`[${ts}] ${raw}\n`);
  });
  ws.addEventListener("close", (ev) => {
    process.stderr.write(`[inspect: closed code=${ev.code} reason=${JSON.stringify(ev.reason)}]\n`);
    process.exit(0);
  });
  process.on("SIGINT", () => {
    try { ws.close(1000, "user"); } catch { /* ignore */ }
    process.exit(0);
  });
}

switch (sub) {
  case "list":
    await listSessions();
    process.exit(0);
    break;
  case "connect":
    await connectSession(args[1]);
    break;
  case "inspect":
    await inspectSession(args[1]);
    break;
  case undefined:
    printUsage();
    process.exit(0);
    break;
  default:
    console.error(`unknown command: ${sub}`);
    printUsage();
    process.exit(1);
}
