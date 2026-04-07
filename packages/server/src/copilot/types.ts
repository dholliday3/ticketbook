/**
 * Normalized message types emitted by any copilot provider.
 *
 * The provider abstraction is intentionally thin right now: there is one
 * concrete provider (Claude Code, headless). The shape below is what every
 * downstream consumer (REST API, WebSocket frames, UI hook) sees, regardless
 * of which CLI is on the other end. Adding Codex later means writing one more
 * file under ./providers/ that emits these same parts — nothing else changes.
 */

/** A single chunk of provider output. Streamed in real time over WebSocket. */
export type CopilotMessagePart =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "tool_use"; content: string; toolName?: string; toolInput?: string }
  | { type: "tool_result"; content: string; toolName?: string }
  | { type: "error"; content: string };

export type CopilotProviderId = "claude-code";

export type CopilotProviderStatus = "ready" | "not_installed" | "not_authenticated" | "error";

export interface CopilotProviderHealth {
  providerId: CopilotProviderId;
  status: CopilotProviderStatus;
  cliVersion: string | null;
  error: string | null;
}

/**
 * Lifecycle events the copilot session emits to the server's transport layer
 * (currently the WebSocket bridge in index.ts). These are not the same as
 * provider-internal events — they are the seam between the manager and the
 * outside world.
 */
export interface CopilotSessionEvents {
  /** A new chunk of output from the provider. messageId groups parts of one assistant turn. */
  stream: (sessionId: string, part: CopilotMessagePart, messageId: string) => void;
  /** The current turn finished (provider process exited or final result received). */
  done: (sessionId: string) => void;
}

/**
 * Minimal provider contract the manager talks to. Lets us swap in a
 * stub provider for e2e tests without spawning real `claude` (and
 * without the manager caring which one it's using). The real provider
 * is `ClaudeCodeProvider`; the test stub is `StubCopilotProvider`.
 */
export interface CopilotProvider {
  readonly id: CopilotProviderId | "stub";
  checkHealth(): Promise<CopilotProviderHealth>;
  startSession(sessionId: string, opts: CopilotSessionOptions & { mcpConfigPath?: string }): void;
  sendMessage(sessionId: string, text: string): Promise<void>;
  stopSession(sessionId: string): void;
  stopAll(): void;
  getConversationId(sessionId: string): string | null;
  on<E extends keyof CopilotSessionEvents>(event: E, listener: CopilotSessionEvents[E]): this;
}

/** Options accepted when creating a copilot session. */
export interface CopilotSessionOptions {
  /** Working directory the spawned CLI runs in. Defaults to the project root. */
  cwd?: string;
  /** Optional system prompt prepended on the first turn. */
  systemPrompt?: string;
  /**
   * Optional MCP config payload. If provided, it is written to a temp file and
   * passed to the provider so the spawned CLI can call ticketbook tools (and
   * any other servers the user has configured).
   */
  mcpConfig?: Record<string, unknown>;
  /**
   * Optional Claude Code conversation/session ID to resume from. When set,
   * the very first sendMessage call will pass `--resume <id>` to claude
   * instead of starting a fresh conversation. This is how we restore prior
   * conversations across page refreshes — Claude Code persists every
   * conversation as JSONL on disk, and `--resume` reloads the full history
   * into the agent's context.
   */
  conversationId?: string;
}
