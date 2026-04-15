import { EventEmitter } from "node:events";
import type {
  CopilotProvider,
  CopilotProviderHealth,
  CopilotSendOptions,
  CopilotSessionEvents,
  CopilotSessionOptions,
} from "./types.js";

interface StubSession {
  id: string;
  conversationId: string;
  /** Number of turns we've responded to so far for this session. */
  turnCount: number;
}

/**
 * Stub copilot provider for e2e tests. Mimics ClaudeCodeProvider's external
 * surface but without spawning any real subprocess. Streams a scripted
 * response for every sendMessage call: a one-second "thinking" delta, a
 * single tool_use block, a tool_result block, and a final text reply that
 * echoes the user prompt. Generates predictable conversation IDs so the
 * test can verify persistence + resume flows without burning real LLM tokens.
 *
 * Selected via the `COPILOT_PROVIDER=stub` env var read by startServer.
 */
export class StubCopilotProvider extends EventEmitter implements CopilotProvider {
  readonly id = "stub" as const;
  private sessions = new Map<string, StubSession>();

  async checkHealth(): Promise<CopilotProviderHealth> {
    return {
      providerId: "claude-code",
      status: "ready",
      cliVersion: "stub-1.0.0",
      error: null,
    };
  }

  startSession(
    sessionId: string,
    opts: CopilotSessionOptions & { mcpConfigPath?: string },
  ): void {
    if (this.sessions.has(sessionId)) {
      this.stopSession(sessionId);
    }
    // If a conversationId was provided (resume), use it. Otherwise generate
    // a deterministic-ish one we'll capture during sendMessage. We use the
    // server-side sessionId as the seed so two browser sessions never
    // collide.
    const conversationId =
      opts.conversationId ?? `stub-conv-${sessionId.slice(-8)}-${Date.now()}`;
    this.sessions.set(sessionId, {
      id: sessionId,
      conversationId,
      turnCount: 0,
    });
  }

  async sendMessage(
    sessionId: string,
    text: string,
    _opts: CopilotSendOptions = {},
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Stub session not found: ${sessionId}`);

    session.turnCount += 1;
    const messageId = `stub-msg-${Date.now()}-${session.turnCount}`;

    // Small delay before the first stream event so the client's "pending"
    // bubble (shown between user-submit and first chunk) is observable in
    // tests, mirroring the real provider's network/cold-start latency.
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Emit a thinking part — exercises the Reasoning component.
    this.emit(
      "stream",
      sessionId,
      { type: "thinking", content: "Stub thinking…" },
      messageId,
    );

    // Emit a fake tool_use — exercises the ToolBlock renderer.
    this.emit(
      "stream",
      sessionId,
      {
        type: "tool_use",
        content: JSON.stringify({ echo: text.slice(0, 60) }),
        toolName: "stub_echo",
        toolInput: JSON.stringify({ echo: text.slice(0, 60) }),
      },
      messageId,
    );

    // Emit a tool_result.
    this.emit(
      "stream",
      sessionId,
      {
        type: "tool_result",
        content: `Echoed ${text.length} characters`,
        toolName: "stub_echo",
      },
      messageId,
    );

    // Emit the final text reply.
    this.emit(
      "stream",
      sessionId,
      {
        type: "text",
        content: `Stub reply (turn ${session.turnCount}): you said "${text}"`,
      },
      messageId,
    );

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

  // Typed event helpers — same shape as ClaudeCodeProvider.
  on<E extends keyof CopilotSessionEvents>(event: E, listener: CopilotSessionEvents[E]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  off<E extends keyof CopilotSessionEvents>(event: E, listener: CopilotSessionEvents[E]): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }

  emit<E extends keyof CopilotSessionEvents>(
    event: E,
    ...args: Parameters<CopilotSessionEvents[E]>
  ): boolean {
    return super.emit(event, ...(args as unknown[]));
  }
}
