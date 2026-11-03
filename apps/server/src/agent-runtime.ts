import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { config, type ModelAlias } from "./config.js";
import { sqlite, nowIso } from "./db.js";

export const taskStatuses = [
  "queued", "planning", "running", "waiting_approval", "waiting_input",
  "paused", "completed", "failed", "cancelled"
] as const;
export type TaskStatus = typeof taskStatuses[number];

export const taskTypes = ["general", "research", "coding", "browser", "scheduled"] as const;
export type TaskType = typeof taskTypes[number];
export const executionModes = ["plan", "approve-each", "auto", "restricted"] as const;

const taskInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(20000),
  projectId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  workspaceId: z.string().uuid().optional(),
  parentTaskId: z.string().uuid().optional(),
  taskType: z.enum(taskTypes).default("general"),
  modelAlias: z.enum(["fable", "opus", "sonnet", "haiku"]).default(config.AI_DEFAULT_MODEL),
  executionMode: z.enum(executionModes).default("approve-each"),
  iterationLimit: z.number().int().min(1).max(200).default(config.TASK_MAX_ITERATIONS),
  tokenBudget: z.number().int().positive().max(10_000_000).optional(),
  timeLimitSeconds: z.number().int().min(10).max(86400).default(config.TASK_MAX_RUNTIME_SECONDS)
});
export type CreateTaskInput = z.input<typeof taskInputSchema>;

type TaskRow = {
  id: string; project_id: string | null; conversation_id: string | null; parent_task_id: string | null;
  title: string; description: string; status: TaskStatus; task_type: TaskType; model_alias: ModelAlias;
  execution_mode: string; iteration_limit: number; token_budget: number | null;
  time_limit_seconds: number | null; checkpoint_json: string | null; workspace_id: string | null; created_at: string;
  started_at: string | null; completed_at: string | null; updated_at: string;
};

type ApprovalRow = {
  id: string; task_id: string; step_id: string | null; action_name: string;
  payload_hash: string; target_json: string; status: string; requested_at: string;
  expires_at: string; decided_at: string | null; decision_reason: string | null;
};

