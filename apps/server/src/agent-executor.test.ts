import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "./config.js";
import { sqlite, nowIso } from "./db.js";
import { createWorkspace, readWorkspaceFile, type WorkspaceRecord } from "./workspace.js";
import { decideApproval, getTask, startTask, transitionTask } from "./agent-runtime.js";
import { executeTaskTool } from "./agent-executor.js";

function insertTask(executionMode = "approve-each"): string {
  const id = randomUUID();
  const timestamp = nowIso();
  sqlite.prepare(`
    INSERT INTO tasks (
      id, title, description, status, task_type, model_alias, execution_mode,
      iteration_limit, time_limit_seconds, created_at, updated_at
    ) VALUES (?, 'Tool execution test', 'Exercise permission checks', 'running',
      'coding', 'sonnet', ?, 5, 120, ?, ?)
  `).run(id, executionMode, timestamp, timestamp);
  return id;
}

describe("permission-gated task tool execution", () => {
  let taskId = "";
  let workspace: WorkspaceRecord;

  beforeEach(async () => {
    taskId = insertTask();
    workspace = await createWorkspace("Agent executor test");
  });

  afterEach(async () => {
    sqlite.prepare("DELETE FROM tasks").run();
    await fs.rm(path.join(config.workspacePath, workspace.relative_path), { recursive: true, force: true });
    sqlite.prepare("DELETE FROM workspaces WHERE id = ?").run(workspace.id);
  });

  it("does not run a mutating tool before approval, then consumes one exact approval", async () => {
    const input = { path: "src/generated.ts", content: "export const answer = 42;\n" };
    const waiting = await executeTaskTool(taskId, workspace.id, "workspace.write_file", input);
    expect(waiting.status).toBe("waiting_approval");
    if (waiting.status !== "waiting_approval") throw new Error("Expected an approval request.");
    expect(getTask(taskId)?.status).toBe("waiting_approval");
    await expect(readWorkspaceFile(workspace, input.path)).rejects.toThrow();

    const approval = decideApproval(waiting.approvalId, true, "The file content is expected.");
    expect(approval.status).toBe("approved");
    expect(getTask(taskId)?.status).toBe("queued");
    startTask(taskId);

    const completed = await executeTaskTool(taskId, workspace.id, "workspace.write_file", input);
    expect(completed.status).toBe("completed");
    expect(await readWorkspaceFile(workspace, input.path)).toBe(input.content);
    expect(sqlite.prepare("SELECT status FROM approvals WHERE id = ?").get(waiting.approvalId))
      .toEqual({ status: "consumed" });
    const invocations = sqlite.prepare("SELECT status FROM tool_invocations WHERE task_id = ? ORDER BY started_at, id")
      .all(taskId) as Array<{ status: string }>;
    expect(invocations.map((item) => item.status)).toContain("approved");
    expect(invocations.map((item) => item.status)).toContain("completed");
  });

  it("blocks mutating tools in restricted and automatic modes without an allow-list", async () => {
    const restrictedTaskId = insertTask("restricted");
    await expect(executeTaskTool(restrictedTaskId, workspace.id, "workspace.write_file", {
      path: "blocked.txt", content: "must not be written"
    })).rejects.toThrow("no configured mutation allow-list");
    expect(getTask(restrictedTaskId)?.status).toBe("running");
    expect(await fs.access(path.join(config.workspacePath, workspace.relative_path, "blocked.txt")).then(() => true).catch(() => false)).toBe(false);
  });

  it("allows read-only tools in plan mode and persists their invocation", async () => {
    const planTaskId = insertTask("plan");
    const result = await executeTaskTool(planTaskId, workspace.id, "workspace.list", {});
    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("Expected a read-only tool result.");
    expect(result.output).toEqual({ files: [] });
    const invocation = sqlite.prepare("SELECT status FROM tool_invocations WHERE task_id = ?").get(planTaskId);
    expect(invocation).toEqual({ status: "completed" });
  });

  it("rejects execution outside the running state and invalid tool input", async () => {
    transitionTask(taskId, "paused");
    await expect(executeTaskTool(taskId, workspace.id, "workspace.list", {}))
      .rejects.toThrow("must be running");
  });
});
