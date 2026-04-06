import { ClaudeCodeProvider } from "./claude-code.js";
import { buildTicketbookMcpConfig, writeMcpConfigFile } from "./mcp-config.js";
import type {
  CopilotMessagePart,
  CopilotProviderHealth,
  CopilotSessionEvents,
} from "./types.js";

/**
 * Single-provider session manager. Owns the Claude Code provider, allocates
 * session IDs, generates per-session MCP config files pointing back at
 * ticketbook's own MCP server, and surfaces typed `stream`/`done` events.
 *
 * The provider abstraction is intentionally inlined here rather than spread
 * across an interface + registry. There is one provider today; when Codex
 * lands, we factor out the seam at that point — not before.
 */

export interface CopilotManagerConfig {
  /**
   * Absolute path to the .tickets directory the surrounding server is
   * managing. Used to wire up ticketbook's own MCP server so the spawned
   * `claude` can read and create tickets.
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
}

export interface StartCopilotSessionResult {
  sessionId: string;
}

export interface CopilotSessionMetadata {
  id: string;
  conversationId: string | null;
  createdAt: number;
}

interface InternalSessionMeta extends CopilotSessionMetadata {
  cleanupMcp: () => Promise<void>;
}

const SYSTEM_PROMPT = `You are the Ticketbook copilot — an in-app assistant that helps the user plan, write, and edit tickets and plans for their project.

You have access to the user's tickets and plans through the "ticketbook" MCP server. Use those tools when the user asks you to read, create, update, or organize their tickets and plans. Don't ask permission to read — just look. When you make changes, summarize what you did in one short paragraph.

Be terse. Skip preamble. Lead with the action or the answer.`;

export class CopilotManager {
  private provider = new ClaudeCodeProvider();
  private sessions = new Map<string, InternalSessionMeta>();
  private listeners = new Set<{
    stream: CopilotSessionEvents["stream"];
    done: CopilotSessionEvents["done"];
  }>();

  constructor(private config: CopilotManagerConfig) {
    // Fan provider events out to subscribers (the WebSocket bridge in index.ts).
    this.provider.on("stream", (sessionId, part, messageId) => {
      for (const l of this.listeners) l.stream(sessionId, part, messageId);
    });
    this.provider.on("done", (sessionId) => {
      for (const l of this.listeners) l.done(sessionId);
    });
  }

  // ─── Session lifecycle ────────────────────────────────────

  async startSession(): Promise<StartCopilotSessionResult> {
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
    });

    this.sessions.set(sessionId, {
      id: sessionId,
      conversationId: null,
      createdAt: Date.now(),
      cleanupMcp,
    });

    return { sessionId };
  }

  async sendMessage(sessionId: string, text: string): Promise<void> {
    if (!this.sessions.has(sessionId)) {
      throw new Error(`Copilot session not found: ${sessionId}`);
    }
    await this.provider.sendMessage(sessionId, text);
    // Refresh the conversation ID — it may have just been assigned.
    const meta = this.sessions.get(sessionId);
    if (meta) {
      meta.conversationId = this.provider.getConversationId(sessionId);
    }
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
