# 05 — Database Design and ERD

## 1. Design principles

- Use generated text IDs (UUID/ULID) for portable local records.
- Store timestamps in UTC; store an explicit timezone for schedules.
- Use foreign keys and indexes for all major relationships.
- Store flexible provider/tool payloads as validated JSON, not arbitrary unbounded blobs.
- Keep original files on disk/object storage and keep metadata in the database.
- Use soft deletion only where recovery/audit behavior requires it.
- Do not create users or login sessions for the initial single-workspace scope.

## 2. Core entity relationships

    projects 1---N conversations
    conversations 1---N messages
    messages 1---N message_parts
    projects 1---N project_files
    files 1---N file_chunks
    projects 1---N artifacts
    artifacts 1---N artifact_versions
    conversations 1---N tasks
    tasks 1---N task_steps
    tasks 1---N task_events
    tasks 1---N task_approvals
    projects 1---N memories
    projects 1---N scheduled_tasks
    scheduled_tasks 1---N schedule_occurrences
    mcp_servers 1---N discovered_tools
    plugins 1---N plugin_capabilities

## 3. Tables

### projects
- id TEXT PRIMARY KEY
- name TEXT NOT NULL
- description TEXT
- instructions TEXT
- status TEXT NOT NULL DEFAULT 'active'
- created_at TEXT NOT NULL
- updated_at TEXT NOT NULL
- archived_at TEXT NULL

### conversations
- id TEXT PRIMARY KEY
- project_id TEXT NULL REFERENCES projects(id)
- title TEXT NOT NULL
- model_alias TEXT NOT NULL
- system_prompt_override TEXT NULL
- status TEXT NOT NULL DEFAULT 'active'
- created_at TEXT NOT NULL
- updated_at TEXT NOT NULL
- archived_at TEXT NULL

Indexes: project_id, updated_at, status.

### messages
- id TEXT PRIMARY KEY
- conversation_id TEXT NOT NULL REFERENCES conversations(id)
- parent_message_id TEXT NULL REFERENCES messages(id)
- turn_id TEXT NOT NULL
- role TEXT NOT NULL
- status TEXT NOT NULL
- model_alias TEXT NULL
- provider_request_id TEXT NULL
- created_at TEXT NOT NULL
- completed_at TEXT NULL

Indexes: conversation_id + created_at, turn_id, parent_message_id.

### message_parts
- id TEXT PRIMARY KEY
- message_id TEXT NOT NULL REFERENCES messages(id)
- sequence INTEGER NOT NULL
- part_type TEXT NOT NULL
- content_json TEXT NOT NULL
- created_at TEXT NOT NULL

Unique index: message_id + sequence. Part types include text, thinking_metadata, tool_call, tool_result, attachment_ref, citation, error, and structured_output. Do not persist private provider reasoning that is not explicitly exposed for display.

### files
- id TEXT PRIMARY KEY
- project_id TEXT NULL REFERENCES projects(id)
- conversation_id TEXT NULL REFERENCES conversations(id)
- original_name TEXT NOT NULL
- storage_key TEXT NOT NULL UNIQUE
- mime_type TEXT NOT NULL
- size_bytes INTEGER NOT NULL
- checksum TEXT NOT NULL
- status TEXT NOT NULL
- created_at TEXT NOT NULL
- deleted_at TEXT NULL

### project_files
- project_id TEXT NOT NULL REFERENCES projects(id)
- file_id TEXT NOT NULL REFERENCES files(id)
- ingestion_status TEXT NOT NULL
- created_at TEXT NOT NULL
- PRIMARY KEY (project_id, file_id)

### file_chunks
- id TEXT PRIMARY KEY
- file_id TEXT NOT NULL REFERENCES files(id)
- project_id TEXT NULL REFERENCES projects(id)
- chunk_index INTEGER NOT NULL
- text_content TEXT NOT NULL
- token_estimate INTEGER
- embedding_ref TEXT NULL
- metadata_json TEXT
- created_at TEXT NOT NULL

Indexes: file_id + chunk_index, project_id. Vector index may live in an external/pluggable vector store.

### artifacts
- id TEXT PRIMARY KEY
- project_id TEXT NULL REFERENCES projects(id)
- conversation_id TEXT NULL REFERENCES conversations(id)
- task_id TEXT NULL REFERENCES tasks(id)
- title TEXT NOT NULL
- artifact_type TEXT NOT NULL
- current_version_id TEXT NULL
- visibility TEXT NOT NULL DEFAULT 'local'
- created_at TEXT NOT NULL
- updated_at TEXT NOT NULL

### artifact_versions
- id TEXT PRIMARY KEY
- artifact_id TEXT NOT NULL REFERENCES artifacts(id)
- version_number INTEGER NOT NULL
- storage_key TEXT NOT NULL
- content_hash TEXT NOT NULL
- metadata_json TEXT
- created_at TEXT NOT NULL
- UNIQUE (artifact_id, version_number)

### tasks
- id TEXT PRIMARY KEY
- project_id TEXT NULL REFERENCES projects(id)
- conversation_id TEXT NULL REFERENCES conversations(id)
- parent_task_id TEXT NULL REFERENCES tasks(id)
- title TEXT NOT NULL
- description TEXT NOT NULL
- status TEXT NOT NULL
- priority INTEGER NOT NULL DEFAULT 0
- task_type TEXT NOT NULL
- model_alias TEXT NOT NULL
- execution_mode TEXT NOT NULL
- iteration_limit INTEGER NOT NULL
- token_budget INTEGER NULL
- time_limit_seconds INTEGER NULL
- checkpoint_json TEXT NULL
- created_at TEXT NOT NULL
- started_at TEXT NULL
- completed_at TEXT NULL
- updated_at TEXT NOT NULL

