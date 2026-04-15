/**
 * SQLite database for persistent app state.
 * Uses bun:sqlite (built-in, zero-dependency).
 *
 * Single schema definition — modify the SCHEMA below and call resetDb() to rebuild.
 * PRAGMA user_version tracks the schema version; bump SCHEMA_VERSION to auto-reset.
 */

import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import type { CopilotMessagePart, CopilotProviderId } from "./copilot/types.js";

const SCHEMA_VERSION = 3;

const SCHEMA = `
  CREATE TABLE terminal_tabs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    tab_number INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Provider-neutral copilot conversations. "id" is the app-level stable
  -- conversation key used by the API/UI. "provider_conversation_id" is the
  -- provider-native thread/resume token (Claude conversation_id, Codex
  -- thread_id, etc.).
  CREATE TABLE copilot_conversations (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    provider_conversation_id TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    message_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX idx_copilot_conversations_provider_external
    ON copilot_conversations(provider_id, provider_conversation_id);
  CREATE INDEX idx_copilot_conversations_updated
    ON copilot_conversations(updated_at DESC);

  -- Normalized transcript history stored by the app so conversation replay
  -- works consistently across providers instead of depending on provider-
  -- specific local stores on disk.
  CREATE TABLE copilot_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    parts_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    sort_order INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES copilot_conversations(id) ON DELETE CASCADE
  );
  CREATE INDEX idx_copilot_messages_conversation_sort
    ON copilot_messages(conversation_id, sort_order ASC);
`;

let db: Database | null = null;

export function getDb(dataDir: string): Database {
  if (db) return db;

  const dbPath = resolve(dataDir, "relay.db");
  db = new Database(dbPath, { create: true });

  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");

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
  provider_id: CopilotProviderId;
  provider_conversation_id: string;
  title: string;
  created_at: number;
  updated_at: number;
  message_count: number;
}

export interface CopilotStoredMessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  parts: CopilotMessagePart[];
  created_at: number;
  sort_order: number;
}

function makeConversationId(providerId: CopilotProviderId, providerConversationId: string): string {
  return `${providerId}:${providerConversationId}`;
}

export function listCopilotConversations(
  dataDir: string,
  providerId?: CopilotProviderId,
): CopilotConversationRow[] {
  const d = getDb(dataDir);
  const sql = providerId
    ? "SELECT id, provider_id, provider_conversation_id, title, created_at, updated_at, message_count FROM copilot_conversations WHERE provider_id = ? ORDER BY updated_at DESC, rowid DESC"
    : "SELECT id, provider_id, provider_conversation_id, title, created_at, updated_at, message_count FROM copilot_conversations ORDER BY updated_at DESC, rowid DESC";
  return (providerId ? d.query(sql).all(providerId) : d.query(sql).all()) as CopilotConversationRow[];
}

export function getCopilotConversation(
  dataDir: string,
  id: string,
): CopilotConversationRow | null {
  const d = getDb(dataDir);
  return (
    (d
      .query(
        "SELECT id, provider_id, provider_conversation_id, title, created_at, updated_at, message_count FROM copilot_conversations WHERE id = ?",
      )
      .get(id) as CopilotConversationRow | null) ?? null
  );
}

export function getCopilotConversationByProviderConversationId(
  dataDir: string,
  providerId: CopilotProviderId,
  providerConversationId: string,
): CopilotConversationRow | null {
  const d = getDb(dataDir);
  return (
    (d
      .query(
        "SELECT id, provider_id, provider_conversation_id, title, created_at, updated_at, message_count FROM copilot_conversations WHERE provider_id = ? AND provider_conversation_id = ?",
      )
      .get(providerId, providerConversationId) as CopilotConversationRow | null) ?? null
  );
}

/**
 * Insert a new conversation row. Caller is responsible for ensuring the id
 * doesn't already exist (use INSERT OR IGNORE semantics if uncertain).
 */
export function recordCopilotConversation(
  dataDir: string,
  row: {
    providerId: CopilotProviderId;
    providerConversationId: string;
    title: string;
  },
): CopilotConversationRow {
  const d = getDb(dataDir);
  const now = Date.now();
  const id = makeConversationId(row.providerId, row.providerConversationId);
  d.run(
    "INSERT OR IGNORE INTO copilot_conversations (id, provider_id, provider_conversation_id, title, created_at, updated_at, message_count) VALUES (?, ?, ?, ?, ?, ?, 0)",
    [id, row.providerId, row.providerConversationId, row.title, now, now],
  );
  return (
    getCopilotConversationByProviderConversationId(
      dataDir,
      row.providerId,
      row.providerConversationId,
    ) ?? {
      id,
      provider_id: row.providerId,
      provider_conversation_id: row.providerConversationId,
      title: row.title,
      created_at: now,
      updated_at: now,
      message_count: 0,
    }
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

export function listCopilotMessages(
  dataDir: string,
  conversationId: string,
): CopilotStoredMessageRow[] {
  const d = getDb(dataDir);
  const rows = d
    .query(
      "SELECT id, conversation_id, role, parts_json, created_at, sort_order FROM copilot_messages WHERE conversation_id = ? ORDER BY sort_order ASC",
    )
    .all(conversationId) as Array<{
      id: string;
      conversation_id: string;
      role: "user" | "assistant";
      parts_json: string;
      created_at: number;
      sort_order: number;
    }>;
  return rows.map((row) => ({
    id: row.id,
    conversation_id: row.conversation_id,
    role: row.role,
    parts: JSON.parse(row.parts_json) as CopilotMessagePart[],
    created_at: row.created_at,
    sort_order: row.sort_order,
  }));
}

export function appendCopilotMessage(
  dataDir: string,
  row: {
    id: string;
    conversationId: string;
    role: "user" | "assistant";
    parts: CopilotMessagePart[];
    createdAt: number;
  },
): void {
  const d = getDb(dataDir);
  const nextOrderRow = d
    .query("SELECT COALESCE(MAX(sort_order), -1) AS max_sort_order FROM copilot_messages WHERE conversation_id = ?")
    .get(row.conversationId) as { max_sort_order: number };
  d.run(
    "INSERT INTO copilot_messages (id, conversation_id, role, parts_json, created_at, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
    [
      row.id,
      row.conversationId,
      row.role,
      JSON.stringify(row.parts),
      row.createdAt,
      nextOrderRow.max_sort_order + 1,
    ],
  );
}
