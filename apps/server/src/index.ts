import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { createHash, randomUUID } from "node:crypto";
import { nanoid } from "nanoid";
import fs from "node:fs/promises";
import path from "node:path";
import { z, ZodError } from "zod";
import { config, isAgentProviderConfigured, isProviderConfigured, publicModelConfiguration, type ModelAlias } from "./config.js";
import { startAgentWorkers, stopAgentWorkers } from "./agent-worker.js";
import { sqlite, nowIso } from "./db.js";
import { ProviderError, streamCompletion, testProvider } from "./provider.js";
import { createWorkspace, listWorkspaces, getWorkspace, listWorkspaceFiles, readWorkspaceFile, writeWorkspaceFile, runWorkspaceCommand } from "./workspace.js";
import { publicToolManifest } from "./tool-registry.js";
import agentRoutes from "./agent-routes.js";
import { createConversationBranch } from "./conversation-branches.js";

const app = Fastify({
  logger: {
    level: config.APP_ENV === "production" ? "info" : "debug",
    redact: {
      paths: ["req.headers.authorization", "req.headers.cookie", "req.headers.x-api-key", "*.apiKey", "*.token"],
      censor: "[REDACTED]"
    }
  },
  bodyLimit: config.MAX_UPLOAD_BYTES
});

await app.register(cors, {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    let allowed = false;
    try {
      const parsed = new URL(origin);
      allowed = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) &&
        ["http:", "https:"].includes(parsed.protocol);
    } catch {
      allowed = false;
    }
    callback(allowed ? null : new Error("Origin is not allowed."), allowed);
  }
});
await app.register(multipart, {
  limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 5, fields: 20 }
});
await app.register(agentRoutes);

const now = nowIso;
const id = () => randomUUID();
const parseId = z.string().uuid();
const aliasSchema = z.enum(["fable", "opus", "sonnet", "haiku"]);
const textExtensions = new Set([
  ".txt", ".md", ".markdown", ".json", ".csv", ".ts", ".tsx", ".js", ".jsx",
  ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".kt", ".html", ".css",
  ".scss", ".xml", ".yaml", ".yml", ".toml", ".sql", ".sh", ".env.example"
]);

function safeError(error: unknown): { code: string; message: string; status: number } {
  if (error instanceof ZodError) {
    return { code: "validation_error", message: error.issues.map((issue) => issue.message).join("; "), status: 400 };
  }
  if (error instanceof ProviderError) {
    return {
      code: error.status === 503 ? "model_not_configured" : "provider_error",
      message: error.message.replace(/(sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+)/gi, "[REDACTED]"),
      status: error.status && error.status >= 400 ? error.status : 502
    };
  }
  return { code: "internal_error", message: "An unexpected server error occurred. Check the local server log for details.", status: 500 };
}

app.setErrorHandler((error, request, reply) => {
  const normalized = safeError(error);
  request.log.error({ err: error, requestId: request.id }, "Request failed");
  reply.code(normalized.status).send({
    error: { code: normalized.code, message: normalized.message, requestId: request.id }
  });
});

function sendNotFound(reply: FastifyReply, entity: string) {
  return reply.code(404).send({
    error: { code: "not_found", message: entity + " was not found." }
  });
}

function validId(value: string): string {
  return parseId.parse(value);
}

function getParam(request: FastifyRequest, key: string): string {
  const params = request.params as Record<string, string>;
  return params[key] ?? "";
}

function insertMessage(values: {
  conversationId: string; role: string; content: string; status: string;
  modelAlias?: string; turnId: string; completedAt?: string;
}) {
  const messageId = id();
  sqlite.prepare(
    "INSERT INTO messages (id, conversation_id, turn_id, role, status, content, model_alias, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(messageId, values.conversationId, values.turnId, values.role, values.status,
    values.content, values.modelAlias ?? null, now(), values.completedAt ?? null);
  try {
    if (values.role === "user" || values.role === "assistant") {
      sqlite.prepare("INSERT INTO message_search (message_id, conversation_id, content) VALUES (?, ?, ?)")
        .run(messageId, values.conversationId, values.content);
    }
  } catch (error) {
    app.log.warn({ err: error }, "Message search index update failed");
  }
  return messageId;
}

app.get("/api/v1/health", async () => ({
  ok: true,
  service: "claude-web-local",
  timestamp: now()
}));

app.get("/api/v1/ready", async (_request, reply) => {
  const databaseOk = sqlite.open;
  const providerOk = isProviderConfigured();
  const ready = databaseOk && providerOk;
  if (!ready) reply.code(503);
  return {
    ready,
    checks: {
      database: databaseOk ? "ready" : "unavailable",
      provider: providerOk ? "configured" : "not_configured"
    }
  };
});

