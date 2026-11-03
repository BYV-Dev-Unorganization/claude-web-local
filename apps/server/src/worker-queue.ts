import { createHash, randomUUID } from "node:crypto";
import { sqlite, nowIso } from "./db.js";
import { recordTaskEvent, type TaskStatus } from "./agent-runtime.js";

type QueueTask = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  worker_attempts: number;
  worker_lease_until: string | null;
};

export type ClaimedTask = {
  task: QueueTask;
  workerId: string;
  leaseToken: string;
  leaseUntil: string;
};

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function validateWorker(workerId: string, leaseSeconds: number): void {
  if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(workerId)) throw new Error("Worker ID is invalid.");
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 10 || leaseSeconds > 3600) {
    throw new Error("Lease duration must be between 10 and 3600 seconds.");
  }
}

/** Atomically claims the oldest queued task. The raw lease token is returned once and never stored. */
export function claimNextTask(workerId: string, leaseSeconds = 60): ClaimedTask | null {
  validateWorker(workerId, leaseSeconds);
  const leaseToken = randomUUID();
  const timestamp = nowIso();
  const leaseUntil = new Date(Date.now() + leaseSeconds * 1000).toISOString();
  const claim = sqlite.transaction(() => {
    const candidate = sqlite.prepare(`
      SELECT id FROM tasks
      WHERE status = 'queued'
        AND (worker_lease_until IS NULL OR worker_lease_until <= ?)
      ORDER BY created_at ASC, id ASC LIMIT 1
    `).get(timestamp) as { id: string } | undefined;
    if (!candidate) return null;
    const result = sqlite.prepare(`
      UPDATE tasks SET worker_id = ?, worker_lease_token_hash = ?,
        worker_lease_until = ?, worker_attempts = worker_attempts + 1, updated_at = ?
      WHERE id = ? AND status = 'queued'
        AND (worker_lease_until IS NULL OR worker_lease_until <= ?)
    `).run(workerId, tokenHash(leaseToken), leaseUntil, timestamp, candidate.id, timestamp);
    if (result.changes !== 1) return null;
    recordTaskEvent(candidate.id, "worker.claimed", {
      workerId, leaseUntil,
      attempt: (sqlite.prepare("SELECT worker_attempts FROM tasks WHERE id = ?").get(candidate.id) as { worker_attempts: number }).worker_attempts
    });
    const task = sqlite.prepare("SELECT id, title, description, status, worker_attempts, worker_lease_until FROM tasks WHERE id = ?")
      .get(candidate.id) as QueueTask;
    return { task, workerId, leaseToken, leaseUntil };
  });
  return claim.immediate();
}

/** Extends a lease only when the worker still owns the exact unexpired token. */
export function heartbeatTaskLease(taskId: string, workerId: string, leaseToken: string, leaseSeconds = 60): string {
  validateWorker(workerId, leaseSeconds);
  if (!leaseToken || leaseToken.length > 128) throw new Error("Lease token is invalid.");
  const timestamp = nowIso();
  const leaseUntil = new Date(Date.now() + leaseSeconds * 1000).toISOString();
  const result = sqlite.prepare(`
    UPDATE tasks SET worker_lease_until = ?, updated_at = ?
    WHERE id = ? AND worker_id = ? AND worker_lease_token_hash = ?
      AND worker_lease_until > ? AND status IN ('queued', 'planning', 'running')
  `).run(leaseUntil, timestamp, taskId, workerId, tokenHash(leaseToken), timestamp);
  if (result.changes !== 1) throw new Error("Worker lease is missing, expired, or owned by another worker.");
  recordTaskEvent(taskId, "worker.heartbeat", { workerId, leaseUntil });
  return leaseUntil;
}

/** Releases only the lease held by the caller; task state is not changed. */
export function releaseTaskLease(taskId: string, workerId: string, leaseToken: string): void {
  const result = sqlite.prepare(`
    UPDATE tasks SET worker_id = NULL, worker_lease_token_hash = NULL,
      worker_lease_until = NULL, updated_at = ?
    WHERE id = ? AND worker_id = ? AND worker_lease_token_hash = ?
  `).run(nowIso(), taskId, workerId, tokenHash(leaseToken));
  if (result.changes !== 1) throw new Error("Worker lease is not owned by this worker.");
  recordTaskEvent(taskId, "worker.released", { workerId });
}

/**
 * Recovers expired planning/running leases. Tasks with an unfinished tool invocation
 * are paused for operator review because repeating an external side effect is unsafe.
 */
export function recoverExpiredTaskLeases(at = nowIso()): { requeued: number; paused: number } {
  const recover = sqlite.transaction(() => {
    const expired = sqlite.prepare(`
      SELECT id, status FROM tasks
      WHERE status IN ('planning', 'running')
        AND worker_lease_until IS NOT NULL AND worker_lease_until <= ?
      ORDER BY updated_at ASC
    `).all(at) as Array<{ id: string; status: TaskStatus }>;
    let requeued = 0;
    let paused = 0;
    for (const task of expired) {
      const inFlight = sqlite.prepare(
        "SELECT id FROM tool_invocations WHERE task_id = ? AND status = 'running' LIMIT 1"
      ).get(task.id);
      const nextStatus = inFlight ? "paused" : "queued";
      sqlite.prepare(`
        UPDATE tasks SET status = ?, completed_at = NULL, worker_id = NULL,
          worker_lease_token_hash = NULL, worker_lease_until = NULL, updated_at = ?
        WHERE id = ? AND status = ? AND worker_lease_until <= ?
      `).run(nextStatus, at, task.id, task.status, at);
      if (inFlight) paused += 1;
      else requeued += 1;
      recordTaskEvent(task.id, "worker.lease_expired", {
        previousStatus: task.status, recoveredStatus: nextStatus,
        reason: inFlight ? "An invocation was still running; operator review prevents unsafe replay." : "No in-flight invocation; task returned to the durable queue."
      });
    }
    return { requeued, paused };
  });
  return recover.immediate();
}
