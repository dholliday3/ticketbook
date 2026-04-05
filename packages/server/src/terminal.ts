/**
 * Terminal session manager using Bun.Terminal (native PTY).
 *
 * Each session owns a PTY process and a 256 KiB ring buffer for scrollback.
 * Sessions survive WebSocket disconnects for up to 5 minutes (grace period),
 * allowing page refreshes to reconnect and replay scrollback.
 *
 * Session metadata (tab id, title, order) is persisted to SQLite via db.ts
 * so tabs survive full page reloads and even server restarts (PTY is gone
 * but the tab list is restored — a fresh shell is spawned on reconnect).
 */

import { upsertTerminalTab, deleteTerminalTab } from "./db.js";

const SCROLLBACK_SIZE = 256 * 1024; // 256 KiB per session
const GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes

let dataDir = ".";

// --- Ring buffer ---

class RingBuffer {
  private buf: Uint8Array;
  private writePos = 0;
  private length = 0;

  constructor(capacity: number) {
    this.buf = new Uint8Array(capacity);
  }

  append(data: Uint8Array): void {
    if (data.length >= this.buf.length) {
      // Data larger than buffer — keep only the tail
      this.buf.set(data.subarray(data.length - this.buf.length));
      this.writePos = 0;
      this.length = this.buf.length;
      return;
    }

    const spaceAtEnd = this.buf.length - this.writePos;
    if (data.length <= spaceAtEnd) {
      this.buf.set(data, this.writePos);
    } else {
      this.buf.set(data.subarray(0, spaceAtEnd), this.writePos);
      this.buf.set(data.subarray(spaceAtEnd), 0);
    }
    this.writePos = (this.writePos + data.length) % this.buf.length;
    this.length = Math.min(this.length + data.length, this.buf.length);
  }

  read(): Uint8Array {
    if (this.length === 0) return new Uint8Array(0);
    if (this.length < this.buf.length) {
      // Buffer hasn't wrapped yet
      const start = this.writePos - this.length;
      return this.buf.slice(start, this.writePos);
    }
    // Buffer has wrapped — concat tail + head
    const result = new Uint8Array(this.buf.length);
    const tailLen = this.buf.length - this.writePos;
    result.set(this.buf.subarray(this.writePos), 0);
    result.set(this.buf.subarray(0, this.writePos), tailLen);
    return result;
  }

  clear(): void {
    this.writePos = 0;
    this.length = 0;
  }
}

// --- Session types ---

interface PtySession {
  proc: ReturnType<typeof Bun.spawn>;
  alive: boolean;
  scrollback: RingBuffer;
  onData: ((data: string) => void) | null;
  onExit: (() => void) | null;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
}

const sessions = new Map<string, PtySession>();

function getShell(): string {
  return process.env.SHELL || "/bin/zsh";
}

// --- Public API ---

export function setDataDir(dir: string): void {
  dataDir = dir;
}

export function createPtySession(sessionId: string, cwd: string, cols = 80, rows = 24, title?: string): PtySession {
  const existing = sessions.get(sessionId);
  if (existing?.alive) return existing;

  const session: PtySession = {
    proc: null as unknown as ReturnType<typeof Bun.spawn>,
    alive: true,
    scrollback: new RingBuffer(SCROLLBACK_SIZE),
    onData: null,
    onExit: null,
    disconnectTimer: null,
  };

  const shell = getShell();
  const proc = Bun.spawn([shell, "-l"], {
    cwd,
    env: { ...process.env, TERM: "xterm-256color" },
    terminal: {
      cols,
      rows,
      data(_terminal: unknown, data: Uint8Array) {
        const str = new TextDecoder().decode(data);
        session.scrollback.append(data);
        session.onData?.(str);
      },
    },
    onExit() {
      session.alive = false;
      session.onExit?.();
      sessions.delete(sessionId);
    },
  });

  session.proc = proc;
  sessions.set(sessionId, session);

  // Persist tab metadata to SQLite
  upsertTerminalTab(dataDir, sessionId, title ?? `Terminal ${sessions.size}`, sessions.size - 1);

  return session;
}

export function getSession(sessionId: string): PtySession | undefined {
  return sessions.get(sessionId);
}

export function getAliveSessions(): string[] {
  return [...sessions.entries()]
    .filter(([, s]) => s.alive)
    .map(([id]) => id);
}

export function writeToPty(sessionId: string, data: string): void {
  const session = sessions.get(sessionId);
  if (!session?.alive || !session.proc.terminal) return;
  session.proc.terminal.write(data);
}

export function resizePty(sessionId: string, cols: number, rows: number): void {
  const session = sessions.get(sessionId);
  if (!session?.alive || !session.proc.terminal) return;
  session.proc.terminal.resize(cols, rows);
}

/**
 * Called when a WebSocket disconnects. Starts the grace timer.
 * If no reconnection happens within GRACE_PERIOD_MS, the session is destroyed.
 */
export function detachPtySession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session?.alive) return;

  // Clear any existing timer and start a new one
  if (session.disconnectTimer) clearTimeout(session.disconnectTimer);
  session.onData = null;

  session.disconnectTimer = setTimeout(() => {
    destroyPtySession(sessionId);
  }, GRACE_PERIOD_MS);
}

/**
 * Called when a WebSocket reconnects to an existing session.
 * Cancels the grace timer and replays scrollback.
 * Returns the scrollback data to send to the client, or null if session doesn't exist.
 */
export function reattachPtySession(sessionId: string): string | null {
  const session = sessions.get(sessionId);
  if (!session?.alive) return null;

  // Cancel grace timer
  if (session.disconnectTimer) {
    clearTimeout(session.disconnectTimer);
    session.disconnectTimer = null;
  }

  // Build replay: terminal reset + scrollback contents
  const scrollbackBytes = session.scrollback.read();
  if (scrollbackBytes.length === 0) return null;

  const reset = "\x1b[H\x1b[2J\x1b[0m";
  const scrollbackStr = new TextDecoder().decode(scrollbackBytes);
  return reset + scrollbackStr;
}

export function destroyPtySession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  if (session.disconnectTimer) clearTimeout(session.disconnectTimer);
  session.alive = false;
  session.onData = null;
  session.onExit = null;
  session.scrollback.clear();

  try { session.proc.terminal?.close(); } catch { /* already dead */ }
  try { session.proc.kill(); } catch { /* already dead */ }
  sessions.delete(sessionId);
  deleteTerminalTab(dataDir, sessionId);
}

export function destroyAllSessions(): void {
  for (const [id] of sessions) {
    destroyPtySession(id);
  }
}