app.get("/api/v1/config/public", async () => ({
  appName: config.APP_NAME,
  environment: config.APP_ENV,
  timezone: config.APP_TIMEZONE,
  defaultModel: config.AI_DEFAULT_MODEL,
  host: config.APP_HOST,
  port: config.APP_PORT
}));

app.get("/api/v1/models", async () => ({
  provider: config.AI_PROVIDER ?? null,
  protocol: config.AI_PROTOCOL,
  configured: isProviderConfigured(),
  models: publicModelConfiguration()
}));

app.post("/api/v1/models/test", async (request) => {
  const body = z.object({ modelAlias: aliasSchema }).parse(request.body);
  return await testProvider(body.modelAlias as ModelAlias);
});

app.get("/api/v1/capabilities", async () => ({
  chat: { available: isProviderConfigured(), reason: isProviderConfigured() ? null : "Configure all four model aliases and provider credentials." },
  projects: { available: true },
  textKnowledge: { available: true, formats: ["txt", "md", "markdown", "json", "csv", "source-code"] },
  artifacts: { available: true, formats: ["html", "css", "javascript", "svg", "markdown", "json"] },
  memory: { available: true, note: "Explicitly created memories only; automatic extraction/review is not enabled." },
  research: { available: false, reason: "No verified search-provider adapter is installed in this build." },
  agentRuntime: { available: false, reason: "Durable isolated worker execution is not yet installed." },
  codingWorkspace: { available: false, reason: "Manual workspace operations exist, but autonomous coding-agent integration, Git branch/commit operations, snapshots, rollback, and the full security suite are not yet enabled.", manualMode: "Build cwl-coding-sandbox:local to enable the confirmed command runner." },
  browserAutomation: { available: false, reason: "Playwright worker and enforced network egress isolation are not yet installed." },
  mcp: { available: false, reason: "MCP transports and server lifecycle worker are not yet installed." },
  connectors: { available: false, reason: "No connector adapters are configured." },
  plugins: { available: false, reason: "Plugin execution is disabled until manifest sandboxing and review are implemented." },
  skills: { available: false, reason: "Skill execution is disabled until code trust and permission isolation are implemented." },
  schedules: { available: false, reason: "Durable scheduler dispatch is not yet installed." },
  multiAgent: { available: false, reason: "Parent/child worker orchestration is not yet installed." },
  voice: { available: false, reason: "No speech-to-text or text-to-speech adapter is configured." }
}));

const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(160).default("New conversation"),
  modelAlias: aliasSchema.default(config.AI_DEFAULT_MODEL),
  projectId: z.string().uuid().optional()
});

app.post("/api/v1/conversations", async (request, reply) => {
  const body = createConversationSchema.parse(request.body ?? {});
  if (!config.models[body.modelAlias]) {
    return reply.code(400).send({ error: { code: "model_not_configured", message: "The selected model alias is not configured." } });
  }
  if (body.projectId) {
    const project = sqlite.prepare("SELECT id FROM projects WHERE id = ? AND status = 'active'").get(body.projectId);
    if (!project) return sendNotFound(reply, "Project");
  }
  const conversationId = id();
  const timestamp = now();
  sqlite.prepare(
    "INSERT INTO conversations (id, project_id, title, model_alias, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)"
  ).run(conversationId, body.projectId ?? null, body.title, body.modelAlias, timestamp, timestamp);
  reply.code(201);
  return { id: conversationId, title: body.title, modelAlias: body.modelAlias, projectId: body.projectId ?? null, createdAt: timestamp, updatedAt: timestamp };
});

app.get("/api/v1/conversations", async (request) => {
  const query = z.object({
    q: z.string().trim().max(200).optional(),
    projectId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30)
  }).parse(request.query);
  const rows = query.q
    ? sqlite.prepare("SELECT c.*, (SELECT content FROM messages m WHERE m.conversation_id = c.id AND m.content LIKE ? ORDER BY m.created_at DESC LIMIT 1) AS excerpt FROM conversations c WHERE c.status = 'active' AND (c.title LIKE ? OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.content LIKE ?)) AND (? IS NULL OR c.project_id = ?) ORDER BY c.updated_at DESC LIMIT ?")
      .all("%" + query.q + "%", "%" + query.q + "%", "%" + query.q + "%", query.projectId ?? null, query.projectId ?? null, query.limit)
    : sqlite.prepare("SELECT c.*, NULL AS excerpt FROM conversations c WHERE c.status = 'active' AND (? IS NULL OR c.project_id = ?) ORDER BY c.updated_at DESC LIMIT ?")
      .all(query.projectId ?? null, query.projectId ?? null, query.limit);
  return { items: rows };
});

