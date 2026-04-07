/**
 * SQLite database for persistent app state.
 * Uses bun:sqlite (built-in, zero-dependency).
 *
 * Single schema definition — modify the SCHEMA below and call resetDb() to rebuild.
 * PRAGMA user_version tracks the schema version; bump SCHEMA_VERSION to auto-reset.
 */

import { Database } from "bun:sqlite";
import { resolve } from "node:path";

const SCHEMA_VERSION = 2;

const SCHEMA = `
  CREATE TABLE terminal_tabs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    tab_number INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Copilot conversation metadata. Stores Claude Code's conversation_id
  -- (the same ID used for --resume), an auto-generated title (first user
  -- message truncated), timestamps, and message count. The actual chat
  -- content is NOT stored here — Claude Code persists every conversation
  -- as JSONL at ~/.claude/projects/<encoded-cwd>/<id>.jsonl, and we just
  -- replay the agent's context via --resume on the next turn. This table
  -- exists so the UI can list and switch between prior conversations
  -- across page refreshes.
  CREATE TABLE copilot_conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_copilot_conversations_updated
    ON copilot_conversations(updated_at DESC);
`;

let db: Database | null = null;

export function getDb(dataDir: string): Database {
  if (db) return db;

  const dbPath = resolve(dataDir, "ticketbook.db");
  db = new Database(dbPath, { create: true });

  db.run("PRAGMA journal_mode = WAL");

  const current = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (current !== SCHEMA_VERSION) {
    dropAll(db);
    db.run(SCHEMA);
    db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }

  return db;
}

/** Drop all tables and reset. */
export function resetDb(dataDir: string): void {
  const d = getDb(dataDir);
  dropAll(d);
  d.run(SCHEMA);
  d.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

/**
 * Test-only: close and null the module-level db handle so the next getDb()
 * call opens a fresh database. Needed because beforeEach in tests creates a
 * new tmp dir each time, but without this reset the cached handle would
 * still point at the previous test's file.
 */
export function _resetDbCacheForTests(): void {
  db?.close();
  db = null;
}

function dropAll(d: Database): void {
  const tables = d.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
  for (const { name } of tables) {
    d.run(`DROP TABLE IF EXISTS "${name}"`);
  }
}

// --- Terminal tab persistence ---

export interface TerminalTabRow {
  id: string;
  title: string;
  sort_order: number;
  tab_number: number;
}

export function listTerminalTabs(dataDir: string): TerminalTabRow[] {
  const d = getDb(dataDir);
  return d.query("SELECT id, title, sort_order, tab_number FROM terminal_tabs ORDER BY sort_order ASC").all() as TerminalTabRow[];
}

export function upsertTerminalTab(dataDir: string, id: string, title: string, sortOrder: number, tabNumber: number): void {
  const d = getDb(dataDir);
  d.run(
    "INSERT INTO terminal_tabs (id, title, sort_order, tab_number) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, sort_order = excluded.sort_order, tab_number = excluded.tab_number",
    [id, title, sortOrder, tabNumber],
  );
}

export function getNextTabNumber(dataDir: string): number {
  const d = getDb(dataDir);
  const row = d.query("SELECT MAX(tab_number) as max_num FROM terminal_tabs").get() as { max_num: number | null } | null;
  return (row?.max_num ?? 0) + 1;
}

export function deleteTerminalTab(dataDir: string, id: string): void {
  const d = getDb(dataDir);
  d.run("DELETE FROM terminal_tabs WHERE id = ?", [id]);
}

export function clearTerminalTabs(dataDir: string): void {
  const d = getDb(dataDir);
  d.run("DELETE FROM terminal_tabs");
}

// --- Copilot conversation persistence ---

export interface CopilotConversationRow {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  message_count: number;
}

export function listCopilotConversations(dataDir: string): CopilotConversationRow[] {
  const d = getDb(dataDir);
  return d
    .query(
      "SELECT id, title, created_at, updated_at, message_count FROM copilot_conversations ORDER BY updated_at DESC",
    )
    .all() as CopilotConversationRow[];
}

export function getCopilotConversation(
  dataDir: string,
  id: string,
): CopilotConversationRow | null {
  const d = getDb(dataDir);
  return (
    (d
      .query(
        "SELECT id, title, created_at, updated_at, message_count FROM copilot_conversations WHERE id = ?",
      )
      .get(id) as CopilotConversationRow | null) ?? null
  );
}

/**
 * Insert a new conversation row. Caller is responsible for ensuring the id
 * doesn't already exist (use INSERT OR IGNORE semantics if uncertain).
 */
export function recordCopilotConversation(
  dataDir: string,
  row: { id: string; title: string },
): void {
  const d = getDb(dataDir);
  const now = Date.now();
  d.run(
    "INSERT OR IGNORE INTO copilot_conversations (id, title, created_at, updated_at, message_count) VALUES (?, ?, ?, ?, 1)",
    [row.id, row.title, now, now],
  );
}

/**
 * Bump updated_at and increment message_count for an existing conversation.
 * No-op if the conversation doesn't exist (we'd rather drop the bump than
 * create a row with no title).
 */
export function bumpCopilotConversation(dataDir: string, id: string): void {
  const d = getDb(dataDir);
  d.run(
    "UPDATE copilot_conversations SET updated_at = ?, message_count = message_count + 1 WHERE id = ?",
    [Date.now(), id],
  );
}

export function deleteCopilotConversation(dataDir: string, id: string): void {
  const d = getDb(dataDir);
  d.run("DELETE FROM copilot_conversations WHERE id = ?", [id]);
}
