import { randomUUID } from "node:crypto";
import { sqlite, nowIso } from "./db.js";
import {
  approvalDigest, canonicalJson, getTask, recordTaskEvent, requestTaskApproval
} from "./agent-runtime.js";
import { executeTool, getTool } from "./tool-registry.js";
import { getWorkspace } from "./workspace.js";

export type TaskToolExecution =
  | { status: "waiting_approval"; approvalId: string; actionName: string; expiresAt: string }
  | { status: "completed"; invocationId: string; output: unknown };

function safeToolError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Tool execution failed.";
  return message
    .replace(/(sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+)/gi, "[REDACTED]")
    .slice(0, 1000);
}

export async function executeTaskTool(
  taskId: string,
  workspaceId: string,
  toolName: string,
  rawInput: unknown
): Promise<TaskToolExecution> {
  const task = getTask(taskId);
  if (!task) throw new Error("Task not found.");
  if (task.status !== "running") throw new Error("Task must be running before a tool can execute.");

  const workspace = getWorkspace(workspaceId);
  if (!workspace) throw new Error("Selected workspace not found.");

  const tool = getTool(toolName);
  if (!tool) throw new Error("Tool is not registered or enabled.");
  const parsed = tool.inputSchema.parse(rawInput);

  if (tool.permission === "workspace:read" && tool.requiresApproval) {
    throw new Error("Invalid tool manifest: a read tool cannot require mutation approval.");
  }
  if (tool.permission !== "workspace:read" && !tool.requiresApproval) {
    throw new Error("Invalid tool manifest: mutating tools must require explicit approval.");
  }

  const target = { workspaceId, input: parsed };
  const targetJson = canonicalJson(target);

  if (tool.requiresApproval) {
    if (task.execution_mode !== "approve-each") {
      throw new Error("Task policy blocks mutating tools; this task has no configured mutation allow-list.");
    }

    const now = nowIso();
    const candidates = sqlite.prepare(
      "SELECT * FROM approvals WHERE task_id = ? AND action_name = ? AND status = 'approved' ORDER BY requested_at DESC"
    ).all(taskId, toolName) as Array<{
      id: string; task_id: string; action_name: string; target_json: string;
      payload_hash: string; status: string; expires_at: string;
    }>;
    const approval = candidates.find((candidate) =>
      candidate.target_json === targetJson &&
      candidate.payload_hash === approvalDigest(toolName, targetJson) &&
      Date.parse(candidate.expires_at) > Date.parse(now)
    );

    if (!approval) {
      const pending = requestTaskApproval({ taskId, actionName: toolName, target });
      const invocationId = randomUUID();
      sqlite.prepare(
        "INSERT INTO tool_invocations (id, task_id, tool_name, input_json, status, started_at) VALUES (?, ?, ?, ?, 'waiting_approval', ?)"
      ).run(invocationId, taskId, toolName, pending.target_json, now);
      recordTaskEvent(taskId, "tool.waiting_approval", {
        invocationId, approvalId: pending.id, toolName, payloadHash: pending.payload_hash
      });
      return {
        status: "waiting_approval",
        approvalId: pending.id,
        actionName: toolName,
        expiresAt: pending.expires_at
      };
    }

    const consume = sqlite.transaction(() => {
      const current = sqlite.prepare("SELECT status, payload_hash, target_json FROM approvals WHERE id = ? AND task_id = ?")
        .get(approval.id, taskId) as { status: string; payload_hash: string; target_json: string } | undefined;
      if (!current || current.status !== "approved" ||
        current.target_json !== targetJson ||
        current.payload_hash !== approvalDigest(toolName, targetJson)) {
        throw new Error("The approved tool payload is no longer valid.");
      }
      sqlite.prepare("UPDATE approvals SET status = 'consumed' WHERE id = ?").run(approval.id);
      recordTaskEvent(taskId, "approval.consumed", { approvalId: approval.id, toolName });
    });
    consume();
  }

  const invocationId = randomUUID();
  const startedAt = nowIso();
  sqlite.prepare(
    "INSERT INTO tool_invocations (id, task_id, tool_name, input_json, status, started_at) VALUES (?, ?, ?, ?, 'running', ?)"
  ).run(invocationId, taskId, toolName, targetJson, startedAt);
  recordTaskEvent(taskId, "tool.started", { invocationId, toolName, permission: tool.permission });

  try {
    const output = await executeTool(toolName, parsed, workspace);
    const outputJson = JSON.stringify(output ?? null);
    const completedAt = nowIso();
    const finish = sqlite.transaction(() => {
      sqlite.prepare("UPDATE tool_invocations SET status = 'completed', output_json = ?, completed_at = ? WHERE id = ?")
        .run(outputJson, completedAt, invocationId);
      recordTaskEvent(taskId, "tool.completed", { invocationId, toolName, completedAt });
    });
    finish();
    return { status: "completed", invocationId, output };
  } catch (error) {
    const message = safeToolError(error);
    const failedAt = nowIso();
    const finish = sqlite.transaction(() => {
      sqlite.prepare("UPDATE tool_invocations SET status = 'failed', error_json = ?, completed_at = ? WHERE id = ?")
        .run(JSON.stringify({ message }), failedAt, invocationId);
      recordTaskEvent(taskId, "tool.failed", { invocationId, toolName, message });
    });
    finish();
    throw new Error(message);
  }
}
