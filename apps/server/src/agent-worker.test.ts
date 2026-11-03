import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sqlite, nowIso } from "./db.js";
import { config } from "./config.js";
import { createWorkspace, type WorkspaceRecord } from "./workspace.js";
import agentRoutes from "./agent-routes.js";
import { claimNextTask } from "./worker-queue.js";
import { runClaimedTask } from "./agent-worker.js";

function insertTask(iterationLimit = 8, workspaceId?: string): string {
  const id = randomUUID();
  const timestamp = nowIso();
  sqlite.prepare(`
    INSERT INTO tasks (
      id, title, description, status, task_type, model_alias, execution_mode,
      iteration_limit, time_limit_seconds, created_at, updated_at
    ) VALUES (?, 'Agent worker test', 'Summarize a small code task', 'queued',
      'general', 'sonnet', 'plan', ?, 120, ?, ?)
  `).run(id, iterationLimit, timestamp, timestamp);
  if (workspaceId) sqlite.prepare("UPDATE tasks SET workspace_id = ? WHERE id = ?").run(workspaceId, id);
  return id;
}

let temporaryWorkspace: WorkspaceRecord | null = null;
describe("durable autonomous agent worker", () => {
  afterEach(async () => {
    sqlite.prepare("DELETE FROM tasks").run();
    if (temporaryWorkspace) {
      await fs.rm(path.join(config.workspacePath, temporaryWorkspace.relative_path), { recursive: true, force: true });
      sqlite.prepare("DELETE FROM workspaces WHERE id = ?").run(temporaryWorkspace.id);
      temporaryWorkspace = null;
    }
  });

  it("plans, persists checkpoints, runs a final model turn, and completes the task", async () => {
    const taskId = insertTask();
    const claimed = claimNextTask("agent-test", 90);
    expect(claimed?.task.id).toBe(taskId);
    const complete = vi.fn()
      .mockResolvedValueOnce({
        text: JSON.stringify({
          summary: "Review the supplied task and provide a result.",
          steps: [{ title: "Analyze request", description: "Analyze the user goal." }],
          acceptanceCriteria: ["A concise answer is returned."]
        }),
        toolCalls: [], inputTokens: 12, outputTokens: 20
      })
      .mockResolvedValueOnce({
        text: "The task is complete.",
        toolCalls: [], inputTokens: 16, outputTokens: 18
      });
    await runClaimedTask(taskId, new AbortController().signal, complete);
    const task = sqlite.prepare("SELECT status, checkpoint_json FROM tasks WHERE id = ?").get(taskId) as {
      status: string; checkpoint_json: string;
    };
    expect(task.status).toBe("completed");
    const checkpoint = JSON.parse(task.checkpoint_json) as { iterations: number; finalText: string; plan: { steps: unknown[] } };
    expect(checkpoint.iterations).toBe(2);
    expect(checkpoint.finalText).toBe("The task is complete.");
    expect(checkpoint.plan.steps).toHaveLength(1);
    expect(sqlite.prepare("SELECT status FROM task_steps WHERE task_id = ?").get(taskId)).toEqual({ status: "completed" });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("continues a model tool call with the persisted result before producing the final answer", async () => {
    temporaryWorkspace = await createWorkspace("Agent worker loop test");
    const taskId = insertTask(8, temporaryWorkspace.id);
    claimNextTask("agent-tools-test", 90);
    const complete = vi.fn()
      .mockResolvedValueOnce({
        text: JSON.stringify({
          summary: "Inspect the selected workspace and report its files.",
          steps: [{ title: "List files", description: "Inspect the workspace contents.", tool: "workspace.list" }],
          acceptanceCriteria: ["The result reflects the actual workspace listing."]
        }),
        toolCalls: [], inputTokens: 10, outputTokens: 15
      })
      .mockResolvedValueOnce({
        text: "", toolCalls: [{ id: "call-list-1", name: "workspace.list", input: {} }],
        inputTokens: 12, outputTokens: 8
      })
      .mockResolvedValueOnce({
        text: "The selected workspace is empty.", toolCalls: [], inputTokens: 20, outputTokens: 14
      });
    await runClaimedTask(taskId, new AbortController().signal, complete);
    expect(complete).toHaveBeenCalledTimes(3);
    const invocation = sqlite.prepare("SELECT tool_name, status FROM tool_invocations WHERE task_id = ?").get(taskId);
    expect(invocation).toEqual({ tool_name: "workspace.list", status: "completed" });
    const task = sqlite.prepare("SELECT status, checkpoint_json FROM tasks WHERE id = ?").get(taskId) as { status: string; checkpoint_json: string };
    expect(task.status).toBe("completed");
    const checkpoint = JSON.parse(task.checkpoint_json) as { messages: Array<{ role: string; content: string }> };
    expect(checkpoint.messages.some((message) => message.role === "tool" && message.content.includes("files"))).toBe(true);
  });

  it("does not expose the durable planner checkpoint to task API callers", async () => {
    const taskId = insertTask();
    sqlite.prepare("UPDATE tasks SET checkpoint_json = ? WHERE id = ?")
      .run(JSON.stringify({ version: 1, private: "internal" }), taskId);
    const app = Fastify();
    await app.register(agentRoutes);
    const response = await app.inject({ method: "GET", url: "/api/v1/tasks/" + taskId });
    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty("checkpoint_json");
    expect(response.json()).not.toHaveProperty("private");
    await app.close();
  });
});