app.get("/api/v1/conversations/:id", async (request, reply) => {
  const conversationId = validId(getParam(request, "id"));
  const row = sqlite.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId);
  if (!row) return sendNotFound(reply, "Conversation");
  return row;
});

app.patch("/api/v1/conversations/:id", async (request, reply) => {
  const conversationId = validId(getParam(request, "id"));
  const body = z.object({
    title: z.string().trim().min(1).max(160).optional(),
    modelAlias: aliasSchema.optional(),
    archived: z.boolean().optional()
  }).refine((value) => Object.keys(value).length > 0).parse(request.body);
  const current = sqlite.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId) as { id: string; status: string; archived_at: string | null } | undefined;
  if (!current) return sendNotFound(reply, "Conversation");
  if (body.modelAlias && !config.models[body.modelAlias]) {
    return reply.code(400).send({ error: { code: "model_not_configured", message: "The selected model alias is not configured." } });
  }
  const nextStatus = body.archived === undefined ? current.status : body.archived ? "archived" : "active";
  const nextArchivedAt = body.archived === undefined ? current.archived_at : body.archived ? now() : null;
  sqlite.prepare("UPDATE conversations SET title = COALESCE(?, title), model_alias = COALESCE(?, model_alias), status = ?, archived_at = ?, updated_at = ? WHERE id = ?")
    .run(body.title ?? null, body.modelAlias ?? null, nextStatus, nextArchivedAt, now(), conversationId);
  return sqlite.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId);
});

app.delete("/api/v1/conversations/:id", async (request, reply) => {
  const conversationId = validId(getParam(request, "id"));
  const result = sqlite.prepare("DELETE FROM conversations WHERE id = ?").run(conversationId);
  if (result.changes === 0) return sendNotFound(reply, "Conversation");
  reply.code(204);
  return reply.send();
});

app.get("/api/v1/conversations/:id/messages", async (request, reply) => {
  const conversationId = validId(getParam(request, "id"));
  const exists = sqlite.prepare("SELECT id FROM conversations WHERE id = ?").get(conversationId);
  if (!exists) return sendNotFound(reply, "Conversation");
  const rows = sqlite.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC").all(conversationId);
  return { items: rows };
});

app.post("/api/v1/conversations/:id/branch", async (request, reply) => {
  const conversationId = validId(getParam(request, "id"));
  const body = z.object({ throughMessageId: z.string().uuid().nullable().default(null) }).parse(request.body ?? {});
  try {
    const branch = createConversationBranch(conversationId, body.throughMessageId);
    reply.code(201);
    return branch;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to branch conversation.";
    const status = message.toLowerCase().includes("not found") ? 404 : 400;
    return reply.code(status).send({
      error: { code: status === 404 ? "not_found" : "validation_error", message }
    });
  }
});

