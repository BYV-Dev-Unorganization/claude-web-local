import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
fs.mkdirSync(config.storagePath, { recursive: true });
fs.mkdirSync(config.workspacePath, { recursive: true });

export const sqlite = new Database(config.databasePath);
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("busy_timeout = 5000");

sqlite.exec(String.raw`
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, instructions TEXT,
  status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  parent_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  branch_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  title TEXT NOT NULL, model_alias TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_conversations_project_updated ON conversations(project_id, updated_at);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  parent_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL, turn_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
  status TEXT NOT NULL, content TEXT NOT NULL, model_alias TEXT, usage_json TEXT,
  created_at TEXT NOT NULL, completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL, checksum TEXT NOT NULL, status TEXT NOT NULL,
  extracted_text TEXT, created_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS file_chunks (
  id TEXT PRIMARY KEY, file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, chunk_index INTEGER NOT NULL,
  text_content TEXT NOT NULL, metadata_json TEXT, created_at TEXT NOT NULL,
  UNIQUE(file_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_chunks_project ON file_chunks(project_id);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  title TEXT NOT NULL, artifact_type TEXT NOT NULL, current_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artifact_versions (
  id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL, content TEXT NOT NULL, content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL, UNIQUE(artifact_id, version_number)
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  title TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL,
  task_type TEXT NOT NULL, model_alias TEXT NOT NULL, execution_mode TEXT NOT NULL,
  iteration_limit INTEGER NOT NULL, token_budget INTEGER, time_limit_seconds INTEGER,
  checkpoint_json TEXT, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT,
  updated_at TEXT NOT NULL, worker_lease_until TEXT, worker_id TEXT,
  worker_lease_token_hash TEXT, worker_attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tasks_status_updated ON tasks(status, updated_at);
CREATE TABLE IF NOT EXISTS task_steps (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL, title TEXT NOT NULL, description TEXT, status TEXT NOT NULL,
  tool_name TEXT, input_json TEXT, output_json TEXT, error_json TEXT,
  started_at TEXT, completed_at TEXT, UNIQUE(task_id, step_number)
);
CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL, event_type TEXT NOT NULL, payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL, UNIQUE(task_id, sequence)
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  step_id TEXT REFERENCES task_steps(id) ON DELETE SET NULL, action_name TEXT NOT NULL,
  payload_hash TEXT NOT NULL, target_json TEXT NOT NULL, status TEXT NOT NULL,
  requested_at TEXT NOT NULL, expires_at TEXT NOT NULL, decided_at TEXT, decision_reason TEXT
);
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, relative_path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tool_definitions (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, version TEXT NOT NULL,
  description TEXT NOT NULL, input_schema_json TEXT NOT NULL, permissions_json TEXT NOT NULL,
  source_type TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tool_invocations (
  id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL, input_json TEXT NOT NULL, output_json TEXT, status TEXT NOT NULL,
  error_json TEXT, started_at TEXT NOT NULL, completed_at TEXT
);
CREATE TABLE IF NOT EXISTS research_jobs (
  id TEXT PRIMARY KEY, query TEXT NOT NULL, status TEXT NOT NULL, plan_json TEXT,
  report_markdown TEXT, error_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS research_sources (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES research_jobs(id) ON DELETE CASCADE,
  url TEXT NOT NULL, title TEXT, domain TEXT, excerpt TEXT, retrieved_at TEXT NOT NULL,
  UNIQUE(job_id, url)
);
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, transport TEXT NOT NULL,
  config_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
  health_status TEXT NOT NULL DEFAULT 'unconfigured', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS connectors (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, config_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'unconfigured',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL, manifest_json TEXT NOT NULL,
  trust_status TEXT NOT NULL DEFAULT 'unreviewed', enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL, manifest_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0, reviewed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  scope TEXT NOT NULL, memory_type TEXT NOT NULL, content TEXT NOT NULL, source_json TEXT,
  confidence REAL, status TEXT NOT NULL, expires_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_scope_status ON memories(project_id, scope, status);
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL, task_payload_json TEXT NOT NULL, cron_expression TEXT NOT NULL,
  timezone TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, next_run_at TEXT NOT NULL,
  last_run_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS schedule_occurrences (
  id TEXT PRIMARY KEY, scheduled_task_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
  occurrence_key TEXT NOT NULL UNIQUE, task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  scheduled_for TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS model_usage (
  id TEXT PRIMARY KEY, conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL, model_alias TEXT NOT NULL,
  provider_model_id TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER,
  request_duration_ms INTEGER, created_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS message_search USING fts5(message_id UNINDEXED, conversation_id UNINDEXED, content);
CREATE VIRTUAL TABLE IF NOT EXISTS file_search USING fts5(file_id UNINDEXED, project_id UNINDEXED, content);
`);

const conversationColumns = sqlite.pragma("table_info(conversations)") as Array<{ name: string }>;
const hasColumn = (name: string) => conversationColumns.some((column) => column.name === name);
if (!hasColumn("parent_conversation_id")) {
  sqlite.exec("ALTER TABLE conversations ADD COLUMN parent_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL");
}
if (!hasColumn("branch_message_id")) {
  sqlite.exec("ALTER TABLE conversations ADD COLUMN branch_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL");
}
sqlite.exec("CREATE INDEX IF NOT EXISTS idx_conversations_parent ON conversations(parent_conversation_id)");
const taskColumns = sqlite.pragma("table_info(tasks)") as Array<{ name: string }>;
const hasTaskColumn = (name: string) => taskColumns.some((column) => column.name === name);
if (!hasTaskColumn("worker_id")) sqlite.exec("ALTER TABLE tasks ADD COLUMN worker_id TEXT");
if (!hasTaskColumn("worker_lease_token_hash")) sqlite.exec("ALTER TABLE tasks ADD COLUMN worker_lease_token_hash TEXT");
if (!hasTaskColumn("worker_attempts")) sqlite.exec("ALTER TABLE tasks ADD COLUMN worker_attempts INTEGER NOT NULL DEFAULT 0");
sqlite.exec("CREATE INDEX IF NOT EXISTS idx_tasks_worker_claim ON tasks(status, worker_lease_until, created_at)");

const recordSchemaVersion = sqlite.prepare("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)");
const migrationTime = new Date().toISOString();
recordSchemaVersion.run(1, migrationTime);
recordSchemaVersion.run(2, migrationTime);
recordSchemaVersion.run(3, migrationTime);

export const db = drizzle(sqlite);

export function nowIso(): string {
  return new Date().toISOString();
}

export function closeDatabase(): void {
  sqlite.close();
}
