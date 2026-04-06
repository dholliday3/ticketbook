/**
 * SQLite database for persistent app state.
 * Uses bun:sqlite (built-in, zero-dependency).
 *
 * Single schema definition — modify the SCHEMA below and call resetDb() to rebuild.
 * PRAGMA user_version tracks the schema version; bump SCHEMA_VERSION to auto-reset.
 */

import { Database } from "bun:sqlite";
import { resolve } from "node:path";

const SCHEMA_VERSION = 1;

const SCHEMA = `
  CREATE TABLE terminal_tabs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    tab_number INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
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