app.post("/api/v1/conversations/:id/turns", async (request, reply) => {
  const conversationId = validId(getParam(request, "id"));
  const body = z.object({
    prompt: z.string().trim().min(1).max(100000),
    modelAlias: aliasSchema.optional()
  }).parse(request.body);
  const conversation = sqlite.prepare("SELECT * FROM conversations WHERE id = ?").get(conversationId) as {
    id: string; project_id: string | null; model_alias: ModelAlias; title: string
  } | undefined;
  if (!conversation) return sendNotFound(reply, "Conversation");
  const alias = body.modelAlias ?? conversation.model_alias;
  if (!config.models[alias]) {
    return reply.code(400).send({ error: { code: "model_not_configured", message: "The selected model alias is not configured." } });
  }
  if (!isProviderConfigured()) {
    return reply.code(503).send({ error: { code: "model_not_configured", message: "Configure AI_PROVIDER, AI_PROTOCOL, AI_BASE_URL, AI_API_KEY and all four model IDs." } });
  }

  const turnId = nanoid();
  const timestamp = now();
  insertMessage({ conversationId, role: "user", content: body.prompt, status: "completed", turnId, completedAt: timestamp });
  const history = sqlite.prepare("SELECT role, content FROM messages WHERE conversation_id = ? AND role IN ('user','assistant') AND status = 'completed' ORDER BY created_at DESC LIMIT 40")
    .all(conversationId).reverse() as Array<{ role: "user" | "assistant"; content: string }>;
  const projectInstructions = conversation.project_id
    ? (sqlite.prepare("SELECT instructions FROM projects WHERE id = ? AND status = 'active'").get(conversation.project_id) as { instructions: string | null } | undefined)?.instructions
    : null;
  const providerMessages = projectInstructions
    ? [{ role: "system" as const, content: projectInstructions }, ...history]
    : history;
  const assistantMessageId = id();

  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });
  const emit = (event: string, data: unknown) => {
    if (!reply.raw.destroyed && reply.raw.writable) {
      reply.raw.write("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");
    }
  };
  const abortController = new AbortController();
  reply.raw.on("close", () => {
    if (!reply.raw.writableEnded) abortController.abort();
  });

  let answer = "";
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  const startedAt = Date.now();
  try {
    emit("message.start", { turnId, messageId: assistantMessageId, modelAlias: alias });
    for await (const event of streamCompletion(alias, providerMessages, abortController.signal)) {
      if (event.type === "text.delta") {
        answer += event.text;
        emit("text.delta", { turnId, messageId: assistantMessageId, text: event.text });
      } else if (event.type === "thinking.start") {
        emit("thinking.start", { turnId, messageId: assistantMessageId });
      } else if (event.type === "usage") {
        inputTokens = event.inputTokens ?? inputTokens;
        outputTokens = event.outputTokens ?? outputTokens;
        emit("message.usage", { inputTokens, outputTokens });
      } else if (event.type === "done") {
        emit("provider.done", { requestId: event.requestId ?? null });
      }
    }
    if (abortController.signal.aborted) {
      sqlite.prepare("INSERT INTO messages (id, conversation_id, turn_id, role, status, content, model_alias, created_at, completed_at) VALUES (?, ?, ?, 'assistant', 'cancelled', ?, ?, ?, ?)")
        .run(assistantMessageId, conversationId, turnId, answer, alias, now(), now());
      emit("message.cancelled", { turnId, messageId: assistantMessageId });
    } else {
      sqlite.prepare("INSERT INTO messages (id, conversation_id, turn_id, role, status, content, model_alias, created_at, completed_at) VALUES (?, ?, ?, 'assistant', 'completed', ?, ?, ?, ?)")
        .run(assistantMessageId, conversationId, turnId, answer, alias, now(), now());
      sqlite.prepare("UPDATE conversations SET model_alias = ?, updated_at = ? WHERE id = ?").run(alias, now(), conversationId);
      try {
        sqlite.prepare("INSERT INTO message_search (message_id, conversation_id, content) VALUES (?, ?, ?)").run(assistantMessageId, conversationId, answer);
      } catch (error) { app.log.warn({ err: error }, "Message search index update failed"); }
      sqlite.prepare("INSERT INTO model_usage (id, conversation_id, model_alias, provider_model_id, input_tokens, output_tokens, request_duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id(), conversationId, alias, config.models[alias], inputTokens ?? null, outputTokens ?? null, Date.now() - startedAt, now());
      emit("message.complete", { turnId, messageId: assistantMessageId, content: answer, inputTokens: inputTokens ?? null, outputTokens: outputTokens ?? null });
    }
  } catch (error) {
    const normalized = safeError(error);
    sqlite.prepare("INSERT INTO messages (id, conversation_id, turn_id, role, status, content, model_alias, created_at, completed_at) VALUES (?, ?, ?, 'assistant', 'error', ?, ?, ?, ?)")
      .run(assistantMessageId, conversationId, turnId, answer, alias, now(), now());
    emit("message.error", { turnId, messageId: assistantMessageId, code: normalized.code, message: normalized.message });
  } finally {
    if (!reply.raw.destroyed) reply.raw.end();
  }
});

const projectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
  instructions: z.string().max(10000).optional()
});