Indexes: status + priority, project_id, parent_task_id, updated_at.

### task_steps
- id TEXT PRIMARY KEY
- task_id TEXT NOT NULL REFERENCES tasks(id)
- step_number INTEGER NOT NULL
- title TEXT NOT NULL
- description TEXT
- status TEXT NOT NULL
- tool_name TEXT NULL
- input_json TEXT NULL
- output_json TEXT NULL
- error_json TEXT NULL
- started_at TEXT NULL
- completed_at TEXT NULL
- UNIQUE (task_id, step_number)

### task_events
- id TEXT PRIMARY KEY
- task_id TEXT NOT NULL REFERENCES tasks(id)
- sequence INTEGER NOT NULL
- event_type TEXT NOT NULL
- payload_json TEXT NOT NULL
- occurred_at TEXT NOT NULL
- UNIQUE (task_id, sequence)

### task_approvals
- id TEXT PRIMARY KEY
- task_id TEXT NOT NULL REFERENCES tasks(id)
- step_id TEXT NULL REFERENCES task_steps(id)
- action_name TEXT NOT NULL
- target_json TEXT NOT NULL
- status TEXT NOT NULL
- requested_at TEXT NOT NULL
- decided_at TEXT NULL
- decision_reason TEXT NULL

### scheduled_tasks
- id TEXT PRIMARY KEY
- project_id TEXT NULL REFERENCES projects(id)
- title TEXT NOT NULL
- task_payload_json TEXT NOT NULL
- cron_expression TEXT NOT NULL
- timezone TEXT NOT NULL
- enabled INTEGER NOT NULL DEFAULT 1
- next_run_at TEXT NOT NULL
- last_run_at TEXT NULL
- retry_policy_json TEXT
- created_at TEXT NOT NULL
- updated_at TEXT NOT NULL

### schedule_occurrences
- id TEXT PRIMARY KEY
- scheduled_task_id TEXT NOT NULL REFERENCES scheduled_tasks(id)
- occurrence_key TEXT NOT NULL UNIQUE
- task_id TEXT NULL REFERENCES tasks(id)
- scheduled_for TEXT NOT NULL
- status TEXT NOT NULL
- created_at TEXT NOT NULL

### memories
- id TEXT PRIMARY KEY
- project_id TEXT NULL REFERENCES projects(id)
- scope TEXT NOT NULL
- memory_type TEXT NOT NULL
- content TEXT NOT NULL
- source_json TEXT
- confidence REAL NULL
- status TEXT NOT NULL
- expires_at TEXT NULL
- created_at TEXT NOT NULL
- updated_at TEXT NOT NULL

Indexes: project_id + scope + status, expires_at.

### skills
- id TEXT PRIMARY KEY
- name TEXT NOT NULL
- version TEXT NOT NULL
- source_path TEXT NOT NULL
- manifest_json TEXT NOT NULL
- enabled INTEGER NOT NULL DEFAULT 0
- reviewed_at TEXT NULL
- created_at TEXT NOT NULL
- updated_at TEXT NOT NULL

### plugins
- id TEXT PRIMARY KEY
- name TEXT NOT NULL
- version TEXT NOT NULL
- source_path TEXT NOT NULL
- manifest_json TEXT NOT NULL
- enabled INTEGER NOT NULL DEFAULT 0
- trust_status TEXT NOT NULL
- created_at TEXT NOT NULL
- updated_at TEXT NOT NULL

### mcp_servers
- id TEXT PRIMARY KEY
- name TEXT NOT NULL
- transport TEXT NOT NULL
- config_json TEXT NOT NULL
- enabled INTEGER NOT NULL DEFAULT 0
- health_status TEXT NOT NULL
- last_connected_at TEXT NULL
- created_at TEXT NOT NULL
- updated_at TEXT NOT NULL

### discovered_tools
- id TEXT PRIMARY KEY
- source_type TEXT NOT NULL
- source_id TEXT NOT NULL
- tool_name TEXT NOT NULL
- description TEXT
- input_schema_json TEXT NOT NULL
- permissions_json TEXT NOT NULL
- enabled INTEGER NOT NULL DEFAULT 0
- updated_at TEXT NOT NULL

Unique index: source_type + source_id + tool_name.

### settings
- key TEXT PRIMARY KEY
- value_json TEXT NOT NULL
- updated_at TEXT NOT NULL

Only non-secret runtime preferences belong here. Provider API keys remain in environment/secret configuration.

### model_usage
- id TEXT PRIMARY KEY
- conversation_id TEXT NULL REFERENCES conversations(id)
- task_id TEXT NULL REFERENCES tasks(id)
- model_alias TEXT NOT NULL
- provider_model_id TEXT NOT NULL
- input_tokens INTEGER NULL
- output_tokens INTEGER NULL
- cached_tokens INTEGER NULL
- estimated_cost REAL NULL
- request_duration_ms INTEGER NULL
- created_at TEXT NOT NULL

## 4. SQLite implementation notes

- Enable foreign keys.
- Use WAL mode where appropriate.
- Add indexes for all list and lookup paths.
- Keep migrations under version control.
- Use transactions for task transitions and scheduler dispatch.
- Use FTS5 for conversation and document lexical search.
- Do not store large binary files in SQLite; store metadata and a storage key.

## 5. Migration strategy

1. Establish initial schema and migration tooling before feature implementation.
2. Add tables with additive migrations where possible.
3. Backfill new required fields before enforcing constraints.
4. Keep migration execution observable and fail startup safely if migrations cannot complete.
5. Document backup requirements before schema upgrades.