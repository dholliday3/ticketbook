/**
 * Terminal session manager using Bun.Terminal (native PTY).
 *
 * Each session owns a PTY process and a 256 KiB ring buffer for scrollback.
 * Sessions survive WebSocket disconnects for up to 5 minutes (grace period),
 * allowing page refreshes to reconnect and replay scrollback.
 *
 * PTY creation is deferred until the client sends its actual dimensions via
 * the "init" handshake message — this prevents output at wrong column widths.
 *
 * Session metadata (tab id, title, order) is persisted to SQLite via db.ts
 * so tabs survive full page reloads and even server restarts (PTY is gone
 * but the tab list is restored — a fresh shell is spawned on reconnect).
 */

import { deleteTerminalTab } from "./db.js";

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

  clear(): void {
    this.writePos = 0;
    this.length = 0;
  }
}

// --- Session types ---

interface PtySession {
  proc: ReturnType<typeof Bun.spawn> | null;
  alive: boolean;
  cwd: string;
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

/**
 * Create and spawn a PTY session with known client dimensions.
 * Called when the client sends the "init" handshake message.
 */
export function createPtySession(sessionId: string, cwd: string, cols: number, rows: number): PtySession {
  const existing = sessions.get(sessionId);
  if (existing?.alive) return existing;

  const session: PtySession = {
    proc: null,
    alive: false,
    cwd,
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
  session.alive = true;
  sessions.set(sessionId, session);

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
  if (!session?.alive || !session.proc?.terminal) return;
  session.proc.terminal.write(data);
}

export function resizePty(sessionId: string, cols: number, rows: number): void {
  const session = sessions.get(sessionId);
  if (!session?.alive || !session.proc?.terminal) return;
  session.proc.terminal.resize(cols, rows);
}

/**
 * Called when a WebSocket disconnects. Starts the grace timer.
 * If no reconnection happens within GRACE_PERIOD_MS, the session is destroyed.
 */
export function detachPtySession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session?.alive) return;

  if (session.disconnectTimer) clearTimeout(session.disconnectTimer);
  session.onData = null;

  session.disconnectTimer = setTimeout(() => {
    destroyPtySession(sessionId);
  }, GRACE_PERIOD_MS);
}

/**
 * Cancel the grace timer for a session (called during reattach handshake).
 */
export function cancelGraceTimer(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session?.disconnectTimer) {
    clearTimeout(session.disconnectTimer);
    session.disconnectTimer = null;
  }
}

/**
 * Called when a client reconnects to an existing alive session.
 * Resizes PTY to new client dimensions and clears stale scrollback
 * to avoid rendering artifacts from width mismatches.
 */
export function reattachPtySession(sessionId: string, cols: number, rows: number): void {
  const session = sessions.get(sessionId);
  if (!session?.alive || !session.proc?.terminal) return;

  cancelGraceTimer(sessionId);

  // Resize PTY to new client dimensions
  session.proc.terminal.resize(cols, rows);

  // Clear stale scrollback — it was encoded at the old column width
  // and would render with double lines if replayed at the new width
  session.scrollback.clear();
}

export function destroyPtySession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    if (session.disconnectTimer) clearTimeout(session.disconnectTimer);
    session.alive = false;
    session.onData = null;
    session.onExit = null;
    session.scrollback.clear();

    try { session.proc?.terminal?.close(); } catch { /* already dead */ }
    try { session.proc?.kill(); } catch { /* already dead */ }
    sessions.delete(sessionId);
  }
  // Always remove from DB, even if PTY session wasn't in memory
  deleteTerminalTab(dataDir, sessionId);
}

export function destroyAllSessions(): void {
  for (const [id] of sessions) {
    destroyPtySession(id);
  }
}