app.post("/api/v1/projects", async (request, reply) => {
  const body = projectSchema.parse(request.body);
  const projectId = id();
  const timestamp = now();
  sqlite.prepare("INSERT INTO projects (id, name, description, instructions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(projectId, body.name, body.description ?? null, body.instructions ?? null, timestamp, timestamp);
  reply.code(201);
  return sqlite.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
});

app.get("/api/v1/projects", async () => ({
  items: sqlite.prepare("SELECT * FROM projects WHERE status = 'active' ORDER BY updated_at DESC").all()
}));

app.get("/api/v1/projects/:id", async (request, reply) => {
  const projectId = validId(getParam(request, "id"));
  const project = sqlite.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  if (!project) return sendNotFound(reply, "Project");
  return project;
});

app.patch("/api/v1/projects/:id", async (request, reply) => {
  const projectId = validId(getParam(request, "id"));
  const body = projectSchema.partial().refine((value) => Object.keys(value).length > 0).parse(request.body);
  const project = sqlite.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
  if (!project) return sendNotFound(reply, "Project");
  sqlite.prepare("UPDATE projects SET name = COALESCE(?, name), description = COALESCE(?, description), instructions = COALESCE(?, instructions), updated_at = ? WHERE id = ?")
    .run(body.name ?? null, body.description ?? null, body.instructions ?? null, now(), projectId);
  return sqlite.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
});

app.delete("/api/v1/projects/:id", async (request, reply) => {
  const projectId = validId(getParam(request, "id"));
  const result = sqlite.prepare("UPDATE projects SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?")
    .run(now(), now(), projectId);
  if (result.changes === 0) return sendNotFound(reply, "Project");
  reply.code(204);
  return reply.send();
});

app.post("/api/v1/projects/:id/files", async (request, reply) => {
  const projectId = validId(getParam(request, "id"));
  const project = sqlite.prepare("SELECT id FROM projects WHERE id = ? AND status = 'active'").get(projectId);
  if (!project) return sendNotFound(reply, "Project");
  const part = await request.file();
  if (!part) return reply.code(400).send({ error: { code: "validation_error", message: "A single file is required." } });
  const extension = path.extname(part.filename).toLowerCase();
  if (!textExtensions.has(extension)) {
    return reply.code(415).send({ error: { code: "unsupported_file_type", message: "This implementation indexes text, Markdown, JSON, CSV and source files only. Binary document parsers are not enabled." } });
  }
  const buffer = await part.toBuffer();
  if (buffer.includes(0)) return reply.code(415).send({ error: { code: "invalid_file_content", message: "Binary content is not accepted by the text ingestion adapter." } });
  const extractedText = buffer.toString("utf8");
  if (!extractedText.trim()) return reply.code(400).send({ error: { code: "empty_file", message: "The uploaded file contains no text." } });
  const fileId = id();
  const storageKey = fileId + extension;
  const directory = path.join(config.storagePath, "uploads");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, storageKey), buffer, { flag: "wx", mode: 0o600 });
  const timestamp = now();
  const digest = createHash("sha256").update(buffer).digest("hex");
  sqlite.prepare("INSERT INTO files (id, project_id, original_name, storage_key, mime_type, size_bytes, checksum, status, extracted_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'indexed', ?, ?)")
    .run(fileId, projectId, path.basename(part.filename), storageKey, part.mimetype, buffer.length, digest, extractedText, timestamp);
  const insertChunk = sqlite.prepare("INSERT INTO file_chunks (id, file_id, project_id, chunk_index, text_content, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  const chunkSize = 1800;
  const chunks: string[] = [];
  for (let start = 0; start < extractedText.length; start += chunkSize) chunks.push(extractedText.slice(start, start + chunkSize));
  const transaction = sqlite.transaction(() => {
    chunks.forEach((chunk, index) => insertChunk.run(id(), fileId, projectId, index, chunk, timestamp));
    sqlite.prepare("INSERT INTO file_search (file_id, project_id, content) VALUES (?, ?, ?)").run(fileId, projectId, extractedText);
  });
  transaction();
  reply.code(201);
  return { id: fileId, projectId, name: path.basename(part.filename), bytes: buffer.length, checksum: digest, status: "indexed", chunks: chunks.length };
});

app.get("/api/v1/projects/:id/files", async (request, reply) => {
  const projectId = validId(getParam(request, "id"));
  const project = sqlite.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
  if (!project) return sendNotFound(reply, "Project");
  return { items: sqlite.prepare("SELECT id, original_name, mime_type, size_bytes, checksum, status, created_at FROM files WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at DESC").all(projectId) };
});

app.delete("/api/v1/projects/:id/files/:fileId", async (request, reply) => {
  const projectId = validId(getParam(request, "id"));
  const fileId = validId(getParam(request, "fileId"));
  const file = sqlite.prepare("SELECT storage_key FROM files WHERE id = ? AND project_id = ?").get(fileId, projectId) as { storage_key: string } | undefined;
  if (!file) return sendNotFound(reply, "Project file");
  sqlite.prepare("DELETE FROM files WHERE id = ?").run(fileId);
  await fs.rm(path.join(config.storagePath, "uploads", file.storage_key), { force: true });
  reply.code(204);
  return reply.send();
});

