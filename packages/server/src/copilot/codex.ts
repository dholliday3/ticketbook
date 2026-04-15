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
 * Effort levels the current Codex frontier models accept, read straight
 * from `~/.codex/models_cache.json` (the CLI's own model catalog). The
 * `list`-visibility models on codex-cli 0.118.0+ — gpt-5.4, gpt-5.4-mini,
 * gpt-5.3-codex, gpt-5.2 — all support exactly these four levels.
 * Older hidden models (gpt-5, gpt-5.1) had `minimal`, which we drop
 * since those models aren't user-selectable in our UI anyway.
 */
const CODEX_REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh"]);

/**
 * Flags whose value is long/uninteresting for logs — elide to keep the
 * ground-truth spawn line legible. We keep model, effort, and resume
 * IDs visible because those are the ones worth verifying.
 */
function summarizeCodexArgs(args: string[]): string {
  // -c overrides can include very long values (mcp server args, etc).
  // Drop the value part of -c but keep the flag so we know how many
  // overrides were applied.
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-c" && i + 1 < args.length) {
      const value = args[i + 1];
      // Keep model_reasoning_effort="..." legible since that's the
      // effort knob we want to verify.
      if (value.startsWith("model_reasoning_effort=")) {
        out.push(arg, value);
      } else {
        out.push(arg, "<…>");
      }
      i++;
      continue;
    }
    out.push(arg);
  }
  return out.join(" ");
}

interface InternalSession {
  id: string;
  cwd: string;
  systemPrompt: string | null;
  conversationId: string | null;
  process: ChildProcess | null;
  mcpConfig: Record<string, unknown> | null;
  status: "idle" | "busy" | "stopped";
}

type CodexStreamEvent =
  | { type: "thread.started"; thread_id: string }
  | { type: "turn.started" | "turn.completed" }
  | {
      type: "item.started" | "item.completed";
      item: {
        id: string;
        type: string;
        text?: string;
        command?: string;
        aggregated_output?: string;
        exit_code?: number | null;
        status?: string;
        server?: string;
        tool?: string;
        arguments?: unknown;
        result?: unknown;
        error?: { message?: string } | null;
      };
    };

function buildInitialPrompt(systemPrompt: string | null, text: string): string {
  if (!systemPrompt) return text;
  return `${systemPrompt}\n\nUser request:\n${text}`;
}

function codexMcpOverrides(mcpConfig: Record<string, unknown> | null): string[] {
  if (!mcpConfig) return [];
  const relay = (mcpConfig.mcpServers as Record<string, unknown> | undefined)?.relay as
    | { command?: string; args?: string[] }
    | undefined;
  if (!relay?.command) return [];

  const overrides = [`mcp_servers.relay.command="${relay.command}"`];
  if (Array.isArray(relay.args)) {
    overrides.push(`mcp_servers.relay.args=${JSON.stringify(relay.args)}`);
  }
  return overrides;
}

function stringifyCodexValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value);
  }
}

function formatMcpResult(result: unknown): string {
  if (!result || typeof result !== "object") {
    return stringifyCodexValue(result);
  }

  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return stringifyCodexValue(result);
  }

  const blocks = content
    .map((block) => {
      if (!block || typeof block !== "object") return stringifyCodexValue(block);
      if ((block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string") {
        return (block as { text: string }).text;
      }
      return stringifyCodexValue(block);
    })
    .filter((text) => text.trim().length > 0);

  return blocks.length > 0 ? blocks.join("\n\n") : stringifyCodexValue(result);
}

export class CodexProvider extends EventEmitter {
  readonly id: CopilotProviderId = "codex";
  private sessions = new Map<string, InternalSession>();

