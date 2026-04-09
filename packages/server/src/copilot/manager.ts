import { ClaudeCodeProvider } from "./claude-code.js";
import { buildTicketbookMcpConfig, writeMcpConfigFile } from "./mcp-config.js";
import { expandContextRefs } from "./context-refs.js";
import type {
  CopilotMessagePart,
  CopilotProvider,
  CopilotProviderHealth,
  CopilotProviderId,
  CopilotSessionEvents,
} from "./types.js";
import {
  appendCopilotMessage,
  bumpCopilotConversation,
  deleteCopilotConversation,
  getCopilotConversation,
  getCopilotConversationByProviderConversationId,
  listCopilotConversations,
  listCopilotMessages,
  recordCopilotConversation,
  type CopilotConversationRow,
} from "../db.js";

export interface CopilotManagerConfig {
  tasksDir: string;
  /**
   * Directory holding plan markdown files. Required for expanding
   * `<plan id="..." />` context refs — if omitted, plan markers are
   * forwarded to the provider as-is instead of being expanded.
   */
  plansDir?: string;
  binPath?: string;
  cwd?: string;
  providers?: CopilotProvider[];
  defaultProviderId?: CopilotProviderId;
}

export interface StartCopilotSessionResult {
  sessionId: string;
}

export interface StartCopilotSessionOptions {
  providerId?: CopilotProviderId;
  /**
   * App-level persisted conversation ID. The manager resolves this to the
   * provider-native thread/conversation ID before starting the provider
   * session.
   */
  conversationId?: string;
}

export interface CopilotSessionMetadata {
  id: string;
  providerId: CopilotProviderId;
  conversationId: string | null;
  providerConversationId: string | null;
  createdAt: number;
}

interface StoredTranscriptMessage {
  id: string;
  role: "user" | "assistant";
  parts: CopilotMessagePart[];
  createdAt: number;
}

interface InternalSessionMeta extends CopilotSessionMetadata {
  cleanupMcp: () => Promise<void>;
  pendingTitle: string | null;
  stagedMessages: StoredTranscriptMessage[];
  currentAssistantMessageId: string | null;
  currentAssistantParts: CopilotMessagePart[];
  currentAssistantCreatedAt: number | null;
}

const SYSTEM_PROMPT = `You are the Ticketbook copilot — an in-app assistant that helps the user plan, write, and edit tasks and plans for their project.

You have access to the user's tasks and plans through the "ticketbook" MCP server. Use those tools when the user asks you to read, create, update, or organize their tasks and plans. Don't ask permission to read — just look. When you make changes, summarize what you did in one short paragraph.

Be terse. Skip preamble. Lead with the action or the answer.`;

const TITLE_MAX_LENGTH = 80;

function truncateTitle(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= TITLE_MAX_LENGTH) return trimmed || "Untitled";
  return trimmed.slice(0, TITLE_MAX_LENGTH - 1).trimEnd() + "…";
}

function mergeStreamingParts(parts: CopilotMessagePart[], part: CopilotMessagePart): CopilotMessagePart[] {
  const last = parts.at(-1);
  if (
    last &&
    (last.type === "text" || last.type === "thinking") &&
    last.type === part.type
  ) {
    return [
      ...parts.slice(0, -1),
      {
        ...last,
        content: last.content + part.content,
      },
    ];
  }
  return [...parts, part];
}

export class CopilotManager {
  private providers: Map<CopilotProviderId, CopilotProvider>;
  private providerOverride: CopilotProvider | null = null;
  private defaultProviderId: CopilotProviderId;
  private sessions = new Map<string, InternalSessionMeta>();
  private listeners = new Set<{
    stream: CopilotSessionEvents["stream"];
    done: CopilotSessionEvents["done"];
  }>();

  constructor(private config: CopilotManagerConfig) {
    const configuredProviders = config.providers ?? [new ClaudeCodeProvider()];
    this.providers = new Map(
      configuredProviders
        .filter((provider): provider is CopilotProvider & { id: CopilotProviderId } => provider.id !== "stub")
        .map((provider) => [provider.id, provider]),
    );

    if (this.providers.size === 0 && configuredProviders.length === 1) {
      const stub = configuredProviders[0];
      this.providerOverride = stub;
      this.defaultProviderId = "claude-code";
      stub.on("stream", (sessionId, part, messageId) => this.handleStream(sessionId, part, messageId));
      stub.on("done", (sessionId) => this.handleDone(sessionId));
      return;
    }

    this.defaultProviderId =
      config.defaultProviderId ??
      (this.providers.has("claude-code")
        ? "claude-code"
        : Array.from(this.providers.keys())[0]);

    for (const provider of configuredProviders) {
      provider.on("stream", (sessionId, part, messageId) =>
        this.handleStream(sessionId, part, messageId),
      );
      provider.on("done", (sessionId) => this.handleDone(sessionId));
    }
  }