app.post("/api/v1/projects/:id/search", async (request, reply) => {
  const projectId = validId(getParam(request, "id"));
  const project = sqlite.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
  if (!project) return sendNotFound(reply, "Project");
  const body = z.object({ query: z.string().trim().min(1).max(500), limit: z.coerce.number().int().min(1).max(20).default(8) }).parse(request.body);
  const rows = sqlite.prepare("SELECT c.id AS chunkId, c.text_content AS text, c.chunk_index AS chunkIndex, f.id AS fileId, f.original_name AS fileName FROM file_chunks c JOIN files f ON f.id = c.file_id WHERE c.project_id = ? AND c.text_content LIKE ? ORDER BY c.file_id, c.chunk_index LIMIT ?")
    .all(projectId, "%" + body.query.replace(/[%_]/g, "\\$&") + "%", body.limit);
  return { items: rows, strategy: "lexical-like", projectId };
});

const artifactSchema = z.object({
  title: z.string().trim().min(1).max(160),
  artifactType: z.enum(["html", "css", "javascript", "svg", "markdown", "json"]),
  content: z.string().max(1000000),
  projectId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional()
});

app.post("/api/v1/artifacts", async (request, reply) => {
  const body = artifactSchema.parse(request.body);
  if (body.projectId && !sqlite.prepare("SELECT id FROM projects WHERE id = ?").get(body.projectId)) return sendNotFound(reply, "Project");
  if (body.conversationId && !sqlite.prepare("SELECT id FROM conversations WHERE id = ?").get(body.conversationId)) return sendNotFound(reply, "Conversation");
  const artifactId = id();
  const versionId = id();
  const timestamp = now();
  const digest = createHash("sha256").update(body.content).digest("hex");
  const tx = sqlite.transaction(() => {
    sqlite.prepare("INSERT INTO artifacts (id, project_id, conversation_id, title, artifact_type, current_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)")
      .run(artifactId, body.projectId ?? null, body.conversationId ?? null, body.title, body.artifactType, timestamp, timestamp);
    sqlite.prepare("INSERT INTO artifact_versions (id, artifact_id, version_number, content, content_hash, created_at) VALUES (?, ?, 1, ?, ?, ?)")
      .run(versionId, artifactId, body.content, digest, timestamp);
  });
  tx();
  reply.code(201);
  return { id: artifactId, title: body.title, artifactType: body.artifactType, currentVersion: 1, createdAt: timestamp };
});

app.get("/api/v1/artifacts", async () => ({
  items: sqlite.prepare("SELECT * FROM artifacts ORDER BY updated_at DESC").all()
}));

app.get("/api/v1/artifacts/:id", async (request, reply) => {
  const artifactId = validId(getParam(request, "id"));
  const artifact = sqlite.prepare("SELECT * FROM artifacts WHERE id = ?").get(artifactId) as { id: string; current_version: number } | undefined;
  if (!artifact) return sendNotFound(reply, "Artifact");
  const version = sqlite.prepare("SELECT * FROM artifact_versions WHERE artifact_id = ? AND version_number = ?").get(artifactId, artifact.current_version);
  return { ...artifact, version };
});

