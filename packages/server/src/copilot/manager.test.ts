import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { _resetDbCacheForTests } from "../db.js";
import { CopilotManager } from "./manager.js";
import type {
  CopilotProvider,
  CopilotProviderHealth,
  CopilotProviderId,
  CopilotSessionEvents,
  CopilotSessionOptions,
} from "./types.js";

class FakeProvider extends EventEmitter implements CopilotProvider {
  private sessions = new Map<string, { conversationId: string | null; nextConversationId: string }>();

  constructor(
    readonly id: CopilotProviderId,
    private readonly cliVersion: string,
  ) {
    super();
  }

  async checkHealth(): Promise<CopilotProviderHealth> {
    return {
      providerId: this.id,
      status: "ready",
      cliVersion: this.cliVersion,
      error: null,
    };
  }

  startSession(sessionId: string, opts: CopilotSessionOptions): void {
    this.sessions.set(sessionId, {
      conversationId: opts.conversationId ?? null,
      nextConversationId: `${this.id}-thread-1`,
    });
  }

  async sendMessage(sessionId: string, text: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`missing session ${sessionId}`);
    if (!session.conversationId) {
      session.conversationId = session.nextConversationId;
    }
    this.emit("stream", sessionId, { type: "text", content: `${this.id}:${text}` }, `msg-${sessionId}`);
    this.emit("done", sessionId);
  }

  stopSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  stopAll(): void {
    this.sessions.clear();
  }

  getConversationId(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.conversationId ?? null;
  }

  on<E extends keyof CopilotSessionEvents>(event: E, listener: CopilotSessionEvents[E]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }
}

describe("CopilotManager", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "relay-manager-"));
    _resetDbCacheForTests();
  });

  afterEach(async () => {
    _resetDbCacheForTests();
    await rm(dir, { recursive: true, force: true });
  });

  it("records provider-owned conversations and replays stored transcript history", async () => {
    const claude = new FakeProvider("claude-code", "claude-test");
    const codex = new FakeProvider("codex", "codex-test");
    const manager = new CopilotManager({
      relayDir: dir,
      tasksDir: dir,
      providers: [claude, codex],
      defaultProviderId: "claude-code",
    });

    const started = await manager.startSession({ providerId: "codex" });
    await manager.sendMessage(started.sessionId, "hello");

    const conversations = manager.listConversations("codex");
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({
      id: "codex:codex-thread-1",
      provider_id: "codex",
      provider_conversation_id: "codex-thread-1",
      title: "hello",
      message_count: 1,
    });

    const messages = await manager.loadConversationMessages(conversations[0].id);
    expect(messages).toEqual([
      {
        id: expect.any(String),
        role: "user",
        parts: [{ type: "text", content: "hello" }],
        createdAt: expect.any(Number),
      },
      {
        id: expect.any(String),
        role: "assistant",
        parts: [{ type: "text", content: "codex:hello" }],
        createdAt: expect.any(Number),
      },
    ]);

    const resumed = await manager.startSession({ conversationId: conversations[0].id });
    const resumedMeta = manager.getSession(resumed.sessionId);
    expect(resumedMeta).toMatchObject({
      providerId: "codex",
      conversationId: conversations[0].id,
      providerConversationId: "codex-thread-1",
    });

    const second = await manager.startSession({ providerId: "claude-code" });
    await manager.sendMessage(second.sessionId, "world");

    const allConversations = manager.listConversations();
    expect(allConversations.map((conversation) => conversation.provider_id)).toEqual([
      "claude-code",
      "codex",
    ]);
  });
});
