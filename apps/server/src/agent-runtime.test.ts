import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sqlite, nowIso } from "./db.js";
import agentRoutes from "./agent-routes.js";
import {
  cancelTask, decideApproval, getTask, listApprovals, listTaskEvents,
  pauseTask, requestTaskApproval, resumeTask, transitionTask
} from "./agent-runtime.js";

function insertTask(status: string = "queued"): string {
  const id = randomUUID();
  const timestamp = nowIso();
  sqlite.prepare(`
    INSERT INTO tasks (
      id, title, description, status, task_type, model_alias, execution_mode,
      iteration_limit, time_limit_seconds, created_at, updated_at
    ) VALUES (?, 'Test task', 'Exercise durable task behavior', ?, 'general', 'sonnet',
      'approve-each', 5, 120, ?, ?)
  `).run(id, status, timestamp, timestamp);
  return id;
}

describe("durable task state and approval services", () => {
  let taskId = "";
  beforeEach(() => { taskId = insertTask(); });
  afterEach(() => { sqlite.prepare("DELETE FROM tasks").run(); });

  it("records valid transitions and rejects invalid transitions", () => {
    expect(transitionTask(taskId, "planning").status).toBe("planning");
    expect(transitionTask(taskId, "running").status).toBe("running");
    expect(transitionTask(taskId, "completed").status).toBe("completed");
    expect(() => transitionTask(taskId, "running")).toThrow("Invalid task transition");
    const events = listTaskEvents(taskId);
    expect(events.map((event) => (event as { event_type: string }).event_type))
      .toEqual(["task.status", "task.status", "task.status"]);
    expect(events.map((event) => (event as { sequence: number }).sequence)).toEqual([1, 2, 3]);
  });

  it("binds approval to a canonical payload and queues the task after approval", () => {
    transitionTask(taskId, "planning");
    transitionTask(taskId, "running");
    const approval = requestTaskApproval({
      taskId,
      actionName: "workspace.write_file",
      target: { path: "src/main.ts", content: "safe content" }
    });
    expect(getTask(taskId)?.status).toBe("waiting_approval");
    expect(approval.payload_hash).toMatch(/^[a-f0-9]{64}$/);
    const decided = decideApproval(approval.id, true, "Reviewed the exact file change.");
    expect(decided.status).toBe("approved");
    expect(getTask(taskId)?.status).toBe("queued");
    expect(listTaskEvents(taskId).some((event) => (event as { event_type: string }).event_type === "approval.approved")).toBe(true);
  });

  it("pauses a task when an operator rejects a sensitive action", () => {
    transitionTask(taskId, "planning");
    transitionTask(taskId, "running");
    const approval = requestTaskApproval({
      taskId,
      actionName: "browser.submit_form",
      target: { url: "https://example.com/submit", method: "POST" }
    });
    const rejected = decideApproval(approval.id, false, "The action was not requested.");
    expect(rejected.status).toBe("rejected");
    expect(getTask(taskId)?.status).toBe("paused");
  });

  it("does not accept a modified approval payload", () => {
    transitionTask(taskId, "planning");
    transitionTask(taskId, "running");
    const approval = requestTaskApproval({
      taskId,
      actionName: "workspace.write_file",
      target: { path: "src/main.ts", content: "original" }
    });
    sqlite.prepare("UPDATE approvals SET target_json = ? WHERE id = ?")
      .run(JSON.stringify({ path: "src/main.ts", content: "tampered" }), approval.id);
    expect(() => decideApproval(approval.id, true)).toThrow("integrity check failed");
    expect(listApprovals("pending").some((item) => item.id === approval.id)).toBe(true);
    expect(getTask(taskId)?.status).toBe("waiting_approval");
  });

  it("commits approval expiry and pauses the waiting task", () => {
    transitionTask(taskId, "planning");
    transitionTask(taskId, "running");
    const approval = requestTaskApproval({
      taskId,
      actionName: "workspace.run_command",
      target: { command: "npm test" },
      expiresInSeconds: 30
    });
    sqlite.prepare("UPDATE approvals SET expires_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), approval.id);
    expect(() => decideApproval(approval.id, true)).toThrow("Approval has expired");
    expect(sqlite.prepare("SELECT status FROM approvals WHERE id = ?").get(approval.id))
      .toEqual({ status: "expired" });
    expect(getTask(taskId)?.status).toBe("paused");
  });

  it("exposes task state and actions through the Fastify API", async () => {
    const app = Fastify();
    await app.register(agentRoutes);
    const read = await app.inject({ method: "GET", url: "/api/v1/tasks/" + taskId });
    expect(read.statusCode).toBe(200);
    expect(read.json().status).toBe("queued");
    const paused = await app.inject({ method: "POST", url: "/api/v1/tasks/" + taskId + "/pause" });
    expect(paused.statusCode).toBe(200);
    expect(paused.json().status).toBe("paused");
    const resumed = await app.inject({ method: "POST", url: "/api/v1/tasks/" + taskId + "/resume" });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().status).toBe("queued");
    const events = await app.inject({ method: "GET", url: "/api/v1/tasks/" + taskId + "/events" });
    expect(events.statusCode).toBe(200);
    expect(events.json().items.length).toBe(2);
    await app.close();
  });

  it("cancels queued tasks and preserves their event history", () => {
    expect(cancelTask(taskId).status).toBe("cancelled");
    expect(listTaskEvents(taskId)).toHaveLength(1);
    expect(() => pauseTask(taskId)).toThrow("Invalid task transition");
    expect(() => resumeTask(taskId)).toThrow("Invalid task transition");
  });
});
