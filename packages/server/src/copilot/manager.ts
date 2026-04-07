import { ClaudeCodeProvider } from "./claude-code.js";
import { buildTicketbookMcpConfig, writeMcpConfigFile } from "./mcp-config.js";
import {
  loadConversationHistory,
  type HistoricalMessage,
} from "./history.js";
import type {
  CopilotMessagePart,
  CopilotProvider,
  CopilotProviderHealth,
  CopilotSessionEvents,
} from "./types.js";
import {
  bumpCopilotConversation,
  deleteCopilotConversation,
  getCopilotConversation,
  listCopilotConversations,
  recordCopilotConversation,
  type CopilotConversationRow,
} from "../db.js";

/**
 * Single-provider session manager. Owns the Claude Code provider, allocates
 * session IDs, generates per-session MCP config files pointing back at
 * ticketbook's own MCP server, and surfaces typed `stream`/`done` events.
 *
 * Conversation persistence: each Claude conversation gets a row in SQLite
 * keyed by Claude's own conversation_id. We capture the id from the first
 * stream event (or pre-populate it when resuming) and on every `done`
 * event INSERT-or-UPDATE the row with the title (first user message,
 * truncated) and bumped updated_at + message_count. The actual chat
 * content lives in Claude Code's local store at
 * ~/.claude/projects/<encoded-cwd>/<id>.jsonl — we don't duplicate it.
 *
 * The provider abstraction is intentionally inlined here rather than spread
 * across an interface + registry. There is one provider today; when Codex
 * lands, we factor out the seam at that point — not before.
 */

export interface CopilotManagerConfig {
  /**
   * Absolute path to the .tickets directory the surrounding server is
   * managing. Used to wire up ticketbook's own MCP server so the spawned
   * `claude` can read and create tickets, AND as the SQLite db location
   * for conversation metadata.
   */
  ticketsDir: string;
  /**
   * Absolute path to the bin/ticketbook.ts entry script. If omitted, the
   * copilot still works but won't auto-wire ticketbook's MCP — useful for
   * tests where we don't want to spawn the real CLI.
   */
  binPath?: string;
  /** Optional working dir for spawned CLIs. Defaults to the project root (parent of ticketsDir). */
  cwd?: string;
  /**
   * Optional provider override. Defaults to a new ClaudeCodeProvider.
   * E2E tests inject a StubCopilotProvider so they don't burn real LLM
   * tokens or require Claude Code to be installed.
   */
  provider?: CopilotProvider;
}

export interface StartCopilotSessionResult {
  sessionId: string;
}

export interface StartCopilotSessionOptions {
  /**
   * Pre-existing Claude conversation ID to resume. When set, the very first
   * sendMessage call will pass `--resume <id>` and Claude reloads the prior
   * conversation history into the agent's context. Used by the UI when the
   * user picks an old conversation from the dropdown.
   */
  conversationId?: string;
}

export interface CopilotSessionMetadata {
  id: string;
  conversationId: string | null;
  createdAt: number;
}

interface InternalSessionMeta extends CopilotSessionMetadata {
  cleanupMcp: () => Promise<void>;
  /**
   * The first user message text for this session, captured during the first
   * sendMessage call. Used as the conversation title when the row is first
   * INSERTed into SQLite (which happens on the first `done` event since
   * that's when we know Claude's conversationId). Cleared after the first
   * record.
   */
  pendingTitle: string | null;
  /**
   * True once we've INSERTed (or confirmed via lookup) a row for this
   * session's conversationId in SQLite. Subsequent done events bump
   * instead of insert.
   */
  conversationRecorded: boolean;
}

const SYSTEM_PROMPT = `You are the Ticketbook copilot — an in-app assistant that helps the user plan, write, and edit tickets and plans for their project.

You have access to the user's tickets and plans through the "ticketbook" MCP server. Use those tools when the user asks you to read, create, update, or organize their tickets and plans. Don't ask permission to read — just look. When you make changes, summarize what you did in one short paragraph.

Be terse. Skip preamble. Lead with the action or the answer.`;

const TITLE_MAX_LENGTH = 80;

function truncateTitle(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= TITLE_MAX_LENGTH) return trimmed || "Untitled";
  return trimmed.slice(0, TITLE_MAX_LENGTH - 1).trimEnd() + "…";
}

export class CopilotManager {
  private provider: CopilotProvider;
  private sessions = new Map<string, InternalSessionMeta>();
  private listeners = new Set<{
    stream: CopilotSessionEvents["stream"];
    done: CopilotSessionEvents["done"];
  }>();

  constructor(private config: CopilotManagerConfig) {
    this.provider = config.provider ?? new ClaudeCodeProvider();
    // Fan provider events out to subscribers (the WebSocket bridge in index.ts).
    this.provider.on("stream", (sessionId, part, messageId) => {
      for (const l of this.listeners) l.stream(sessionId, part, messageId);
    });
    this.provider.on("done", (sessionId) => {
      this.recordConversationOnDone(sessionId);
      for (const l of this.listeners) l.done(sessionId);
    });
  }

  // ─── Session lifecycle ────────────────────────────────────

