import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sqlite, nowIso } from "./db.js";
import {
  claimNextTask, heartbeatTaskLease, recoverExpiredTaskLeases,
  releaseTaskLease
} from "./worker-queue.js";

function insertTask(status = "queued"): string {
  const id = randomUUID();
  const timestamp = nowIso();
  sqlite.prepare(`
    INSERT INTO tasks (
      id, title, description, status, task_type, model_alias, execution_mode,
      iteration_limit, time_limit_seconds, created_at, updated_at
    ) VALUES (?, 'Queue test', 'Exercise worker lease behavior', ?, 'general',
      'sonnet', 'approve-each', 5, 120, ?, ?)
  `).run(id, status, timestamp, timestamp);
  return id;
}

describe("durable worker queue leases", () => {
  let taskId = "";
  beforeEach(() => { taskId = insertTask(); });
  afterEach(() => { sqlite.prepare("DELETE FROM tasks").run(); });

  it("atomically claims queued work and only accepts the current lease token", () => {
    const claimed = claimNextTask("worker-a", 30);
    expect(claimed?.task.id).toBe(taskId);
    expect(claimed?.task.worker_attempts).toBe(1);
    expect(claimNextTask("worker-b", 30)).toBeNull();
    expect(() => heartbeatTaskLease(taskId, "worker-b", claimed!.leaseToken))
      .toThrow("not owned");
    const extended = heartbeatTaskLease(taskId, "worker-a", claimed!.leaseToken, 60);
    expect(Date.parse(extended)).toBeGreaterThan(Date.parse(claimed!.leaseUntil));
    releaseTaskLease(taskId, "worker-a", claimed!.leaseToken);
    expect(sqlite.prepare("SELECT worker_id, worker_lease_token_hash, worker_lease_until FROM tasks WHERE id = ?").get(taskId))
      .toEqual({ worker_id: null, worker_lease_token_hash: null, worker_lease_until: null });
  });

  it("requeues an expired lease when no tool side effect was in flight", () => {
    const claimed = claimNextTask("worker-a", 30)!;
    const expiredAt = new Date(Date.now() + 60_000).toISOString();
    const result = recoverExpiredTaskLeases(expiredAt);
    expect(result).toEqual({ requeued: 1, paused: 0 });
    expect(sqlite.prepare("SELECT status, worker_id FROM tasks WHERE id = ?").get(taskId))
      .toEqual({ status: "queued", worker_id: null });
    expect(() => heartbeatTaskLease(taskId, "worker-a", claimed.leaseToken)).toThrow("missing, expired");
  });

  it("pauses an expired task when a tool invocation may have caused a side effect", () => {
    const claimed = claimNextTask("worker-a", 30)!;
    const timestamp = nowIso();
    sqlite.prepare(`
      INSERT INTO tool_invocations (id, task_id, tool_name, input_json, status, started_at)
      VALUES (?, ?, 'workspace.run_command', '{}', 'running', ?)
    `).run(randomUUID(), taskId, timestamp);
    const expiredAt = new Date(Date.now() + 60_000).toISOString();
    expect(recoverExpiredTaskLeases(expiredAt)).toEqual({ requeued: 0, paused: 1 });
    expect(sqlite.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId))
      .toEqual({ status: "paused" });
    expect(sqlite.prepare("SELECT worker_lease_token_hash FROM tasks WHERE id = ?").get(taskId))
      .toEqual({ worker_lease_token_hash: null });
    expect(claimNextTask("worker-b", 30)).toBeNull();
    expect(claimed.leaseToken).toBeTruthy();
  });

  it("does not claim paused or waiting-approval tasks", () => {
    sqlite.prepare("UPDATE tasks SET status = 'paused' WHERE id = ?").run(taskId);
    expect(claimNextTask("worker-a", 30)).toBeNull();
    sqlite.prepare("UPDATE tasks SET status = 'waiting_approval' WHERE id = ?").run(taskId);
    expect(claimNextTask("worker-a", 30)).toBeNull();
  });
});