  async startSession(
    opts: StartCopilotSessionOptions = {},
  ): Promise<StartCopilotSessionResult> {
    const sessionId = `cop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let providerId = opts.providerId ?? this.defaultProviderId;
    let providerConversationId: string | null = null;
    let conversationId: string | null = null;
    let mcpConfig: Record<string, unknown> | undefined;

    if (opts.conversationId) {
      const row = getCopilotConversation(this.config.tasksDir, opts.conversationId);
      if (!row) {
        throw new Error(`Copilot conversation not found: ${opts.conversationId}`);
      }
      providerId = row.provider_id;
      providerConversationId = row.provider_conversation_id;
      conversationId = row.id;
    }

    const provider = this.getProvider(providerId);

    let mcpConfigPath: string | undefined;
    let cleanupMcp: () => Promise<void> = async () => {};
    if (this.config.binPath) {
      mcpConfig = buildTicketbookMcpConfig({
        binPath: this.config.binPath,
        tasksDir: this.config.tasksDir,
      });
      const written = await writeMcpConfigFile(mcpConfig);
      mcpConfigPath = written.path;
      cleanupMcp = written.cleanup;
    }

    provider.startSession(sessionId, {
      cwd: this.config.cwd ?? this.defaultCwd(),
      systemPrompt: SYSTEM_PROMPT,
      mcpConfig,
      mcpConfigPath,
      conversationId: providerConversationId ?? undefined,
    });

    this.sessions.set(sessionId, {
      id: sessionId,
      providerId,
      conversationId,
      providerConversationId,
      createdAt: Date.now(),
      cleanupMcp,
      pendingTitle: null,
      stagedMessages: [],
      currentAssistantMessageId: null,
      currentAssistantParts: [],
      currentAssistantCreatedAt: null,
    });

    return { sessionId };
  }

  async sendMessage(sessionId: string, text: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Copilot session not found: ${sessionId}`);
    }

    if (session.pendingTitle === null && session.conversationId === null) {
      session.pendingTitle = truncateTitle(text);
    }

    // Persist the user's *original* text with markers intact. The DB
    // stays small and conversations re-expand to the latest primitive
    // state on every send. Only the provider sees the expanded form.
    session.stagedMessages.push({
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: "user",
      parts: [{ type: "text", content: text }],
      createdAt: Date.now(),
    });
    session.currentAssistantMessageId = null;
    session.currentAssistantParts = [];
    session.currentAssistantCreatedAt = null;

    const forwardText = this.config.plansDir
      ? await expandContextRefs(text, {
          tasksDir: this.config.tasksDir,
          plansDir: this.config.plansDir,
        })
      : text;

    const provider = this.getProvider(session.providerId);
    await provider.sendMessage(sessionId, forwardText);
    session.providerConversationId = provider.getConversationId(sessionId);
    this.ensureConversationRecord(session);
  }

  async stopSession(sessionId: string): Promise<void> {
    const meta = this.sessions.get(sessionId);
    if (!meta) return;
    this.getProvider(meta.providerId).stopSession(sessionId);
    await meta.cleanupMcp();
    this.sessions.delete(sessionId);
  }

  async stopAll(): Promise<void> {
    for (const id of Array.from(this.sessions.keys())) {
      await this.stopSession(id);
    }
    for (const provider of this.providers.values()) {
      provider.stopAll();
    }
  }

  getSession(sessionId: string): CopilotSessionMetadata | null {
    const meta = this.sessions.get(sessionId);
    if (!meta) return null;
    return {
      id: meta.id,
      providerId: meta.providerId,
      conversationId: meta.conversationId,
      providerConversationId: meta.providerConversationId,
      createdAt: meta.createdAt,
    };
  }

  listSessions(): CopilotSessionMetadata[] {
    return Array.from(this.sessions.values()).map((meta) => ({
      id: meta.id,
      providerId: meta.providerId,
      conversationId: meta.conversationId,
      providerConversationId: meta.providerConversationId,
      createdAt: meta.createdAt,
    }));
  }

  async listProviderHealth(): Promise<CopilotProviderHealth[]> {
    if (this.providerOverride) {
      return [await this.providerOverride.checkHealth()];
    }
    return Promise.all(Array.from(this.providers.values()).map((provider) => provider.checkHealth()));
  }

  getDefaultProviderId(): CopilotProviderId {
    return this.defaultProviderId;
  }

  listConversations(providerId?: CopilotProviderId): CopilotConversationRow[] {
    return listCopilotConversations(this.config.tasksDir, providerId);
  }

  deleteConversation(id: string): void {
    deleteCopilotConversation(this.config.tasksDir, id);
  }

  async loadConversationMessages(id: string): Promise<StoredTranscriptMessage[]> {
    return listCopilotMessages(this.config.tasksDir, id).map((row) => ({
      id: row.id,
      role: row.role,
      parts: row.parts,
      createdAt: row.created_at,
    }));
  }

  subscribe(handlers: {
    stream: (sessionId: string, part: CopilotMessagePart, messageId: string) => void;
    done: (sessionId: string) => void;
  }): () => void {
    this.listeners.add(handlers);
    return () => {
      this.listeners.delete(handlers);
    };
  }

  private handleStream(sessionId: string, part: CopilotMessagePart, messageId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const provider = this.getProvider(session.providerId);
    session.providerConversationId = provider.getConversationId(sessionId);
    this.ensureConversationRecord(session);

    if (session.currentAssistantMessageId !== messageId) {
      this.flushAssistantMessage(session);
      session.currentAssistantMessageId = messageId;
      session.currentAssistantParts = [];
      session.currentAssistantCreatedAt = Date.now();
    }
    session.currentAssistantParts = mergeStreamingParts(session.currentAssistantParts, part);

    for (const listener of this.listeners) {
      listener.stream(sessionId, part, messageId);
    }
  }

  private handleDone(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const provider = this.getProvider(session.providerId);
    session.providerConversationId = provider.getConversationId(sessionId);
    this.ensureConversationRecord(session);
    this.flushAssistantMessage(session);

    if (session.conversationId) {
      bumpCopilotConversation(this.config.tasksDir, session.conversationId);
    }

    for (const listener of this.listeners) {
      listener.done(sessionId);
    }
  }

  private ensureConversationRecord(session: InternalSessionMeta): void {
    if (!session.providerConversationId) return;
    if (!session.conversationId) {
      const existing = getCopilotConversationByProviderConversationId(
        this.config.tasksDir,
        session.providerId,
        session.providerConversationId,
      );
      const row =
        existing ??
        recordCopilotConversation(this.config.tasksDir, {
          providerId: session.providerId,
          providerConversationId: session.providerConversationId,
          title: session.pendingTitle ?? "Untitled",
        });
      session.conversationId = row.id;
      session.pendingTitle = null;
    }

    if (!session.conversationId) return;
    if (session.stagedMessages.length > 0) {
      for (const message of session.stagedMessages) {
        appendCopilotMessage(this.config.tasksDir, {
          id: message.id,
          conversationId: session.conversationId,
          role: message.role,
          parts: message.parts,
          createdAt: message.createdAt,
        });
      }
      session.stagedMessages = [];
    }
  }

  private flushAssistantMessage(session: InternalSessionMeta): void {
    if (!session.currentAssistantMessageId || session.currentAssistantParts.length === 0) {
      return;
    }

    const message: StoredTranscriptMessage = {
      id: `assistant-${session.currentAssistantMessageId}`,
      role: "assistant",
      parts: session.currentAssistantParts,
      createdAt: session.currentAssistantCreatedAt ?? Date.now(),
    };

    if (session.conversationId) {
      appendCopilotMessage(this.config.tasksDir, {
        id: message.id,
        conversationId: session.conversationId,
        role: message.role,
        parts: message.parts,
        createdAt: message.createdAt,
      });
    } else {
      session.stagedMessages.push(message);
    }

    session.currentAssistantMessageId = null;
    session.currentAssistantParts = [];
    session.currentAssistantCreatedAt = null;
  }

  private getProvider(providerId: CopilotProviderId): CopilotProvider {
    if (this.providerOverride) return this.providerOverride;
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Copilot provider not configured: ${providerId}`);
    }
    return provider;
  }

  private defaultCwd(): string {
    return (
      this.config.tasksDir
        .replace(/\/?\.tasks\/?$/, "")
        .replace(/\/+$/, "") || process.cwd()
    );
  }
}
