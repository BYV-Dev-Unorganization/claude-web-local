import { randomUUID } from "node:crypto";
import { sqlite, nowIso } from "./db.js";

type ConversationRow = {
  id: string; project_id: string | null; title: string; model_alias: string; status: string;
};
type MessageRow = {
  id: string; conversation_id: string; parent_message_id: string | null; turn_id: string;
  role: string; status: string; content: string; model_alias: string | null; usage_json: string | null;
  created_at: string; completed_at: string | null;
};

export function createConversationBranch(conversationId: string, throughMessageId: string | null) {
  const source = sqlite.prepare("SELECT * FROM conversations WHERE id = ? AND status = 'active'")
    .get(conversationId) as ConversationRow | undefined;
  if (!source) throw new Error("Conversation not found or archived.");

  const sourceMessages = sqlite.prepare(
    "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC"
  ).all(conversationId) as MessageRow[];
  let messagesToCopy: MessageRow[];
  if (throughMessageId === null) {
    messagesToCopy = [];
  } else {
    const targetIndex = sourceMessages.findIndex((message) => message.id === throughMessageId);
    if (targetIndex < 0) throw new Error("Branch point message does not belong to the conversation.");
    messagesToCopy = sourceMessages.slice(0, targetIndex + 1);
  }

  const branchId = randomUUID();
  const title = (source.title + " (branch)").slice(0, 160);
  const timestamp = nowIso();
  const messageIds = new Map<string, string>();
  const turnIds = new Map<string, string>();

  const transaction = sqlite.transaction(() => {
    sqlite.prepare(
      "INSERT INTO conversations (id, project_id, parent_conversation_id, branch_message_id, title, model_alias, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)"
    ).run(branchId, source.project_id, conversationId, throughMessageId, title, source.model_alias, timestamp, timestamp);

    const insertMessage = sqlite.prepare(`
      INSERT INTO messages (
        id, conversation_id, parent_message_id, turn_id, role, status, content,
        model_alias, usage_json, created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    messagesToCopy.forEach((message, index) => {
      const newMessageId = randomUUID();
      const newTurnId = turnIds.get(message.turn_id) ?? randomUUID();
      turnIds.set(message.turn_id, newTurnId);
      messageIds.set(message.id, newMessageId);
      const parentId = message.parent_message_id
        ? messageIds.get(message.parent_message_id) ?? message.parent_message_id
        : null;
      const offsetTimestamp = new Date(Date.parse(timestamp) + index).toISOString();
      insertMessage.run(
        newMessageId, branchId, parentId, newTurnId, message.role, message.status,
        message.content, message.model_alias, message.usage_json, offsetTimestamp,
        message.completed_at ? offsetTimestamp : null
      );
    });
  });
  transaction();
  return {
    id: branchId,
    title,
    parentConversationId: conversationId,
    throughMessageId,
    copiedMessages: messagesToCopy.length,
    createdAt: timestamp
  };
}
