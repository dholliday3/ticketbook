/**
 * Integration tests for the terminal WebSocket protocol.
 *
 * Boots a real server on a random port with a fresh tmp data dir,
 * connects real WebSocket clients, and drives the handshake end-to-end.
 * Uses unique ASCII markers (e.g. "HELLO_MARK") in every assertion —
 * never greps for shell prompts (too shell-dependent to be stable).
 *
 * Forces SHELL=/bin/sh before any test so we get a fast, POSIX shell
 * that doesn't source rc files. The user's default (often zsh -l) is too
 * slow and non-deterministic for assertions.
 */

// Force a fast, predictable shell for every spawn in this file.
// terminal.ts reads process.env.SHELL at each spawn, so this sticks.
process.env.SHELL = "/bin/sh";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer, type ServerHandle } from "./index.js";
import { _resetDbCacheForTests } from "./db.js";
import type { ClientMessage, ServerMessage } from "@relay/core";

interface TestClient {
  ws: WebSocket;
  outputs: string[];
  ready: Promise<void>;
  closed: Promise<{ code: number; reason: string }>;
  send: (msg: ClientMessage) => void;
  close: () => void;
  waitFor: (re: RegExp, timeoutMs?: number) => Promise<string>;
}

/**
 * Wait for the shell to be ready to execute commands. Sends a unique marker
 * via `echo` and waits for it to come back in the output. This guards against
 * races where the shell is still starting up and queues but hasn't processed
 * input yet.
 *
 * The marker appears twice in the buffer — once as the echo of the typed
 * input, once as the output of the echo command. We match anywhere, since
 * any sighting means the shell has at least read our input.
 */
