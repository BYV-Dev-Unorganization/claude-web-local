import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sqlite, nowIso } from "./db.js";
import { createConversationBranch } from "./conversation-branches.js";

describe("conversation branch persistence", () => {
  let conversationId = "";
  let firstMessageId = "";
  let secondMessageId = "";
  let thirdMessageId = "";

  beforeEach(() => {
    conversationId = randomUUID();
    firstMessageId = randomUUID();
    secondMessageId = randomUUID();
    thirdMessageId = randomUUID();
    const timestamp = nowIso();
    sqlite.prepare("INSERT INTO conversations (id, title, model_alias, status, created_at, updated_at) VALUES (?, 'Branch source', 'sonnet', 'active', ?, ?)")
      .run(conversationId, timestamp, timestamp);
    const insert = sqlite.prepare(`
      INSERT INTO messages (id, conversation_id, parent_message_id, turn_id, role, status, content, model_alias, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, 'completed', ?, 'sonnet', ?, ?)
    `);
    insert.run(firstMessageId, conversationId, null, "turn-1", "user", "Original prompt", timestamp, timestamp);
    insert.run(secondMessageId, conversationId, firstMessageId, "turn-1", "assistant", "Original response", timestamp, timestamp);
    insert.run(thirdMessageId, conversationId, secondMessageId, "turn-2", "user", "Next question", timestamp, timestamp);
  });

  afterEach(() => {
    sqlite.prepare("DELETE FROM conversations WHERE parent_conversation_id = ?").run(conversationId);
    sqlite.prepare("DELETE FROM conversations WHERE id = ?").run(conversationId);
  });

  it("copies only the selected message prefix and rewires parent links", () => {
    const branch = createConversationBranch(conversationId, secondMessageId);
    expect(branch.copiedMessages).toBe(2);
    expect(branch.parentConversationId).toBe(conversationId);
    expect(sqlite.prepare("SELECT parent_conversation_id, branch_message_id FROM conversations WHERE id = ?").get(branch.id))
      .toEqual({ parent_conversation_id: conversationId, branch_message_id: secondMessageId });
    const copied = sqlite.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC")
      .all(branch.id) as Array<{ id: string; parent_message_id: string | null; turn_id: string; content: string }>;
    expect(copied).toHaveLength(2);
    expect(copied.map((message) => message.content)).toEqual(["Original prompt", "Original response"]);
    expect(copied[0]!.parent_message_id).toBeNull();
    expect(copied[1]!.parent_message_id).toBe(copied[0]!.id);
    expect(copied[0]!.turn_id).toBe(copied[1]!.turn_id);
    expect(copied.some((message) => message.id === firstMessageId || message.id === secondMessageId)).toBe(false);
  });

  it("creates an empty branch before the first message", () => {
    const branch = createConversationBranch(conversationId, null);
    expect(branch.copiedMessages).toBe(0);
    expect(sqlite.prepare("SELECT parent_conversation_id, branch_message_id FROM conversations WHERE id = ?").get(branch.id))
      .toEqual({ parent_conversation_id: conversationId, branch_message_id: null });
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?").get(branch.id))
      .toEqual({ count: 0 });
  });

  it("rejects a branch point belonging to a different conversation", () => {
    expect(() => createConversationBranch(conversationId, randomUUID()))
      .toThrow("does not belong to the conversation");
  });
});
