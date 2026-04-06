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
}
