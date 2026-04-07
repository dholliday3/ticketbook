/**
 * Reads prior conversation history from Claude Code's local JSONL store.
 *
 * Claude Code persists every conversation as a JSONL file at
 *   ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
 *
 * where <encoded-cwd> is the working directory with `/` replaced by `-`.
 * Each line is one event in the conversation; the line types we care about
 * are `user` (with string OR array content) and `assistant` (with array
 * content of text/thinking/tool_use blocks). We ignore Claude Code's
 * internal bookkeeping events (queue-operation, attachment, last-prompt).
 *
 * Tool results in Claude Code's store are emitted as user messages with
 * array content (`{ type: "tool_result", tool_use_id, content }`). They're
 * really part of the agent's tool-use round trip rather than a separate
 * user message, so we attach them to the *prior* assistant message as
 * additional parts. The result is one logical message per agent turn,
 * matching how the live streaming flow renders.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CopilotMessagePart } from "./types.js";

export interface HistoricalMessage {
  /** Stable id derived from the JSONL line uuid (or a fallback). */
  id: string;
  role: "user" | "assistant";
  parts: CopilotMessagePart[];
  /** Unix milliseconds; sorted chronological. */
  createdAt: number;
}

/**
 * Compute Claude Code's project directory name for a given cwd. Claude Code
 * encodes the path by replacing `/` with `-`, so
 *   /Users/danielholliday/workspace/worktrees/ticketbook/app-copilot
 * becomes
 *   -Users-danielholliday-workspace-worktrees-ticketbook-app-copilot
 */
export function encodeCwdForClaude(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

/** Absolute path to a conversation's JSONL file given the cwd + conversation id. */
export function claudeConversationPath(cwd: string, conversationId: string): string {
  return join(homedir(), ".claude", "projects", encodeCwdForClaude(cwd), `${conversationId}.jsonl`);
}

/**
 * Read and parse the JSONL history for a conversation. Returns an empty
 * array if the file doesn't exist (e.g., the user's running on a different
 * machine, or Claude Code's store was cleared). Skips malformed lines
 * silently.
 */
export async function loadConversationHistory(
  cwd: string,
  conversationId: string,
): Promise<HistoricalMessage[]> {
  const path = claudeConversationPath(cwd, conversationId);
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    // Most common: file doesn't exist on this machine. Return empty so
    // the UI shows the panel without prior history; the next turn will
    // still resume correctly because Claude Code is the source of truth.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return parseClaudeJsonl(raw);
}

/**
 * Visible for testing. Parses a Claude Code JSONL string into the
 * normalized HistoricalMessage[] shape.
 *
 * Algorithm: iterate lines in order, maintain a current "tail" assistant
 * message that subsequent tool_results can attach to. user-string lines
 * push a fresh user message and clear the tail. user-array lines (tool
 * results) append parts to the tail assistant. assistant lines push a
 * fresh assistant message and become the new tail.
 */
export function parseClaudeJsonl(raw: string): HistoricalMessage[] {
  const messages: HistoricalMessage[] = [];
  let tailAssistant: HistoricalMessage | null = null;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const type = entry.type as string | undefined;
    if (type !== "user" && type !== "assistant") continue;

    const message = entry.message as Record<string, unknown> | undefined;
    if (!message) continue;

    const uuid = (entry.uuid as string | undefined) ?? `hist-${messages.length}`;
    const timestamp = parseTimestamp(entry.timestamp);

    if (type === "user") {
      const content = message.content;
      if (typeof content === "string") {
        // Plain user text message — flush the tail and start a new one.
        messages.push({
          id: uuid,
          role: "user",
          parts: [{ type: "text", content }],
          createdAt: timestamp,
        });
        tailAssistant = null;
      } else if (Array.isArray(content)) {
        // Array content from a user line is almost always tool_result
        // blocks. Attach them to the prior assistant message so the round
        // trip renders as one logical agent turn.
        const parts = content.flatMap((block) =>
          parseUserContentBlock(block as Record<string, unknown>),
        );
        if (parts.length === 0) continue;
        if (tailAssistant) {
          tailAssistant.parts.push(...parts);
        } else {
          // Edge case: tool result with no preceding assistant (shouldn't
          // happen in practice but we still want to render it). Synthesize
          // an assistant wrapper so the user-side bubble doesn't claim it.
          const synthetic: HistoricalMessage = {
            id: uuid,
            role: "assistant",
            parts,
            createdAt: timestamp,
          };
          messages.push(synthetic);
          tailAssistant = synthetic;
        }
      }
      continue;
    }

    // assistant
    const content = message.content;
    if (!Array.isArray(content)) continue;
    const parts = content.flatMap((block) =>
      parseAssistantContentBlock(block as Record<string, unknown>),
    );
    if (parts.length === 0) continue;
    const newAssistant: HistoricalMessage = {
      id: uuid,
      role: "assistant",
      parts,
      createdAt: timestamp,
    };
    messages.push(newAssistant);
    tailAssistant = newAssistant;
  }

  return messages;
}

function parseAssistantContentBlock(
  block: Record<string, unknown>,
): CopilotMessagePart[] {
  const blockType = block.type as string | undefined;
  switch (blockType) {
    case "text":
      if (typeof block.text === "string" && block.text.length > 0) {
        return [{ type: "text", content: block.text }];
      }
      return [];
    case "thinking":
      if (typeof block.thinking === "string" && block.thinking.length > 0) {
        return [{ type: "thinking", content: block.thinking }];
      }
      return [];
    case "tool_use": {
      const input =
        typeof block.input === "string"
          ? block.input
          : JSON.stringify(block.input ?? {});
      return [
        {
          type: "tool_use",
          content: input,
          toolName: typeof block.name === "string" ? block.name : undefined,
          toolInput: input,
        },
      ];
    }
    default:
      return [];
  }
}

function parseUserContentBlock(block: Record<string, unknown>): CopilotMessagePart[] {
  const blockType = block.type as string | undefined;
  if (blockType !== "tool_result") return [];

  // tool_result.content can itself be a string OR an array of inner blocks
  // (each with their own type/text). Flatten to a single string body.
  let body = "";
  const content = block.content;
  if (typeof content === "string") {
    body = content;
  } else if (Array.isArray(content)) {
    body = content
      .map((inner: Record<string, unknown>) => {
        if (typeof inner.text === "string") return inner.text;
        return JSON.stringify(inner);
      })
      .join("\n");
  }
  return [
    {
      type: "tool_result",
      content: body,
      toolName:
        typeof block.tool_use_id === "string" ? block.tool_use_id : undefined,
    },
  ];
}

function parseTimestamp(ts: unknown): number {
  if (typeof ts === "string") {
    const ms = Date.parse(ts);
    if (Number.isFinite(ms)) return ms;
  }
  return 0;
}
