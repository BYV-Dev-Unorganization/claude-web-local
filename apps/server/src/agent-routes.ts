import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  cancelTask, createTask, decideApproval, getTask, listApprovals, listTaskEvents,
  listTaskSteps, listTasks, pauseTask, resumeTask, retryTask, taskStatuses
} from "./agent-runtime.js";

function reportError(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : "Task operation failed.";
  const lowered = message.toLowerCase();
  const status = lowered.includes("not found") ? 404
    : lowered.includes("invalid task transition") || lowered.includes("only ")
      || lowered.includes("no longer pending") || lowered.includes("not waiting")
      || lowered.includes("can only") ? 409 : 400;
  return reply.code(status).send({
    error: {
      code: status === 404 ? "not_found" : status === 409 ? "conflict" : "validation_error",
      message
    }
  });
}

const idSchema = z.string().uuid();
const agentRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/v1/tasks", async (request, reply) => {
    try {
      const task = createTask(request.body as Parameters<typeof createTask>[0]);
      return reply.code(201).send(task);
    } catch (error) {
      return reportError(reply, error);
    }
  });

  app.get("/api/v1/tasks", async (request, reply) => {
    try {
      const query = z.object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        status: z.enum(taskStatuses).optional()
      }).parse(request.query);
      return { items: listTasks(query.limit, query.status) };
    } catch (error) {
      return reportError(reply, error);
    }
  });

  app.get("/api/v1/tasks/:id", async (request, reply) => {
    try {
      const id = idSchema.parse((request.params as { id: string }).id);
      const task = getTask(id);
      if (!task) return reply.code(404).send({ error: { code: "not_found", message: "Task not found." } });
      return task;
    } catch (error) {
      return reportError(reply, error);
    }
  });

  app.get("/api/v1/tasks/:id/events", async (request, reply) => {
    try {
      const taskId = idSchema.parse((request.params as { id: string }).id);
      const query = z.object({
        after: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(500).default(100)
      }).parse(request.query);
      return { items: listTaskEvents(taskId, query.after, query.limit) };
    } catch (error) {
      return reportError(reply, error);
    }
  });

  app.get("/api/v1/tasks/:id/steps", async (request, reply) => {
    try {
      const taskId = idSchema.parse((request.params as { id: string }).id);
      return { items: listTaskSteps(taskId) };
    } catch (error) {
      return reportError(reply, error);
    }
  });

  const taskAction = (action: (taskId: string) => object) => async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const taskId = idSchema.parse((request.params as { id: string }).id);
      return action(taskId);
    } catch (error) {
      return reportError(reply, error);
    }
  };
  app.post("/api/v1/tasks/:id/pause", taskAction(pauseTask));
  app.post("/api/v1/tasks/:id/resume", taskAction(resumeTask));
  app.post("/api/v1/tasks/:id/cancel", taskAction(cancelTask));
  app.post("/api/v1/tasks/:id/retry", taskAction(retryTask));

  app.get("/api/v1/approvals", async (request, reply) => {
    try {
      const query = z.object({
        status: z.enum(["pending", "approved", "rejected", "expired"]).default("pending")
      }).parse(request.query);
      return { items: listApprovals(query.status) };
    } catch (error) {
      return reportError(reply, error);
    }
  });

  const decisionBody = z.object({ reason: z.string().max(1000).optional() });
  app.post("/api/v1/approvals/:id/approve", async (request, reply) => {
    try {
      const approvalId = idSchema.parse((request.params as { id: string }).id);
      const body = decisionBody.parse(request.body ?? {});
      return decideApproval(approvalId, true, body.reason);
    } catch (error) {
      return reportError(reply, error);
    }
  });
  app.post("/api/v1/approvals/:id/reject", async (request, reply) => {
    try {
      const approvalId = idSchema.parse((request.params as { id: string }).id);
      const body = decisionBody.parse(request.body ?? {});
      return decideApproval(approvalId, false, body.reason);
    } catch (error) {
      return reportError(reply, error);
    }
  });
};

export default agentRoutes;
