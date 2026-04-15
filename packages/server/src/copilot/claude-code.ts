import { EventEmitter } from "node:events";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import type {
  CopilotMessagePart,
  CopilotProviderHealth,
  CopilotProviderId,
  CopilotSendOptions,
  CopilotSessionEvents,
  CopilotSessionOptions,
} from "./types.js";

/**
 * Effort levels the Claude Code CLI's `--effort` flag accepts (per
 * `claude --help` on 2.1.97). Unknown values are dropped rather than
 * forwarded so we don't pass an arbitrary string to the spawned process.
 */
const CLAUDE_EFFORT_LEVELS = new Set(["low", "medium", "high", "max"]);

/**
 * Trim noisy values out of the arg list for logging so the important
 * bits (--model, --effort, --resume, etc.) stay legible. Flags whose
 * values are long and uninteresting get elided with `<…>`.
 */
const NOISY_ARG_FLAGS = new Set([
  "--append-system-prompt",
  "--system-prompt",
  "--mcp-config",
  "--allowed-tools",
]);

function summarizeCliArgs(args: string[]): string {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    out.push(arg);
    if (NOISY_ARG_FLAGS.has(arg) && i + 1 < args.length) {
      out.push("<…>");
      i++;
    }
  }
  return out.join(" ");
}

interface InternalSession {
  id: string;
  cwd: string;
  systemPrompt: string | null;
  mcpConfigPath: string | null;
  /** The conversation ID returned by Claude on the first turn — used to --resume on subsequent turns. */
  conversationId: string | null;
  /** The currently running CLI process for this session, if any. */
  process: ChildProcess | null;
  /**
   * Per-turn flag set the first time text/thinking content is delivered for
   * the current message (via deltas, an assistant block, or content_block_*
   * events). Used to drop the trailing `result` block, which is a duplicate
   * summary claude-code emits as a convenience. Reset on every sendMessage.
   */
  hasEmittedText: boolean;
  status: "idle" | "busy" | "stopped";
}

/**
 * AI provider that spawns the Claude Code CLI in headless mode.
 *
 * Uses the user's existing Claude Code subscription — no API key required.
 * Each turn spawns one `claude --print --output-format stream-json --verbose`
 * process; the conversation ID is captured from the first turn and replayed
 * via `--resume` on follow-ups, so multi-turn state lives in Claude's local
 * conversation store rather than this process.
 *
 * Ported from roundtable's claudeCodeProvider.ts with two changes:
 *  - Prompt is written to stdin (not argv) so messages starting with `--`
 *    don't get parsed as flags.
 *  - System prompt no longer hard-codes a "you are editing a doc" framing —
 *    callers pass whatever framing they want via `systemPrompt`.
 */
export class ClaudeCodeProvider extends EventEmitter {
  readonly id: CopilotProviderId = "claude-code";
  private sessions = new Map<string, InternalSession>();

  // ─── Health ───────────────────────────────────────────────

