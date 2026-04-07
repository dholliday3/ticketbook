import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  _resetDbCacheForTests,
  bumpCopilotConversation,
  deleteCopilotConversation,
  getCopilotConversation,
  listCopilotConversations,
  recordCopilotConversation,
} from "./db.js";

describe("copilot_conversations DB ops", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ticketbook-db-"));
    _resetDbCacheForTests();
  });

  afterEach(async () => {
    _resetDbCacheForTests();
    await rm(dir, { recursive: true, force: true });
  });

  it("list returns empty array when nothing recorded", () => {
    expect(listCopilotConversations(dir)).toEqual([]);
  });

  it("record + list roundtrips a conversation", () => {
    recordCopilotConversation(dir, { id: "abc-1", title: "First chat" });
    const rows = listCopilotConversations(dir);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "abc-1",
      title: "First chat",
      message_count: 1,
    });
    expect(typeof rows[0].created_at).toBe("number");
    expect(typeof rows[0].updated_at).toBe("number");
  });

  it("getCopilotConversation returns null for unknown id and the row otherwise", () => {
    expect(getCopilotConversation(dir, "missing")).toBeNull();
    recordCopilotConversation(dir, { id: "abc-2", title: "Hello" });
    const row = getCopilotConversation(dir, "abc-2");
    expect(row).not.toBeNull();
    expect(row?.id).toBe("abc-2");
  });

  it("record is INSERT OR IGNORE — second call with same id does not overwrite", () => {
    recordCopilotConversation(dir, { id: "abc-3", title: "Original" });
    recordCopilotConversation(dir, { id: "abc-3", title: "Different" });
    const row = getCopilotConversation(dir, "abc-3");
    expect(row?.title).toBe("Original");
  });

  it("bumpCopilotConversation increments message_count and updates updated_at", async () => {
    recordCopilotConversation(dir, { id: "abc-4", title: "Bumpable" });
    const before = getCopilotConversation(dir, "abc-4");
    expect(before?.message_count).toBe(1);

    // Sleep a millisecond so updated_at actually changes
    await new Promise((r) => setTimeout(r, 5));

    bumpCopilotConversation(dir, "abc-4");
    const after = getCopilotConversation(dir, "abc-4");
    expect(after?.message_count).toBe(2);
    expect(after!.updated_at).toBeGreaterThan(before!.updated_at);
  });

  it("bumpCopilotConversation is a no-op for unknown ids", () => {
    bumpCopilotConversation(dir, "does-not-exist");
    expect(listCopilotConversations(dir)).toEqual([]);
  });

  it("list orders by updated_at desc", async () => {
    recordCopilotConversation(dir, { id: "old", title: "Old" });
    await new Promise((r) => setTimeout(r, 5));
    recordCopilotConversation(dir, { id: "mid", title: "Mid" });
    await new Promise((r) => setTimeout(r, 5));
    recordCopilotConversation(dir, { id: "new", title: "New" });

    expect(listCopilotConversations(dir).map((r) => r.id)).toEqual([
      "new",
      "mid",
      "old",
    ]);

    // Bumping the oldest moves it to the front.
    await new Promise((r) => setTimeout(r, 5));
    bumpCopilotConversation(dir, "old");
    expect(listCopilotConversations(dir).map((r) => r.id)).toEqual([
      "old",
      "new",
      "mid",
    ]);
  });

  it("deleteCopilotConversation removes the row", () => {
    recordCopilotConversation(dir, { id: "abc-5", title: "Doomed" });
    expect(listCopilotConversations(dir)).toHaveLength(1);
    deleteCopilotConversation(dir, "abc-5");
    expect(listCopilotConversations(dir)).toEqual([]);
  });
});