app.post("/api/v1/artifacts/:id/versions", async (request, reply) => {
  const artifactId = validId(getParam(request, "id"));
  const body = z.object({ content: z.string().max(1000000) }).parse(request.body);
  const artifact = sqlite.prepare("SELECT current_version FROM artifacts WHERE id = ?").get(artifactId) as { current_version: number } | undefined;
  if (!artifact) return sendNotFound(reply, "Artifact");
  const nextVersion = artifact.current_version + 1;
  const versionId = id();
  const timestamp = now();
  const digest = createHash("sha256").update(body.content).digest("hex");
  const tx = sqlite.transaction(() => {
    sqlite.prepare("INSERT INTO artifact_versions (id, artifact_id, version_number, content, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(versionId, artifactId, nextVersion, body.content, digest, timestamp);
    sqlite.prepare("UPDATE artifacts SET current_version = ?, updated_at = ? WHERE id = ?").run(nextVersion, timestamp, artifactId);
  });
  tx();
  reply.code(201);
  return { id: versionId, artifactId, version: nextVersion, contentHash: digest };
});

app.get("/api/v1/artifacts/:id/versions", async (request, reply) => {
  const artifactId = validId(getParam(request, "id"));
  if (!sqlite.prepare("SELECT id FROM artifacts WHERE id = ?").get(artifactId)) return sendNotFound(reply, "Artifact");
  return { items: sqlite.prepare("SELECT id, version_number, content_hash, created_at FROM artifact_versions WHERE artifact_id = ? ORDER BY version_number DESC").all(artifactId) };
});

app.post("/api/v1/artifacts/:id/restore/:versionId", async (request, reply) => {
  const artifactId = validId(getParam(request, "id"));
  const versionId = validId(getParam(request, "versionId"));
  const version = sqlite.prepare("SELECT version_number FROM artifact_versions WHERE id = ? AND artifact_id = ?").get(versionId, artifactId) as { version_number: number } | undefined;
  if (!version) return sendNotFound(reply, "Artifact version");
  sqlite.prepare("UPDATE artifacts SET current_version = ?, updated_at = ? WHERE id = ?").run(version.version_number, now(), artifactId);
  return { artifactId, currentVersion: version.version_number };
});

app.delete("/api/v1/artifacts/:id", async (request, reply) => {
  const artifactId = validId(getParam(request, "id"));
  const result = sqlite.prepare("DELETE FROM artifacts WHERE id = ?").run(artifactId);
  if (!result.changes) return sendNotFound(reply, "Artifact");
  reply.code(204);
  return reply.send();
});

const memorySchema = z.object({
  content: z.string().trim().min(1).max(10000),
  scope: z.enum(["global", "project", "conversation"]).default("global"),
  projectId: z.string().uuid().optional(),
  memoryType: z.enum(["explicit", "reference", "preference"]).default("explicit"),
  source: z.record(z.string(), z.unknown()).optional()
});

app.post("/api/v1/memories", async (request, reply) => {
  const body = memorySchema.parse(request.body);
  if (body.scope === "project" && !body.projectId) {
    return reply.code(400).send({ error: { code: "validation_error", message: "projectId is required for project-scoped memory." } });
  }
  if (body.projectId && !sqlite.prepare("SELECT id FROM projects WHERE id = ?").get(body.projectId)) return sendNotFound(reply, "Project");
  const memoryId = id();
  const timestamp = now();
  sqlite.prepare("INSERT INTO memories (id, project_id, scope, memory_type, content, source_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?)")
    .run(memoryId, body.projectId ?? null, body.scope, body.memoryType, body.content, body.source ? JSON.stringify(body.source) : null, timestamp, timestamp);
  reply.code(201);
  return { id: memoryId, scope: body.scope, status: "approved", createdAt: timestamp };
});

app.get("/api/v1/memories", async (request) => {
  const query = z.object({ projectId: z.string().uuid().optional(), scope: z.enum(["global", "project", "conversation"]).optional() }).parse(request.query);
  return {
    items: sqlite.prepare("SELECT id, project_id, scope, memory_type, content, source_json, status, expires_at, created_at, updated_at FROM memories WHERE status = 'approved' AND (? IS NULL OR project_id = ?) AND (? IS NULL OR scope = ?) ORDER BY updated_at DESC")
      .all(query.projectId ?? null, query.projectId ?? null, query.scope ?? null, query.scope ?? null)
  };
});

app.patch("/api/v1/memories/:id", async (request, reply) => {
  const memoryId = validId(getParam(request, "id"));
  const body = z.object({ content: z.string().trim().min(1).max(10000) }).parse(request.body);
  const result = sqlite.prepare("UPDATE memories SET content = ?, updated_at = ? WHERE id = ?").run(body.content, now(), memoryId);
  if (!result.changes) return sendNotFound(reply, "Memory");
  return { id: memoryId, updated: true };
});

app.delete("/api/v1/memories/:id", async (request, reply) => {
  const memoryId = validId(getParam(request, "id"));
  const result = sqlite.prepare("DELETE FROM memories WHERE id = ?").run(memoryId);
  if (!result.changes) return sendNotFound(reply, "Memory");
  reply.code(204);
  return reply.send();
});


const workspaceCreateSchema = z.object({ name: z.string().trim().min(1).max(100) });

app.get("/api/v1/workspaces", async () => ({ items: listWorkspaces() }));

app.post("/api/v1/workspaces", async (request, reply) => {
  const body = workspaceCreateSchema.parse(request.body);
  const workspace = await createWorkspace(body.name);
  reply.code(201);
  return workspace;
});

app.get("/api/v1/workspaces/:id/tree", async (request, reply) => {
  const workspaceId = validId(getParam(request, "id"));
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return sendNotFound(reply, "Workspace");
  try {
    return { workspace, files: await listWorkspaceFiles(workspace) };
  } catch (error) {
    return reply.code(400).send({ error: { code: "workspace_error", message: error instanceof Error ? error.message : "Unable to read workspace." } });
  }
});

app.get("/api/v1/workspaces/:id/file", async (request, reply) => {
  const workspaceId = validId(getParam(request, "id"));
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return sendNotFound(reply, "Workspace");
  const query = z.object({ path: z.string().min(1).max(500) }).parse(request.query);
  try {
    return { path: query.path, content: await readWorkspaceFile(workspace, query.path) };
  } catch (error) {
    return reply.code(400).send({ error: { code: "workspace_file_error", message: error instanceof Error ? error.message : "Unable to read file." } });
  }
});

app.put("/api/v1/workspaces/:id/file", async (request, reply) => {
  const workspaceId = validId(getParam(request, "id"));
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return sendNotFound(reply, "Workspace");
  const body = z.object({
    path: z.string().min(1).max(500),
    content: z.string().max(1_000_000),
    confirmed: z.literal(true)
  }).parse(request.body);
  try {
    const result = await writeWorkspaceFile(workspace, body.path, body.content);
    return { workspaceId, path: body.path, ...result };
  } catch (error) {
    return reply.code(503).send({
      error: {
        code: "sandbox_unavailable",
        message: "The isolated coding sandbox is unavailable or rejected this operation. Build workers/coding/Dockerfile as cwl-coding-sandbox:local and retry."
      }
    });
  }
});

app.get("/api/v1/workspaces/:id/git/status", async (request, reply) => {
  const workspaceId = validId(getParam(request, "id"));
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return sendNotFound(reply, "Workspace");
  try {
    const result = await runWorkspaceCommand(workspace, "git status --short --branch", 30000);
    return { ...result };
  } catch {
    return reply.code(503).send({ error: { code: "sandbox_unavailable", message: "Build the isolated coding sandbox before running Git tools." } });
  }
});

app.get("/api/v1/workspaces/:id/git/diff", async (request, reply) => {
  const workspaceId = validId(getParam(request, "id"));
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return sendNotFound(reply, "Workspace");
  try {
    const result = await runWorkspaceCommand(workspace, "git diff --", 30000);
    return { ...result };
  } catch {
    return reply.code(503).send({ error: { code: "sandbox_unavailable", message: "Build the isolated coding sandbox before running Git tools." } });
  }
});

app.post("/api/v1/workspaces/:id/commands", async (request, reply) => {
  const workspaceId = validId(getParam(request, "id"));
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return sendNotFound(reply, "Workspace");
  const body = z.object({
    command: z.string().trim().min(1).max(4000),
    confirmed: z.literal(true),
    timeoutMs: z.coerce.number().int().min(1000).max(120000).default(120000)
  }).parse(request.body);
  try {
    const result = await runWorkspaceCommand(workspace, body.command, body.timeoutMs);
    return { ...result, workspaceId };
  } catch {
    return reply.code(503).send({ error: { code: "sandbox_unavailable", message: "The isolated coding sandbox could not start. Build workers/coding/Dockerfile as cwl-coding-sandbox:local." } });
  }
});

app.get("/api/v1/tools/manifest", async () => ({
  items: publicToolManifest(),
  execution: "Only tasks bound to an explicit workspace can call registered workspace tools. Mutating tools remain approval-gated by the server."
}));

app.get("/api/v1/runtime/status", async () => ({
  app: "ready",
  database: sqlite.open ? "ready" : "unavailable",
  provider: isProviderConfigured() ? "configured" : "not_configured",
  workers: { agent: isAgentProviderConfigured() ? "running" : "waiting_for_provider", concurrency: config.WORKER_CONCURRENCY, coding: "docker_sandbox", browser: "not_installed", research: "not_installed", scheduler: "not_installed" },
  security: { host: config.APP_HOST, remoteExposure: config.APP_HOST === "127.0.0.1" || config.APP_HOST === "::1" ? "loopback" : "requires_perimeter_authentication" }
}));

const hostIsLoopback = ["127.0.0.1", "::1", "localhost"].includes(config.APP_HOST);
if (!hostIsLoopback) {
  app.log.warn("APP_HOST is not loopback. Do not expose this unauthenticated service without a VPN or authenticated reverse proxy.");
}

const shutdown = async () => {
  await stopAgentWorkers();
  await app.close();
  sqlite.close();
};
process.once("SIGINT", () => void shutdown().then(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().then(() => process.exit(0)));

try {
  await app.listen({ host: config.APP_HOST, port: config.APP_PORT });
  if (isAgentProviderConfigured()) {
    startAgentWorkers((error) => app.log.error({ err: error }, "Agent worker error"));
  }
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