async function warmUp(client: TestClient): Promise<void> {
  const marker = `READY_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  client.send({ type: "input", data: `echo ${marker}\n` });
  // Wait for the marker to appear *twice*: once in echoed input, once as command output.
  // Matching the second occurrence proves the command actually executed.
  await client.waitFor(new RegExp(`${marker}[\\s\\S]*${marker}`), 5000);
}

function connect(base: string, sessionId: string, cols = 80, rows = 24): TestClient {
  const url = `${base.replace("http", "ws")}/api/terminal/${encodeURIComponent(sessionId)}`;
  const ws = new WebSocket(url);
  const outputs: string[] = [];

  let resolveReady!: () => void;
  const ready = new Promise<void>((r) => (resolveReady = r));

  let resolveClosed!: (v: { code: number; reason: string }) => void;
  const closed = new Promise<{ code: number; reason: string }>((r) => (resolveClosed = r));

  ws.onmessage = (ev) => {
    const raw = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer);
    const msg = JSON.parse(raw) as ServerMessage;
    if (msg.type === "ready") {
      resolveReady();
    } else if (msg.type === "output" || msg.type === "replay") {
      outputs.push(msg.data);
    }
  };

  ws.onopen = () => ws.send(JSON.stringify({ type: "init", cols, rows }));
  ws.onclose = (ev) => resolveClosed({ code: ev.code, reason: ev.reason });

  return {
    ws,
    outputs,
    ready,
    closed,
    send: (msg) => ws.send(JSON.stringify(msg)),
    close: () => { try { ws.close(1000, "test done"); } catch { /* already closed */ } },
    waitFor: (re, timeoutMs = 3000) =>
      new Promise<string>((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
          const joined = outputs.join("");
          if (re.test(joined)) return resolve(joined);
          if (Date.now() - start > timeoutMs) {
            return reject(new Error(`timeout waiting for ${re}; last 200 chars: ${JSON.stringify(joined.slice(-200))}`));
          }
          setTimeout(tick, 10);
        };
        tick();
      }),
  };
}

describe("terminal protocol", () => {
  let dir: string;
  let relayDir: string;
  let tasksDir: string;
  let plansDir: string;
  let docsDir: string;
  let handle: ServerHandle;
  let base: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "relay-term-"));
    relayDir = join(dir, ".relay");
    tasksDir = join(relayDir, "tasks");
    plansDir = join(relayDir, "plans");
    docsDir = join(relayDir, "docs");
    await mkdir(join(tasksDir, ".archive"), { recursive: true });
    await mkdir(plansDir, { recursive: true });
    await mkdir(docsDir, { recursive: true });
    await writeFile(join(tasksDir, ".counter"), "0", "utf-8");
    await writeFile(join(relayDir, "config.yaml"), "prefix: TKT\ndeleteMode: archive\n", "utf-8");
    handle = startServer({ relayDir, tasksDir, plansDir, docsDir, port: 0 });
    base = `http://localhost:${handle.port}`;
  });

  afterEach(async () => {
    // handle.close() now calls terminalBackend.destroyAll() internally,
    // so orphan PTYs are cleaned up without a separate call
    handle.close();
    _resetDbCacheForTests();
    await rm(dir, { recursive: true, force: true });
  });

  test("POST returns server-assigned id, title, and incrementing tabNumber", async () => {
    const r1 = await fetch(`${base}/api/terminal/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sortOrder: 0 }),
    });
    expect(r1.status).toBe(200);
    const t1 = await r1.json();
    expect(t1.id).toMatch(/^term-/);
    expect(t1.title).toBe("Terminal 1");
    expect(t1.tabNumber).toBe(1);

    const r2 = await fetch(`${base}/api/terminal/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sortOrder: 1 }),
    });
    const t2 = await r2.json();
    expect(t2.title).toBe("Terminal 2");
    expect(t2.tabNumber).toBe(2);
  });

  test("init handshake spawns PTY at client dimensions (stty size)", async () => {
    const { id } = await (await fetch(`${base}/api/terminal/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })).json();

    const client = connect(base, id, 120, 40);
    await client.ready;
    await warmUp(client);
    client.send({ type: "input", data: "stty size\n" });
    // stty size prints "rows cols" — expect "40 120" on its own line
    await client.waitFor(/40 120/);
    client.close();
    await client.closed;
  });

  test("input produces corresponding output (echo round trip)", async () => {
    const { id } = await (await fetch(`${base}/api/terminal/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })).json();

    const client = connect(base, id);
    await client.ready;
    await warmUp(client);
    client.send({ type: "input", data: "echo HELLO_MARK\n" });
    await client.waitFor(/HELLO_MARK/);
    client.close();
    await client.closed;
  });

  test("resize message updates PTY dimensions", async () => {
    const { id } = await (await fetch(`${base}/api/terminal/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })).json();

    const client = connect(base, id, 80, 24);
    await client.ready;
    await warmUp(client);
    client.send({ type: "resize", cols: 100, rows: 30 });
    // Give SIGWINCH a beat to propagate
    await new Promise((r) => setTimeout(r, 50));
    client.send({ type: "input", data: "stty size\n" });
    await client.waitFor(/30 100/);
    client.close();
    await client.closed;
  });

  test("reattach preserves shell state (env var survives disconnect/reconnect)", async () => {
    const { id } = await (await fetch(`${base}/api/terminal/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })).json();

    const c1 = connect(base, id);
    await c1.ready;
    await warmUp(c1);
    c1.send({ type: "input", data: "export TEST_VAR=alive123; echo SET_OK\n" });
    await c1.waitFor(/SET_OK/);
    c1.close();
    await c1.closed;

    // Small delay so close handler runs
    await new Promise((r) => setTimeout(r, 50));

    const c2 = connect(base, id);
    await c2.ready;
    await warmUp(c2);
    c2.send({ type: "input", data: 'echo "v=$TEST_VAR"; echo GET_OK\n' });
    // Match across any whitespace/escapes between marker and value
    await c2.waitFor(/v=alive123[\s\S]*GET_OK/);
    c2.close();
    await c2.closed;
  });

  test("reattach replays previous scrollback (output persists across disconnect)", async () => {
    const { id } = await (await fetch(`${base}/api/terminal/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })).json();

    const c1 = connect(base, id);
    await c1.ready;
    await warmUp(c1);
    // Print a unique marker BEFORE disconnecting
    c1.send({ type: "input", data: "echo BEFORE_DISCONNECT_MARK_92341\n" });
    await c1.waitFor(/BEFORE_DISCONNECT_MARK_92341/);
    c1.close();
    await c1.closed;

    await new Promise((r) => setTimeout(r, 50));

    // Reconnect — the replay message should contain the marker from the
    // previous session (served from the server-side headless xterm buffer)
    const c2 = connect(base, id);
    await c2.ready;
    // We expect the marker to arrive as part of the replay, without
    // typing any new input. 2s is generous because replay is one message.
    await c2.waitFor(/BEFORE_DISCONNECT_MARK_92341/, 2000);
    c2.close();
    await c2.closed;
  });

  test("reattach at different dimensions replays correctly", async () => {
    const { id } = await (await fetch(`${base}/api/terminal/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })).json();

    const c1 = connect(base, id, 80, 24);
    await c1.ready;
    await warmUp(c1);
    c1.send({ type: "input", data: "echo DIMENSION_MARK_55731\n" });
    await c1.waitFor(/DIMENSION_MARK_55731/);
    c1.close();
    await c1.closed;

    await new Promise((r) => setTimeout(r, 50));

    // Reconnect at very different dimensions — SerializeAddon serializes
    // logical lines (not visual wrapping), so the marker should still
    // appear intact after the resize-then-serialize path.
    const c2 = connect(base, id, 120, 40);
    await c2.ready;
    await c2.waitFor(/DIMENSION_MARK_55731/, 2000);
    c2.close();
    await c2.closed;
  });

  test("closing the WebSocket keeps the session alive during grace period", async () => {
    const { id } = await (await fetch(`${base}/api/terminal/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })).json();

    const client = connect(base, id);
    await client.ready;
    client.close();
    await client.closed;
    // Brief wait for the close handler to register
    await new Promise((r) => setTimeout(r, 100));

    const res = await fetch(`${base}/api/terminal/sessions`);
    const { sessions } = await res.json();
    const found = sessions.find((s: { id: string }) => s.id === id);
    expect(found).toBeDefined();
    expect(found.alive).toBe(true);
  });

  test("DELETE destroys session and closes WebSocket with code 1000", async () => {
    const { id } = await (await fetch(`${base}/api/terminal/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })).json();

    const client = connect(base, id);
    await client.ready;

    const delRes = await fetch(`${base}/api/terminal/sessions`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    expect(delRes.status).toBe(200);

    const closeInfo = await client.closed;
    expect(closeInfo.code).toBe(1000);

    const listRes = await fetch(`${base}/api/terminal/sessions`);
    const { sessions } = await listRes.json();
    expect(sessions.find((s: { id: string }) => s.id === id)).toBeUndefined();
  });

  test("multiple concurrent sessions don't cross-contaminate output", async () => {
    const { id: id1 } = await (await fetch(`${base}/api/terminal/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })).json();
    const { id: id2 } = await (await fetch(`${base}/api/terminal/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })).json();

    const c1 = connect(base, id1);
    const c2 = connect(base, id2);
    await c1.ready;
    await c2.ready;
    await warmUp(c1);
    await warmUp(c2);

    c1.send({ type: "input", data: "echo SESSION_ALPHA\n" });
    c2.send({ type: "input", data: "echo SESSION_BETA\n" });

    await c1.waitFor(/SESSION_ALPHA/);
    await c2.waitFor(/SESSION_BETA/);

    expect(c1.outputs.join("")).not.toContain("SESSION_BETA");
    expect(c2.outputs.join("")).not.toContain("SESSION_ALPHA");

    c1.close();
    c2.close();
    await c1.closed;
    await c2.closed;
  });

  test("scrollback limit drops oldest lines when exceeded", async () => {
    // Write a tmp config with scrollback=50, then create a new handle.
    // This test uses its own startServer call because it needs the config
    // file in place BEFORE the server reads it at session creation time.
    handle.close();
    _resetDbCacheForTests();

    await writeFile(
      join(relayDir, "config.yaml"),
      "prefix: TKT\ndeleteMode: archive\nterminalScrollback: 50\n",
      "utf-8",
    );
    handle = startServer({ relayDir, tasksDir, plansDir, docsDir, port: 0 });
    base = `http://localhost:${handle.port}`;

    const { id } = await (await fetch(`${base}/api/terminal/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })).json();

    const c1 = connect(base, id);
    await c1.ready;
    await warmUp(c1);

    // Emit 200 uniquely-numbered lines — far more than the 50-line scrollback
    c1.send({
      type: "input",
      data: "for i in $(seq 1 200); do echo LINE_$i; done\n",
    });
    // Wait for the last line to ensure the shell has finished producing output
    await c1.waitFor(/LINE_200/, 5000);
    c1.close();
    await c1.closed;
    await new Promise((r) => setTimeout(r, 50));

    // Reconnect — replay should contain the last ~50 lines but NOT LINE_1
    const c2 = connect(base, id);
    await c2.ready;
    await c2.waitFor(/LINE_200/, 2000);
    const replay = c2.outputs.join("");
    // LINE_200 must be present (most recent)
    expect(replay).toMatch(/LINE_200/);
    // LINE_1 (and anything in the first ~100 lines) must be gone
    expect(replay).not.toMatch(/\bLINE_1\b/);
    expect(replay).not.toMatch(/\bLINE_50\b/);
    c2.close();
    await c2.closed;
  });
});