  async checkHealth(): Promise<CopilotProviderHealth> {
    const which = spawnSync("which", ["claude"], { timeout: 4000 });
    if (which.status !== 0) {
      return { providerId: this.id, status: "not_installed", cliVersion: null, error: null };
    }
    const version = spawnSync("claude", ["--version"], {
      timeout: 4000,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    if (version.status !== 0) {
      return {
        providerId: this.id,
        status: "error",
        cliVersion: null,
        error: "Could not run `claude --version`",
      };
    }
    const cliVersion = version.stdout.toString().trim().split("\n")[0] || null;
    return { providerId: this.id, status: "ready", cliVersion, error: null };
  }

  // ─── Session lifecycle ────────────────────────────────────

  startSession(sessionId: string, opts: CopilotSessionOptions & { mcpConfigPath?: string }): void {
    if (this.sessions.has(sessionId)) {
      this.stopSession(sessionId);
    }
    this.sessions.set(sessionId, {
      id: sessionId,
      cwd: opts.cwd ?? process.cwd(),
      systemPrompt: opts.systemPrompt ?? null,
      mcpConfigPath: opts.mcpConfigPath ?? null,
      // If a conversationId is provided up-front (resuming a prior
      // conversation), pre-populate it so the first sendMessage uses
      // --resume <id>. Otherwise it gets captured from the first turn's
      // stream events as before.
      conversationId: opts.conversationId ?? null,
      process: null,
      hasEmittedText: false,
      status: "idle",
    });
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  async sendMessage(sessionId: string, text: string, opts: CopilotSendOptions = {}): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Copilot session not found: ${sessionId}`);
    if (session.status === "stopped") throw new Error(`Copilot session ${sessionId} is stopped`);

    // Kill any in-flight process before starting a new turn.
    if (session.process && session.process.exitCode === null) {
      session.process.kill("SIGTERM");
    }

    session.status = "busy";
    session.hasEmittedText = false;

    const args: string[] = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      // Headless mode has no interactive stdin for permission prompts, so
      // tool calls would otherwise hang. Bypass the prompts since the
      // allowlist below already restricts what the agent can touch.
      "--permission-mode",
      "bypassPermissions",
      // The copilot gets relay's MCP tools plus the full file-editing
      // and shell toolset so it can act as a coding agent from inside the
      // app — read/write files, run bash commands, and navigate the repo.
      "--allowed-tools",
      "mcp__relay__*,Read,Glob,Grep,WebSearch,Bash,Edit,Write,NotebookEdit",
    ];

    // Per-turn model override (e.g. sonnet/opus/haiku). claude-code resolves
    // short aliases to full model IDs itself, so either an alias or a full
    // `claude-sonnet-4-6`-style name works.
    if (opts.model) {
      args.push("--model", opts.model);
    }
    // Per-turn reasoning effort. The CLI validates this value, but we also
    // pre-validate against the known set so an invalid selection never gets
    // as far as spawning a subprocess with bad args.
    if (opts.reasoningEffort && CLAUDE_EFFORT_LEVELS.has(opts.reasoningEffort)) {
      args.push("--effort", opts.reasoningEffort);
    }

    if (session.conversationId) {
      args.push("--resume", session.conversationId);
    } else if (session.systemPrompt) {
      // Append-only on the first turn; resumed conversations carry it forward.
      args.push("--append-system-prompt", session.systemPrompt);
    }

    if (session.mcpConfigPath) {
      args.push("--mcp-config", session.mcpConfigPath);
    }

    const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Ground-truth spawn log — shows exactly which flags reached the CLI,
    // so if the UI shows "sonnet + high" we can verify `--model sonnet
    // --effort high` actually landed here. System prompt + MCP paths are
    // long and not interesting, so summarize them rather than dump.
    console.log(
      `[copilot:claude-code:${sessionId}] spawn claude ${summarizeCliArgs(args)}`,
    );

    const proc = spawn("claude", args, {
      cwd: session.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    session.process = proc;

    // Send the prompt via stdin so messages starting with `--` aren't
    // misparsed as CLI flags. Closing stdin signals end-of-prompt.
    proc.stdin?.write(text);
    proc.stdin?.end();

    let lineBuffer = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        for (const part of this.parseStreamJsonLine(line, session)) {
          this.emit("stream", sessionId, part, messageId);
        }
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.error(`[copilot:claude-code:${sessionId}] ${text}`);
    });

    proc.on("close", (code) => {
      // Flush any trailing partial line.
      if (lineBuffer.trim()) {
        for (const part of this.parseStreamJsonLine(lineBuffer, session)) {
          this.emit("stream", sessionId, part, messageId);
        }
        lineBuffer = "";
      }
      if (session.status !== "stopped") session.status = "idle";
      if (code !== 0 && code !== null && session.status !== "stopped") {
        console.error(`[copilot:claude-code:${sessionId}] exited with code ${code}`);
      }
      this.emit("done", sessionId);
    });

    proc.on("error", (err) => {
      console.error(`[copilot:claude-code:${sessionId}] spawn error: ${err.message}`);
      this.emit(
        "stream",
        sessionId,
        { type: "error", content: `Failed to start claude CLI: ${err.message}` },
        messageId,
      );
      session.status = "idle";
      this.emit("done", sessionId);
    });
  }

  stopSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.status = "stopped";
    if (session.process && session.process.exitCode === null) {
      try {
        session.process.kill("SIGTERM");
        // Give the process a beat to exit cleanly before SIGKILL.
        setTimeout(() => {
          try {
            session.process?.kill("SIGKILL");
          } catch {
            // already dead
          }
        }, 3000).unref();
      } catch {
        // already dead
      }
    }
    this.sessions.delete(sessionId);
  }

  stopAll(): void {
    for (const id of Array.from(this.sessions.keys())) this.stopSession(id);
  }

  /** The conversation ID Claude assigned to this session, if known yet. */
  getConversationId(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.conversationId ?? null;
  }

  // ─── Stream parser ────────────────────────────────────────

  /**
   * Visible for testing. Parses one line of Claude Code's stream-json output
   * into zero or more normalized message parts. Mutates `session` to capture
   * the conversation ID and the per-turn delta-vs-final dedup flag.
   */
  parseStreamJsonLine(line: string, session: InternalSession): CopilotMessagePart[] {
    const parts: CopilotMessagePart[] = [];

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(line);
    } catch {
      // Not valid JSON — surface as raw text rather than dropping it on the floor.
      if (line.trim()) parts.push({ type: "text", content: line });
      return parts;
    }

    const type = json.type as string | undefined;

    // Capture the session/conversation ID for --resume on the next turn.
    if (typeof json.session_id === "string" && !session.conversationId) {
      session.conversationId = json.session_id;
    }
    if (typeof json.conversation_id === "string" && !session.conversationId) {
      session.conversationId = json.conversation_id as string;
    }

    // Helper: did this batch of parts contain any text/thinking content? Used
    // by the result-block dedup below.
    const hasTextLike = (xs: CopilotMessagePart[]) =>
      xs.some((p) => p.type === "text" || p.type === "thinking");

    switch (type) {
      case "assistant": {
        // Always emit. A single turn can contain multiple assistant blocks
        // (intro text → tool_use → post-tool conclusion), and dropping any
        // of them would lose visible content. The duplication risk we care
        // about is the trailing `result` block, which we dedup separately.
        const message = json.message as Record<string, unknown> | undefined;
        const content = (message?.content ?? json.content) as
          | Array<Record<string, unknown>>
          | undefined;
        if (Array.isArray(content)) {
          for (const block of content) parts.push(...this.parseContentBlock(block));
        }
        // Mark that text has been delivered so the trailing result block skips.
        if (hasTextLike(parts)) session.hasEmittedText = true;
        break;
      }

      case "content_block_start": {
        // Streaming has begun; subsequent result text must be deduped.
        session.hasEmittedText = true;
        break;
      }

      case "content_block_delta": {
        const delta = json.delta as Record<string, unknown> | undefined;
        if (!delta) break;
        const deltaType = delta.type as string | undefined;
        if (deltaType === "text_delta" && typeof delta.text === "string") {
          parts.push({ type: "text", content: delta.text });
          session.hasEmittedText = true;
        } else if (deltaType === "thinking_delta" && typeof delta.thinking === "string") {
          parts.push({ type: "thinking", content: delta.thinking });
          session.hasEmittedText = true;
        } else if (deltaType === "input_json_delta" && typeof delta.partial_json === "string") {
          parts.push({ type: "tool_use", content: delta.partial_json });
        }
        break;
      }

      case "result": {
        // Final summary — claude-code repeats the last assistant message text
        // here as a convenience for non-streaming consumers. We've already
        // delivered it via assistant/delta events, so drop it.
        if (typeof json.session_id === "string") {
          session.conversationId = json.session_id;
        }
        if (session.hasEmittedText) break;
        const result = json.result as string | undefined;
        if (result) parts.push({ type: "text", content: result });
        const content = json.content as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(content)) {
          for (const block of content) parts.push(...this.parseContentBlock(block));
        }
        if (hasTextLike(parts)) session.hasEmittedText = true;
        break;
      }

      case "error": {
        const errMsg =
          (json.error as Record<string, unknown> | undefined)?.message ??
          json.message ??
          "Unknown error";
        parts.push({ type: "error", content: String(errMsg) });
        break;
      }

      // message_start, message_delta, message_stop, content_block_stop, system —
      // no payload we care about.
      default:
        break;
    }

    return parts;
  }

  private parseContentBlock(block: Record<string, unknown>): CopilotMessagePart[] {
    const blockType = block.type as string | undefined;

    switch (blockType) {
      case "text":
        if (typeof block.text === "string") {
          return [{ type: "text", content: block.text }];
        }
        return [];

      case "tool_use": {
        const input =
          typeof block.input === "string" ? block.input : JSON.stringify(block.input ?? {});
        return [
          {
            type: "tool_use",
            content: input,
            toolName: typeof block.name === "string" ? block.name : undefined,
            toolInput: input,
          },
        ];
      }

      case "tool_result": {
        const content =
          typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "");
        return [
          {
            type: "tool_result",
            content,
            toolName: typeof block.tool_use_id === "string" ? block.tool_use_id : undefined,
          },
        ];
      }

      case "thinking":
        if (typeof block.thinking === "string") {
          return [{ type: "thinking", content: block.thinking }];
        }
        if (typeof block.text === "string") {
          return [{ type: "thinking", content: block.text }];
        }
        return [];

      default:
        return [];
    }
  }

  // ─── Typed event helpers ──────────────────────────────────

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
