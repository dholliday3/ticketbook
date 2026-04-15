import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  _resetDbCacheForTests,
  appendCopilotMessage,
  bumpCopilotConversation,
  deleteCopilotConversation,
  getCopilotConversation,
  getCopilotConversationByProviderConversationId,
  listCopilotConversations,
  listCopilotMessages,
  recordCopilotConversation,
} from "./db.js";

describe("copilot conversation persistence", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "relay-db-"));
    _resetDbCacheForTests();
  });

  afterEach(async () => {
    _resetDbCacheForTests();
    await rm(dir, { recursive: true, force: true });
  });

  it("records provider ownership and returns the persisted conversation row", () => {
    const row = recordCopilotConversation(dir, {
      providerId: "claude-code",
      providerConversationId: "conv-1",
      title: "First chat",
    });
    expect(row).toMatchObject({
      id: "claude-code:conv-1",
      provider_id: "claude-code",
      provider_conversation_id: "conv-1",
      title: "First chat",
      message_count: 0,
    });
    expect(getCopilotConversation(dir, row.id)?.provider_id).toBe("claude-code");
  });

  it("finds a conversation by provider-native conversation id", () => {
    recordCopilotConversation(dir, {
      providerId: "codex",
      providerConversationId: "thread-123",
      title: "Codex chat",
    });
    expect(
      getCopilotConversationByProviderConversationId(dir, "codex", "thread-123"),
    ).toMatchObject({
      id: "codex:thread-123",
      provider_id: "codex",
    });
  });

  it("lists conversations filtered by provider", () => {
    recordCopilotConversation(dir, {
      providerId: "claude-code",
      providerConversationId: "conv-1",
      title: "Claude",
    });
    recordCopilotConversation(dir, {
      providerId: "codex",
      providerConversationId: "thread-1",
      title: "Codex",
    });
    expect(listCopilotConversations(dir)).toHaveLength(2);
    expect(listCopilotConversations(dir, "claude-code").map((row) => row.id)).toEqual([
      "claude-code:conv-1",
    ]);
    expect(listCopilotConversations(dir, "codex").map((row) => row.id)).toEqual([
      "codex:thread-1",
    ]);
  });

  it("bumps message_count and updated_at for an existing conversation", async () => {
    const row = recordCopilotConversation(dir, {
      providerId: "claude-code",
      providerConversationId: "conv-2",
      title: "Bumpable",
    });
    const before = getCopilotConversation(dir, row.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    bumpCopilotConversation(dir, row.id);
    const after = getCopilotConversation(dir, row.id);
    expect(before?.message_count).toBe(0);
    expect(after?.message_count).toBe(1);
    expect(after!.updated_at).toBeGreaterThan(before!.updated_at);
  });

  it("stores normalized transcript messages in order", () => {
    const row = recordCopilotConversation(dir, {
      providerId: "codex",
      providerConversationId: "thread-2",
      title: "Transcript",
    });
    appendCopilotMessage(dir, {
      id: "user-1",
      conversationId: row.id,
      role: "user",
      parts: [{ type: "text", content: "Hello" }],
      createdAt: 100,
    });
    appendCopilotMessage(dir, {
      id: "assistant-1",
      conversationId: row.id,
      role: "assistant",
      parts: [
        { type: "tool_use", content: "pwd", toolName: "command_execution", toolInput: "pwd" },
        { type: "tool_result", content: "/tmp", toolName: "command_execution" },
        { type: "text", content: "Done." },
      ],
      createdAt: 200,
    });

    expect(listCopilotMessages(dir, row.id)).toEqual([
      {
        id: "user-1",
        conversation_id: row.id,
        role: "user",
        parts: [{ type: "text", content: "Hello" }],
        created_at: 100,
        sort_order: 0,
      },
      {
        id: "assistant-1",
        conversation_id: row.id,
        role: "assistant",
        parts: [
          { type: "tool_use", content: "pwd", toolName: "command_execution", toolInput: "pwd" },
          { type: "tool_result", content: "/tmp", toolName: "command_execution" },
          { type: "text", content: "Done." },
        ],
        created_at: 200,
        sort_order: 1,
      },
    ]);
  });

  it("deletes transcript rows when deleting a conversation", () => {
    const row = recordCopilotConversation(dir, {
      providerId: "claude-code",
      providerConversationId: "conv-3",
      title: "Delete me",
    });
    appendCopilotMessage(dir, {
      id: "user-1",
      conversationId: row.id,
      role: "user",
      parts: [{ type: "text", content: "Hello" }],
      createdAt: 100,
    });
    deleteCopilotConversation(dir, row.id);
    expect(getCopilotConversation(dir, row.id)).toBeNull();
    expect(listCopilotMessages(dir, row.id)).toEqual([]);
  });
});
