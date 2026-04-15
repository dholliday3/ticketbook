import { describe, it, expect } from "bun:test";
import {
  encodeCwdForClaude,
  parseClaudeJsonl,
  claudeConversationPath,
} from "./history.js";

/**
 * Parser tests for the Claude Code JSONL replay loader. Uses inline JSONL
 * fixtures based on real shapes captured from
 * ~/.claude/projects/<encoded-cwd>/<id>.jsonl during development.
 */

const userTextLine = JSON.stringify({
  type: "user",
  message: { role: "user", content: "List my in-progress tasks" },
  uuid: "u-1",
  timestamp: "2026-04-07T11:27:20.517Z",
});

const assistantThinkingToolLine = JSON.stringify({
  type: "assistant",
  message: {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "Let me check..." },
      {
        type: "tool_use",
        id: "toolu_abc",
        name: "mcp__relay__list_tasks",
        input: { status: "in-progress" },
      },
    ],
  },
  uuid: "a-1",
  timestamp: "2026-04-07T11:27:21.000Z",
});

const userToolResultLine = JSON.stringify({
  type: "user",
  message: {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: "toolu_abc",
        content: [{ type: "text", text: "3 task(s):\n[TKTB-042] ..." }],
      },
    ],
  },
  uuid: "u-2",
  timestamp: "2026-04-07T11:27:22.000Z",
});

const assistantTextLine = JSON.stringify({
  type: "assistant",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "You have 3 in-progress tasks..." }],
  },
  uuid: "a-2",
  timestamp: "2026-04-07T11:27:23.000Z",
});

describe("encodeCwdForClaude", () => {
  it("replaces slashes with dashes", () => {
    expect(encodeCwdForClaude("/Users/me/proj")).toBe("-Users-me-proj");
  });

  it("handles a worktree path", () => {
    expect(
      encodeCwdForClaude("/Users/danielholliday/workspace/worktrees/relay/app-copilot"),
    ).toBe("-Users-danielholliday-workspace-worktrees-relay-app-copilot");
  });

  it("strips trailing slashes before encoding", () => {
    // Regression: previously a trailing slash on the cwd became a trailing
    // dash in the encoded directory name, which doesn't match what Claude
    // Code stores on disk (it normalizes the cwd before writing).
    expect(encodeCwdForClaude("/Users/me/proj/")).toBe("-Users-me-proj");
    expect(encodeCwdForClaude("/Users/me/proj///")).toBe("-Users-me-proj");
  });
});

describe("claudeConversationPath", () => {
  it("builds the full ~/.claude/projects path", () => {
    const p = claudeConversationPath("/Users/me/proj", "abc-123");
    expect(p).toMatch(/\.claude\/projects\/-Users-me-proj\/abc-123\.jsonl$/);
  });
});

describe("parseClaudeJsonl", () => {
  it("returns empty array for empty input", () => {
    expect(parseClaudeJsonl("")).toEqual([]);
    expect(parseClaudeJsonl("\n\n")).toEqual([]);
  });

  it("parses a string-content user message into a user text part", () => {
    const messages = parseClaudeJsonl(userTextLine);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: "u-1",
      role: "user",
      parts: [{ type: "text", content: "List my in-progress tasks" }],
    });
  });

  it("parses an assistant thinking + tool_use line", () => {
    const messages = parseClaudeJsonl(assistantThinkingToolLine);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("assistant");
    expect(messages[0].parts).toHaveLength(2);
    expect(messages[0].parts[0]).toMatchObject({
      type: "thinking",
      content: "Let me check...",
    });
    expect(messages[0].parts[1]).toMatchObject({
      type: "tool_use",
      toolName: "mcp__relay__list_tasks",
    });
  });

  it("attaches tool_result from a user-array line to the prior assistant message", () => {
    const jsonl = [
      assistantThinkingToolLine,
      userToolResultLine,
      assistantTextLine,
    ].join("\n");
    const messages = parseClaudeJsonl(jsonl);
    // Should be 2 messages (the assistant tool turn + the assistant text turn).
    // The user tool_result is folded into the first assistant message.
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("assistant");
    expect(messages[0].parts).toHaveLength(3);
    expect(messages[0].parts[0].type).toBe("thinking");
    expect(messages[0].parts[1].type).toBe("tool_use");
    expect(messages[0].parts[2]).toMatchObject({
      type: "tool_result",
      content: "3 task(s):\n[TKTB-042] ...",
      toolName: "toolu_abc",
    });
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].parts[0]).toMatchObject({
      type: "text",
      content: "You have 3 in-progress tasks...",
    });
  });

  it("ignores Claude Code's internal bookkeeping line types", () => {
    const jsonl = [
      JSON.stringify({ type: "queue-operation", operation: "enqueue" }),
      JSON.stringify({ type: "attachment", attachment: { type: "deferred_tools_delta" } }),
      JSON.stringify({ type: "last-prompt", lastPrompt: "Hi" }),
      userTextLine,
    ].join("\n");
    const messages = parseClaudeJsonl(jsonl);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
  });

  it("skips malformed JSON lines", () => {
    const jsonl = ["not json", userTextLine, "{invalid"].join("\n");
    const messages = parseClaudeJsonl(jsonl);
    expect(messages).toHaveLength(1);
  });

  it("preserves chronological order", () => {
    const jsonl = [
      userTextLine,
      assistantThinkingToolLine,
      userToolResultLine,
      assistantTextLine,
    ].join("\n");
    const messages = parseClaudeJsonl(jsonl);
    expect(messages.map((m) => m.id)).toEqual(["u-1", "a-1", "a-2"]);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(messages[2].role).toBe("assistant");
  });

  it("handles a user tool_result with no preceding assistant by synthesizing one", () => {
    const messages = parseClaudeJsonl(userToolResultLine);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("assistant");
    expect(messages[0].parts[0].type).toBe("tool_result");
  });

  it("handles tool_result with string content (not array)", () => {
    const line = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            content: "plain text result",
          },
        ],
      },
      uuid: "u",
    });
    const messages = parseClaudeJsonl(line);
    expect(messages[0].parts[0]).toMatchObject({
      type: "tool_result",
      content: "plain text result",
    });
  });
});