const transitions: Record<TaskStatus, readonly TaskStatus[]> = {
  queued: ["planning", "paused", "cancelled", "failed"],
  planning: ["running", "waiting_approval", "waiting_input", "paused", "failed", "cancelled"],
  running: ["waiting_approval", "waiting_input", "paused", "completed", "failed", "cancelled"],
  waiting_approval: ["queued", "paused", "failed", "cancelled"],
  waiting_input: ["queued", "paused", "failed", "cancelled"],
  paused: ["queued", "cancelled", "failed"],
  completed: [],
  failed: [],
  cancelled: []
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function approvalDigest(actionName: string, targetJson: string): string {
  return createHash("sha256").update(actionName).update("\0").update(targetJson).digest("hex");
}

export function recordTaskEvent(taskId: string, eventType: string, payload: unknown): void {
  const row = sqlite.prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM task_events WHERE task_id = ?")
    .get(taskId) as { sequence: number };
  sqlite.prepare("INSERT INTO task_events (id, task_id, sequence, event_type, payload_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(randomUUID(), taskId, row.sequence + 1, eventType, canonicalJson(payload), nowIso());
}

function transitionWithinTransaction(taskId: string, nextStatus: TaskStatus, reason?: string): TaskRow {
  const task = sqlite.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as TaskRow | undefined;
  if (!task) throw new Error("Task not found.");
  if (!transitions[task.status].includes(nextStatus)) {
    throw new Error("Invalid task transition: " + task.status + " -> " + nextStatus + ".");
  }
  const timestamp = nowIso();
  const startedAt = nextStatus === "running" && !task.started_at ? timestamp : task.started_at;
  const completedAt = ["completed", "failed", "cancelled"].includes(nextStatus) ? timestamp : null;
  sqlite.prepare("UPDATE tasks SET status = ?, started_at = ?, completed_at = ?, updated_at = ? WHERE id = ?")
    .run(nextStatus, startedAt, completedAt, timestamp, taskId);
  recordTaskEvent(taskId, "task.status", { from: task.status, to: nextStatus, ...(reason ? { reason } : {}) });
  return sqlite.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as TaskRow;
}

export function createTask(input: CreateTaskInput): TaskRow {
  const body = taskInputSchema.parse(input);
  if (!config.models[body.modelAlias]) throw new Error("The selected model alias is not configured.");
  if (body.projectId && !sqlite.prepare("SELECT id FROM projects WHERE id = ? AND status = 'active'").get(body.projectId)) {
    throw new Error("Project not found or inactive.");
  }
  if (body.conversationId && !sqlite.prepare("SELECT id FROM conversations WHERE id = ?").get(body.conversationId)) {
    throw new Error("Conversation not found.");
  }
  if (body.workspaceId && !sqlite.prepare("SELECT id FROM workspaces WHERE id = ?").get(body.workspaceId)) {
    throw new Error("Workspace not found.");
  }
  if (body.parentTaskId && !sqlite.prepare("SELECT id FROM tasks WHERE id = ?").get(body.parentTaskId)) {
    throw new Error("Parent task not found.");
  }

  const taskId = randomUUID();
  const timestamp = nowIso();
  const insert = sqlite.transaction(() => {
    sqlite.prepare(`
      INSERT INTO tasks (
        id, project_id, conversation_id, parent_task_id, workspace_id, title, description, status,
        task_type, model_alias, execution_mode, iteration_limit, token_budget,
        time_limit_seconds, checkpoint_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      taskId, body.projectId ?? null, body.conversationId ?? null, body.parentTaskId ?? null, body.workspaceId ?? null,
      body.title, body.description, body.taskType, body.modelAlias, body.executionMode,
      body.iterationLimit, body.tokenBudget ?? null, body.timeLimitSeconds, timestamp, timestamp
    );
    recordTaskEvent(taskId, "task.created", {
      taskType: body.taskType, modelAlias: body.modelAlias,
      executionMode: body.executionMode, iterationLimit: body.iterationLimit,
      timeLimitSeconds: body.timeLimitSeconds
    });
  });
  insert();
  return sqlite.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as TaskRow;
}

export function getTask(taskId: string): TaskRow | undefined {
  return sqlite.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as TaskRow | undefined;
}

export function listTasks(limit = 50, status?: TaskStatus): TaskRow[] {
  return (status
    ? sqlite.prepare("SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC LIMIT ?").all(status, limit)
    : sqlite.prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?").all(limit)) as TaskRow[];
}

export function transitionTask(taskId: string, nextStatus: TaskStatus, reason?: string): TaskRow {
  const run = sqlite.transaction(() => transitionWithinTransaction(taskId, nextStatus, reason));
  return run();
}

export function startTask(taskId: string): TaskRow {
  const transaction = sqlite.transaction(() => {
    transitionWithinTransaction(taskId, "planning", "Operator started task planning.");
    return transitionWithinTransaction(taskId, "running", "Task entered the running state.");
  });
  return transaction();
}

export function pauseTask(taskId: string): TaskRow {
  return transitionTask(taskId, "paused", "Paused by operator.");
}

export function resumeTask(taskId: string): TaskRow {
  return transitionTask(taskId, "queued", "Resumed by operator; eligible for a worker claim.");
}

export function cancelTask(taskId: string): TaskRow {
  return transitionTask(taskId, "cancelled", "Cancelled by operator.");
}

export function retryTask(taskId: string): TaskRow {
  const original = getTask(taskId);
  if (!original) throw new Error("Task not found.");
  if (!["failed", "cancelled"].includes(original.status)) {
    throw new Error("Only failed or cancelled tasks can be retried.");
  }
  return createTask({
    title: original.title,
    description: original.description,
    ...(original.project_id ? { projectId: original.project_id } : {}),
    ...(original.conversation_id ? { conversationId: original.conversation_id } : {}),
    ...(original.workspace_id ? { workspaceId: original.workspace_id } : {}),
    parentTaskId: original.parent_task_id ?? original.id,
    taskType: original.task_type,
    modelAlias: original.model_alias,
    executionMode: original.execution_mode as typeof executionModes[number],
    iterationLimit: original.iteration_limit,
    ...(original.token_budget !== null ? { tokenBudget: original.token_budget } : {}),
    timeLimitSeconds: original.time_limit_seconds ?? config.TASK_MAX_RUNTIME_SECONDS
  });
}

export function requestTaskApproval(input: {
  taskId: string; actionName: string; target: unknown; stepId?: string; expiresInSeconds?: number;
}): ApprovalRow {
  const schema = z.object({
    taskId: z.string().uuid(),
    actionName: z.string().trim().min(1).max(160),
    target: z.unknown(),
    stepId: z.string().uuid().optional(),
    expiresInSeconds: z.number().int().min(30).max(86400).default(900)
  });
  const body = schema.parse(input);
  const task = getTask(body.taskId);
  if (!task) throw new Error("Task not found.");
  if (!["planning", "running"].includes(task.status)) {
    throw new Error("Approval can only be requested for a planning or running task.");
  }
  if (body.stepId && !sqlite.prepare("SELECT id FROM task_steps WHERE id = ? AND task_id = ?").get(body.stepId, body.taskId)) {
    throw new Error("Task step not found.");
  }
  const approvalId = randomUUID();
  const requestedAt = nowIso();
  const expiresAt = new Date(Date.now() + body.expiresInSeconds * 1000).toISOString();
  const targetJson = canonicalJson(body.target);
  const payloadHash = approvalDigest(body.actionName, targetJson);
  const transaction = sqlite.transaction(() => {
    sqlite.prepare(`
      INSERT INTO approvals (
        id, task_id, step_id, action_name, payload_hash, target_json, status,
        requested_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(approvalId, body.taskId, body.stepId ?? null, body.actionName, payloadHash, targetJson, requestedAt, expiresAt);
    transitionWithinTransaction(body.taskId, "waiting_approval", "Sensitive action requires operator approval.");
    recordTaskEvent(body.taskId, "approval.requested", { approvalId, actionName: body.actionName, payloadHash, expiresAt });
  });
  transaction();
  return sqlite.prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId) as ApprovalRow;
}

export function listApprovals(status: "pending" | "approved" | "rejected" | "expired" = "pending"): ApprovalRow[] {
  const timestamp = nowIso();
  if (status === "pending") {
    const expire = sqlite.transaction(() => {
      const expired = sqlite.prepare("SELECT id, task_id FROM approvals WHERE status = 'pending' AND expires_at <= ?").all(timestamp) as Array<{ id: string; task_id: string }>;
      for (const approval of expired) {
        sqlite.prepare("UPDATE approvals SET status = 'expired' WHERE id = ?").run(approval.id);
        const task = getTask(approval.task_id);
        if (task?.status === "waiting_approval") {
          transitionWithinTransaction(task.id, "paused", "Approval expired; operator review is required.");
        }
      }
    });
    expire();
  }
  return sqlite.prepare("SELECT * FROM approvals WHERE status = ? ORDER BY requested_at DESC LIMIT 100").all(status) as ApprovalRow[];
}

export function decideApproval(approvalId: string, approved: boolean, reason?: string): ApprovalRow {
  const transaction = sqlite.transaction(() => {
    const approval = sqlite.prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId) as ApprovalRow | undefined;
    if (!approval) throw new Error("Approval not found.");
    if (approval.status !== "pending") throw new Error("Approval is no longer pending.");
    if (Date.parse(approval.expires_at) <= Date.now()) {
      sqlite.prepare("UPDATE approvals SET status = 'expired' WHERE id = ?").run(approvalId);
      const task = getTask(approval.task_id);
      if (task?.status === "waiting_approval") transitionWithinTransaction(task.id, "paused", "Approval expired.");
      return { expired: true as const };
    }
    if (approvalDigest(approval.action_name, approval.target_json) !== approval.payload_hash) {
      throw new Error("Approval payload integrity check failed.");
    }
    const task = getTask(approval.task_id);
    if (!task || task.status !== "waiting_approval") throw new Error("The associated task is not waiting for approval.");
    const timestamp = nowIso();
    const status = approved ? "approved" : "rejected";
    sqlite.prepare("UPDATE approvals SET status = ?, decided_at = ?, decision_reason = ? WHERE id = ?")
      .run(status, timestamp, reason?.slice(0, 1000) ?? null, approvalId);
    if (approved) {
      sqlite.prepare("UPDATE tool_invocations SET status = 'approved', completed_at = ? WHERE task_id = ? AND tool_name = ? AND input_json = ? AND status = 'waiting_approval'")
        .run(timestamp, task.id, approval.action_name, approval.target_json);
    }
    transitionWithinTransaction(task.id, approved ? "queued" : "paused",
      approved ? "Operator approved the exact pending action." : "Operator rejected the pending action.");
    recordTaskEvent(task.id, "approval." + status, { approvalId, reason: reason?.slice(0, 1000) ?? null });
    return { expired: false as const, approval: sqlite.prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId) as ApprovalRow };
  });
  const result = transaction();
  if (result.expired) throw new Error("Approval has expired.");
  return result.approval;
}

export function listTaskEvents(taskId: string, afterSequence = 0, limit = 100) {
  if (!getTask(taskId)) throw new Error("Task not found.");
  return sqlite.prepare("SELECT * FROM task_events WHERE task_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?")
    .all(taskId, afterSequence, limit);
}

export function listTaskSteps(taskId: string) {
  if (!getTask(taskId)) throw new Error("Task not found.");
  return sqlite.prepare("SELECT * FROM task_steps WHERE task_id = ? ORDER BY step_number ASC").all(taskId);
}
