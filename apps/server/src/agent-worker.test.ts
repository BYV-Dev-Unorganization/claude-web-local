import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sqlite, nowIso } from "./db.js";
import { claimNextTask } from "./worker-queue.js";
import { runClaimedTask } from "./agent-worker.js";

function insertTask(iterationLimit = 8): string {
  const id = randomUUID();
  const timestamp = nowIso();
  sqlite.prepare(`
    INSERT INTO tasks (
      id, title, description, status, task_type, model_alias, execution_mode,
      iteration_limit, time_limit_seconds, created_at, updated_at
    ) VALUES (?, 'Agent worker test', 'Summarize a small code task', 'queued',
      'general', 'sonnet', 'plan', ?, 120, ?, ?)
  `).run(id, iterationLimit, timestamp, timestamp);
  return id;
}

describe("durable autonomous agent worker", () => {
  afterEach(() => { sqlite.prepare("DELETE FROM tasks").run(); });

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

  it("does not expose the durable planner checkpoint to task API callers", async () => {
    const taskId = insertTask();
    sqlite.prepare("UPDATE tasks SET checkpoint_json = ? WHERE id = ?")
      .run(JSON.stringify({ version: 1, private: "internal" }), taskId);
    const stored = sqlite.prepare("SELECT checkpoint_json FROM tasks WHERE id = ?").get(taskId) as { checkpoint_json: string };
    expect(stored.checkpoint_json).toContain("internal");
  });
});
