# 02 — Use Cases

## 1. Actors

| Actor | Description |
|---|---|
| Workspace Operator | Person running and configuring this local installation |
| Chat User | Person interacting with the local workspace UI; initially the operator |
| Agent Runtime | Backend coordinator that plans and executes tasks |
| Model Provider | Configured external or local-compatible model API |
| Tool Server | Built-in tool, MCP server, connector, or plugin |
| Scheduler | Dispatches recurring tasks |
| Browser Worker | Isolated browser automation process |
| Coding Worker | Isolated filesystem and command execution process |

There is no application account actor and no login/logout use case.

## 2. Chat and model use cases

### UC-CHAT-01 — Start a conversation

Preconditions:
- Application is ready.
- At least one model alias is configured and valid.

Main flow:
1. User selects New Chat.
2. UI creates a conversation record.
3. User selects an available model alias.
4. User enters a prompt and optionally attaches files.
5. Chat Engine validates the request and builds context.
6. ModelRouter resolves the alias and provider adapter.
7. Assistant output streams to the UI.
8. Message parts and usage metadata are persisted.

Alternative flows:
- If no model is configured, show configuration guidance.
- If the provider is unavailable, persist an error state and allow retry.
- If the user stops generation, cancel upstream work where supported.

Acceptance:
- Conversation and messages survive restart.
- API keys never appear in browser network responses.

### UC-CHAT-02 — Switch model

1. User selects an alias: fable, opus, sonnet, or haiku.
2. Backend verifies that the alias is configured.
3. UI displays the resolved public model label without exposing secrets.
4. The next turn uses the selected alias.

### UC-CHAT-03 — Search conversation history

1. User enters a query.
2. Backend searches indexed conversation text.
3. Results include title, matching excerpt, updated time, and project.
4. User opens a result at the relevant conversation.

## 3. Project and knowledge use cases

### UC-PROJECT-01 — Create project

1. User creates a project with a name and optional description.
2. Backend persists project metadata and instructions.
3. Project appears in the sidebar.
4. User can create project-scoped conversations.

### UC-PROJECT-02 — Add knowledge files

1. User uploads one or more supported files.
2. File Engine validates size and type.
3. Parser extracts text and metadata.
4. Ingestion pipeline chunks content and generates embeddings if configured.
5. Index records source file, chunk, and retrieval metadata.
6. Project UI reports ingestion status.

Alternative:
- If embeddings are unavailable, the system may use a documented lexical retrieval fallback.
- Unsupported or malformed files are rejected with an actionable error.

### UC-PROJECT-03 — Ask using project knowledge

1. User asks a question inside a project.
2. Context Builder retrieves relevant chunks.
3. Retrieved chunks are added with source identifiers.
4. Model generates an answer.
5. UI displays citations to the project files.

## 4. Research and artifact use cases

### UC-RESEARCH-01 — Run deep research

1. User submits a research question.
2. Research Engine drafts a plan.
3. User reviews or edits the plan when configured.
4. Search workers discover candidate sources.
5. Fetch workers extract readable content.
6. Evaluator deduplicates and scores sources.
7. Gap detector requests additional searches until limits are reached.
8. Synthesis step creates a report with citations.
9. Report is saved and can be exported.

### UC-ARTIFACT-01 — Generate an artifact

1. User asks for an interactive output.
2. Assistant returns a structured artifact payload.
3. Artifact Engine validates type and content.
4. Source and version metadata are stored.
5. UI opens the preview in an isolated frame.
6. User can edit, restore, or export versions.

## 5. Agent and coding use cases

### UC-AGENT-01 — Execute an agent task

1. User describes a goal.
2. Agent Runtime creates a task and execution budget.
3. Planner creates ordered steps and tool requirements.
4. Permission Engine evaluates planned actions.
5. Approval-required steps wait for user approval.
6. Worker executes an allowed tool.
7. Result is recorded as a task event.
8. Agent observes the result and continues or replans.
9. Final output and generated files are attached to the task.

### UC-AGENT-02 — Pause and resume

1. User pauses a running task.
2. Runtime stops scheduling new steps and safely interrupts cancellable work.
3. Task state and current checkpoint are persisted.
4. User resumes the task.
5. Worker reloads the checkpoint and continues.

### UC-CODING-01 — Modify a repository

1. User selects a repository root.
2. Coding Worker creates an isolated workspace or snapshot.
3. Agent inspects files and Git state.
4. Agent proposes a plan.
5. Read operations execute under workspace policy.
6. Write and shell actions are checked by Permission Engine.
7. User approves sensitive actions when required.
8. Worker applies changes and runs configured tests.
9. UI shows diffs and test results.
10. User may accept changes, request revisions, or roll back.

## 6. Browser use cases

### UC-BROWSER-01 — Automate a website

1. User requests a browser task.
2. Browser Worker creates an isolated context.
3. Domain and network policies are loaded.
4. Agent navigates and inspects the page.
5. DOM-based actions execute through registered tools.
6. Sensitive external side effects pause for approval.
7. Screenshots, page summaries, and action results are recorded.
8. Session closes or is retained according to policy.

Computer Use and host desktop control are not part of this use case.

## 7. Extensibility use cases

### UC-MCP-01 — Register an MCP server

1. Operator adds a server configuration.
2. Configuration is validated.
3. Operator explicitly enables the server.
4. MCP Manager establishes the configured transport.
5. Tool/resource/prompt capabilities are discovered.
6. Tools are shown with declared permissions.
7. Tool invocation is checked at runtime.

### UC-SKILL-01 — Install a skill

1. Operator imports a skill package or adds it to the skills directory.
2. Manifest and instructions are validated.
3. Skill permissions and scripts are reviewed.
4. Operator enables the skill.
5. Agent discovers it when relevant.

## 8. Memory and scheduler use cases

### UC-MEMORY-01 — Review a memory candidate

1. Memory Engine proposes a candidate with source and scope.
2. User reviews the candidate.
3. User approves, edits, or rejects it.
4. Approved memory becomes searchable within its scope.

### UC-SCHEDULE-01 — Create a recurring task

1. User defines a task, cron expression, timezone, and limits.
2. Scheduler validates the schedule.
3. Schedule and next-run time are persisted.
4. Dispatcher enqueues due occurrences.
5. Agent Worker executes each occurrence.
6. History and output are recorded.
7. Retry policy handles transient failures without unbounded repetition.

## 9. Operational use cases

- UC-OPS-01: Inspect health and readiness.
- UC-OPS-02: View logs and task diagnostics.
- UC-OPS-03: Back up database and stored files.
- UC-OPS-04: Restore a verified backup.
- UC-OPS-05: Change environment configuration and restart safely.