  async checkHealth(): Promise<CopilotProviderHealth> {
    const which = spawnSync("which", ["codex"], { timeout: 4000 });
    if (which.status !== 0) {
      return { providerId: this.id, status: "not_installed", cliVersion: null, error: null };
    }
    const version = spawnSync("codex", ["--version"], {
      timeout: 4000,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    if (version.status !== 0) {
      return {
        providerId: this.id,
        status: "error",
        cliVersion: null,
        error: "Could not run `codex --version`",
      };
    }
    const cliVersion = version.stdout.toString().trim().split("\n")[0] || null;
    return { providerId: this.id, status: "ready", cliVersion, error: null };
  }

  startSession(sessionId: string, opts: CopilotSessionOptions): void {
    if (this.sessions.has(sessionId)) {
      this.stopSession(sessionId);
    }
    this.sessions.set(sessionId, {
      id: sessionId,
      cwd: opts.cwd ?? process.cwd(),
      systemPrompt: opts.systemPrompt ?? null,
      conversationId: opts.conversationId ?? null,
      process: null,
      mcpConfig: (opts.mcpConfig as Record<string, unknown> | undefined) ?? null,
      status: "idle",
    });
  }

  async sendMessage(sessionId: string, text: string, opts: CopilotSendOptions = {}): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Copilot session not found: ${sessionId}`);
    if (session.status === "stopped") throw new Error(`Copilot session ${sessionId} is stopped`);

    if (session.process && session.process.exitCode === null) {
      session.process.kill("SIGTERM");
    }

    session.status = "busy";

    const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const args = session.conversationId
      ? ["exec", "resume", "--json", "--skip-git-repo-check", session.conversationId]
      : ["exec", "--json", "--skip-git-repo-check"];

    args.push("-c", 'approval_policy="never"');
    args.push("-c", 'sandbox_mode="danger-full-access"');

    // Per-turn model + reasoning-effort overrides. Codex takes the model
    // via -m and reasoning effort via a -c config override. Unknown effort
    // values are dropped rather than passed blindly to the CLI.
    if (opts.model) {
      args.push("-m", opts.model);
    }
    if (opts.reasoningEffort && CODEX_REASONING_EFFORTS.has(opts.reasoningEffort)) {
      args.push("-c", `model_reasoning_effort="${opts.reasoningEffort}"`);
    }

    for (const override of codexMcpOverrides(session.mcpConfig)) {
      args.push("-c", override);
    }

    const prompt = session.conversationId
      ? text
      : buildInitialPrompt(session.systemPrompt, text);
    args.push(prompt);

    // Ground-truth spawn log (skip the final prompt — it's already
    // captured by the dbgApi copilotMessage line). Shows exactly which
    // -m and -c model_reasoning_effort values made it to the CLI.
    console.log(
      `[copilot:codex:${sessionId}] spawn codex ${summarizeCodexArgs(args.slice(0, -1))}`,
    );

    const proc = spawn("codex", args, {
      cwd: session.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    session.process = proc;

    let lineBuffer = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        for (const part of this.parseJsonLine(line, session)) {
          this.emit("stream", sessionId, part, messageId);
        }
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.error(`[copilot:codex:${sessionId}] ${text}`);
    });

    proc.on("close", () => {
      if (lineBuffer.trim()) {
        for (const part of this.parseJsonLine(lineBuffer, session)) {
          this.emit("stream", sessionId, part, messageId);
        }
        lineBuffer = "";
      }
      if (session.status !== "stopped") session.status = "idle";
      this.emit("done", sessionId);
    });

    proc.on("error", (err) => {
      console.error(`[copilot:codex:${sessionId}] spawn error: ${err.message}`);
      this.emit(
        "stream",
        sessionId,
        { type: "error", content: `Failed to start codex CLI: ${err.message}` },
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

  getConversationId(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.conversationId ?? null;
  }

  parseJsonLine(line: string, session: InternalSession): CopilotMessagePart[] {
    let parsed: CodexStreamEvent;
    try {
      parsed = JSON.parse(line) as CodexStreamEvent;
    } catch {
      return line.trim() ? [{ type: "text", content: line }] : [];
    }

    if (parsed.type === "thread.started") {
      session.conversationId = parsed.thread_id;
      return [];
    }

    if (parsed.type !== "item.started" && parsed.type !== "item.completed") {
      return [];
    }

    const item = parsed.item;
    if (item.type === "agent_message" && parsed.type === "item.completed" && item.text) {
      return [{ type: "text", content: item.text }];
    }

    if (item.type === "command_execution") {
      if (parsed.type === "item.started" && item.command) {
        return [
          {
            type: "tool_use",
            toolName: "command_execution",
            toolInput: item.command,
            content: item.command,
          },
        ];
      }
      if (parsed.type === "item.completed") {
        const output = item.aggregated_output?.trim();
        const suffix = item.exit_code == null ? "" : `\n(exit ${item.exit_code})`;
        return [
          {
            type: "tool_result",
            toolName: "command_execution",
            content: `${output && output.length > 0 ? output : "(no output)"}${suffix}`,
          },
        ];
      }
    }

    if (item.type === "mcp_tool_call") {
      const toolName =
        typeof item.server === "string" && typeof item.tool === "string"
          ? `${item.server}.${item.tool}`
          : typeof item.tool === "string"
            ? item.tool
            : "mcp_tool_call";

      if (parsed.type === "item.started") {
        const input = stringifyCodexValue(item.arguments ?? {});
        return [
          {
            type: "tool_use",
            toolName,
            toolInput: input,
            content: input,
          },
        ];
      }

      const errorMessage =
        item.error && typeof item.error.message === "string" ? item.error.message.trim() : "";
      const resultBody =
        errorMessage.length > 0
          ? `Error: ${errorMessage}`
          : formatMcpResult(item.result ?? "(no output)");
      return [
        {
          type: "tool_result",
          toolName,
          content: resultBody,
        },
      ];
    }

    return [];
  }

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