  async startSession(
    opts: StartCopilotSessionOptions = {},
  ): Promise<StartCopilotSessionResult> {
    const sessionId = `cop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    let mcpConfigPath: string | undefined;
    let cleanupMcp: () => Promise<void> = async () => {};
    if (this.config.binPath) {
      const config = buildTicketbookMcpConfig({
        binPath: this.config.binPath,
        ticketsDir: this.config.ticketsDir,
      });
      const written = await writeMcpConfigFile(config);
      mcpConfigPath = written.path;
      cleanupMcp = written.cleanup;
    }

    this.provider.startSession(sessionId, {
      cwd: this.config.cwd ?? this.defaultCwd(),
      systemPrompt: SYSTEM_PROMPT,
      mcpConfigPath,
      conversationId: opts.conversationId,
    });

    // If we're resuming a known conversation, mark it as already recorded
    // so the first done event bumps instead of inserts.
    const isResume = !!opts.conversationId;
    let conversationRecorded = false;
    if (isResume && opts.conversationId) {
      const existing = getCopilotConversation(this.config.ticketsDir, opts.conversationId);
      conversationRecorded = !!existing;
    }

    this.sessions.set(sessionId, {
      id: sessionId,
      conversationId: opts.conversationId ?? null,
      createdAt: Date.now(),
      cleanupMcp,
      pendingTitle: null,
      conversationRecorded,
    });

    return { sessionId };
  }

  async sendMessage(sessionId: string, text: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Copilot session not found: ${sessionId}`);
    }

    // Capture the first user message as the pending title — used when the
    // row is first INSERTed on the next `done` event.
    if (session.pendingTitle === null && !session.conversationRecorded) {
      session.pendingTitle = truncateTitle(text);
    }

    await this.provider.sendMessage(sessionId, text);
    // Refresh the conversation ID — it may have just been assigned.
    session.conversationId = this.provider.getConversationId(sessionId);
  }

  async stopSession(sessionId: string): Promise<void> {
    const meta = this.sessions.get(sessionId);
    if (!meta) return;
    this.provider.stopSession(sessionId);
    await meta.cleanupMcp();
    this.sessions.delete(sessionId);
  }

  async stopAll(): Promise<void> {
    for (const id of Array.from(this.sessions.keys())) {
      await this.stopSession(id);
    }
    this.provider.stopAll();
  }

  getSession(sessionId: string): CopilotSessionMetadata | null {
    const meta = this.sessions.get(sessionId);
    if (!meta) return null;
    return { id: meta.id, conversationId: meta.conversationId, createdAt: meta.createdAt };
  }

  listSessions(): CopilotSessionMetadata[] {
    return Array.from(this.sessions.values()).map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      createdAt: m.createdAt,
    }));
  }

  async checkHealth(): Promise<CopilotProviderHealth> {
    return this.provider.checkHealth();
  }

  // ─── Conversation persistence ─────────────────────────────

  /** List all persisted conversations for this ticketbook instance, newest first. */
  listConversations(): CopilotConversationRow[] {
    return listCopilotConversations(this.config.ticketsDir);
  }

  /** Delete a conversation row. The actual JSONL in Claude Code's store is left alone. */
  deleteConversation(id: string): void {
    deleteCopilotConversation(this.config.ticketsDir, id);
  }

  /**
   * Load prior messages for a conversation by reading Claude Code's local
   * JSONL store. Returns an empty array if the file doesn't exist (e.g.,
   * the user wiped their store) — the panel will still work for new turns
   * because Claude Code is the source of truth and `--resume` will reload
   * the agent context regardless.
   */
  async loadConversationMessages(id: string): Promise<HistoricalMessage[]> {
    return loadConversationHistory(this.config.cwd ?? this.defaultCwd(), id);
  }

  /**
   * Called from the provider's `done` event. If we have a conversationId
   * (captured from the first turn's stream events) and the row hasn't
   * been recorded yet, INSERT it with the pending title. Otherwise bump
   * the existing row's updated_at and message_count.
   */
  private recordConversationOnDone(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    // The provider may have just captured the conversation ID during the
    // turn; refresh from the source of truth.
    session.conversationId = this.provider.getConversationId(sessionId);
    const conversationId = session.conversationId;
    if (!conversationId) return;

    if (!session.conversationRecorded) {
      const title = session.pendingTitle ?? "Untitled";
      recordCopilotConversation(this.config.ticketsDir, {
        id: conversationId,
        title,
      });
      session.conversationRecorded = true;
      session.pendingTitle = null;
    } else {
      bumpCopilotConversation(this.config.ticketsDir, conversationId);
    }
  }

  // ─── Subscription bridge ──────────────────────────────────

  /**
   * Subscribe to stream and done events for *all* sessions. Returns a dispose
   * function. The WebSocket bridge in index.ts uses this to forward events to
   * the connected client; the client filters by sessionId.
   */
  subscribe(handlers: {
    stream: (sessionId: string, part: CopilotMessagePart, messageId: string) => void;
    done: (sessionId: string) => void;
  }): () => void {
    this.listeners.add(handlers);
    return () => {
      this.listeners.delete(handlers);
    };
  }

  // ─── Internals ────────────────────────────────────────────

  private defaultCwd(): string {
    // Tickets dir is .tickets/ inside the project; spawn the CLI from the
    // project root so it can see source files, run tests, etc.
    return this.config.ticketsDir.replace(/\.tickets\/?$/, "") || process.cwd();
  }
}
