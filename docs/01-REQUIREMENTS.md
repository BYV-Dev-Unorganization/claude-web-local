# 01 — Product Requirements

## 1. Requirement notation

- P0: required for a usable foundation or security.
- P1: required for the full product target.
- P2: advanced capability or optimization.
- Acceptance criteria are observable outcomes, not implementation assumptions.

A feature must not be marked complete merely because its button or screen exists.

## 2. Functional requirements

### FR-CHAT — Chat and conversations (P0)

- FR-CHAT-001: Create, rename, archive, restore, and delete conversations.
- FR-CHAT-002: Send multi-turn messages and stream assistant output.
- FR-CHAT-003: Persist messages, message parts, tool calls, and errors.
- FR-CHAT-004: Stop an in-flight generation and safely handle cancellation.
- FR-CHAT-005: Edit a prior user message and create a new response branch.
- FR-CHAT-006: Regenerate an assistant response.
- FR-CHAT-007: Switch among configured model aliases per conversation or turn.
- FR-CHAT-008: Render Markdown, code, tables, citations, images, and structured content.
- FR-CHAT-009: Search and filter conversations by text, project, model, and date.
- FR-CHAT-010: Export conversations to Markdown or JSON.

Acceptance: a conversation remains available after a process restart, and a cancelled generation does not create a false completed response.

### FR-MODEL — Provider and model routing (P0)

- FR-MODEL-001: Load provider endpoint, API key, and model IDs from environment variables.
- FR-MODEL-002: Resolve fable, opus, sonnet, and haiku aliases through one ModelRouter.
- FR-MODEL-003: Support provider adapters rather than embedding provider-specific calls in features.
- FR-MODEL-004: Normalize text, streaming, tool calls, usage, errors, and supported multimodal inputs.
- FR-MODEL-005: Declare model capabilities, including streaming, tools, vision, JSON output, and thinking.
- FR-MODEL-006: Reject or downgrade unsupported features with a clear user-visible explanation.
- FR-MODEL-007: Apply timeout, retry, rate-limit, and cancellation policies.
- FR-MODEL-008: Record token/usage metadata where the provider returns it.
- FR-MODEL-009: Never return API secrets to the frontend.

Acceptance: each configured alias resolves to its own environment-supplied model ID; changing an ID requires no source-code edit.

### FR-THINKING — Extended thinking (P1)

- FR-THINKING-001: Show a thinking status when the provider reports a thinking phase.
- FR-THINKING-002: Pass supported thinking parameters through the adapter.
- FR-THINKING-003: Store provider-approved thinking metadata separately from the final answer.
- FR-THINKING-004: Never fabricate or expose private chain-of-thought.
- FR-THINKING-005: Disable or explain the control if the chosen model does not support it.

### FR-PROJECT — Projects and knowledge (P0/P1)

- FR-PROJECT-001: Create, update, archive, and delete projects.
- FR-PROJECT-002: Store project description and custom instructions.
- FR-PROJECT-003: Attach conversations, files, artifacts, skills, and memory to a project.
- FR-PROJECT-004: Ingest supported documents through parsing, chunking, and indexing.
- FR-PROJECT-005: Retrieve relevant chunks with source references for RAG.
- FR-PROJECT-006: Isolate project context from unrelated projects.
- FR-PROJECT-007: Re-index files after replacement or deletion.

### FR-ARTIFACT — Artifacts (P1)

- FR-ARTIFACT-001: Create and persist artifacts generated from a conversation or task.
- FR-ARTIFACT-002: Support HTML, React, SVG, Mermaid, chart specifications, Markdown, and code previews.
- FR-ARTIFACT-003: Preview generated content in an isolated sandbox.
- FR-ARTIFACT-004: Maintain version history and restore prior versions.
- FR-ARTIFACT-005: Export artifacts in supported formats.
- FR-ARTIFACT-006: Do not execute artifact code in the application's trusted origin.

### FR-RESEARCH — Web search and deep research (P1)

- FR-RESEARCH-001: Execute web searches through a configurable search provider.
- FR-RESEARCH-002: Fetch and extract readable content from permitted public URLs.
- FR-RESEARCH-003: Preserve source URL, title, domain, retrieval time, and excerpt.
- FR-RESEARCH-004: Deduplicate sources and associate claims with citations.
- FR-RESEARCH-005: Create a multi-step research plan and execute follow-up searches.
- FR-RESEARCH-006: Detect research gaps and stop at configurable limits.
- FR-RESEARCH-007: Generate a report with citations and export options.
- FR-RESEARCH-008: Enforce URL, network, time, source-count, and content-size limits.

### FR-AGENT — Agent runtime and Cowork-like workflows (P1)

- FR-AGENT-001: Accept a task and generate a structured plan.
- FR-AGENT-002: Execute registered tools through a controlled loop.
- FR-AGENT-003: Persist task, step, event, and approval state.
- FR-AGENT-004: Support queued, planning, running, waiting_approval, waiting_input, paused, completed, failed, and cancelled states.
- FR-AGENT-005: Pause, resume, cancel, retry, and continue tasks.
- FR-AGENT-006: Require approval for configured sensitive actions.
- FR-AGENT-007: Recover eligible tasks after process restart.
- FR-AGENT-008: Enforce iteration, token, time, concurrency, and tool-call limits.
- FR-AGENT-009: Show plan, current step, tool status, and result in the UI.

### FR-CODING — Coding workspace (P1)

- FR-CODING-001: Select an explicit workspace/repository root.
- FR-CODING-002: Read, list, search, create, and edit files within approved roots.
- FR-CODING-003: Run commands and tests in an isolated execution environment.
- FR-CODING-004: Integrate Git status, diff, branch, commit, and optionally push workflows.
- FR-CODING-005: Preview diffs before applying or committing changes.
- FR-CODING-006: Support snapshots and rollback.
- FR-CODING-007: Restrict paths, commands, environment variables, CPU, memory, and execution time.

### FR-BROWSER — Browser automation (P1)

- FR-BROWSER-001: Use a managed Playwright browser runtime.
- FR-BROWSER-002: Navigate, inspect DOM snapshots, click, type, fill, select, scroll, wait, and capture screenshots.
- FR-BROWSER-003: Manage isolated browser contexts and session lifetimes.
- FR-BROWSER-004: Apply domain allowlists and private-network protections.
- FR-BROWSER-005: Restrict downloads and browser storage.
- FR-BROWSER-006: Require approvals for sensitive form submissions or external side effects.
- FR-BROWSER-007: Do not implement desktop or general Computer Use.

### FR-EXT — MCP, connectors, plugins, and skills (P1)

- FR-EXT-001: Register and manage MCP servers with stdio and Streamable HTTP transports.
- FR-EXT-002: Discover MCP tools/resources/prompts and normalize tool schemas.
- FR-EXT-003: Enable/disable servers and inspect health and logs.
- FR-EXT-004: Register connectors through MCP or dedicated API adapters.
- FR-EXT-005: Support plugin manifests that declare tools, skills, permissions, and UI contributions.
- FR-EXT-006: Load skills with instructions, references, examples, and optional scripts.
- FR-EXT-007: Validate and permission-check all external tools and plugin actions.
- FR-EXT-008: Require explicit operator activation for executable MCP/plugin components.

### FR-MEMORY — Memory (P1)

- FR-MEMORY-001: Store global, project, task, explicit, and derived memory records.
- FR-MEMORY-002: Extract candidate memories with source and confidence metadata.
- FR-MEMORY-003: Support review, edit, search, pin, expire, and delete.
- FR-MEMORY-004: Prevent unrelated project memories from leaking across scopes.
- FR-MEMORY-005: Avoid storing secrets and sensitive data by default.

### FR-SCHEDULE — Scheduled tasks (P1)

- FR-SCHEDULE-001: Create, edit, pause, resume, and delete schedules.
- FR-SCHEDULE-002: Support cron expressions and explicit time zones.
- FR-SCHEDULE-003: Persist next-run time and execution history.
- FR-SCHEDULE-004: Dispatch due tasks into the durable queue.
- FR-SCHEDULE-005: Support retry limits, timeout, and failure notification.
- FR-SCHEDULE-006: Avoid duplicate execution when workers restart or multiple dispatchers run.

### FR-MULTI — Multi-agent execution (P1/P2)

- FR-MULTI-001: Define agent role, model alias, tools, limits, and permissions.
- FR-MULTI-002: Delegate child tasks from a parent task.
- FR-MULTI-003: Represent dependencies and parallelizable task groups.
- FR-MULTI-004: Aggregate outputs with source/task attribution.
- FR-MULTI-005: Enforce global concurrency and resource limits.
- FR-MULTI-006: Support cancellation propagation and partial-failure handling.

### FR-FILE — Files and generated documents (P1)

- FR-FILE-001: Upload, validate, preview, parse, store, and delete files.
- FR-FILE-002: Support common text, source-code, PDF, Office, CSV, JSON, XML, image, audio, and notebook formats where adapters are available.
- FR-FILE-003: Generate Markdown, PDF, DOCX, XLSX, CSV, PPTX, JSON, HTML, SVG, and ZIP where generation adapters are installed.
- FR-FILE-004: Enforce MIME, size, archive expansion, and retention limits.
- FR-FILE-005: Keep original files and derived representations traceable.

### FR-VOICE — Voice (P2)

- FR-VOICE-001: Integrate configurable STT and TTS providers.
- FR-VOICE-002: Support microphone capture, transcription, playback, interruption, and audio attachments.
- FR-VOICE-003: Treat voice providers independently from the chat model provider.

### FR-VISUAL — Visualizations (P1)

- FR-VISUAL-001: Render charts, tables, Mermaid diagrams, timelines, and dashboards.
- FR-VISUAL-002: Persist reusable visual outputs as artifacts.
- FR-VISUAL-003: Validate visualization specifications before rendering.

### FR-OPS — Operations (P0)

- FR-OPS-001: Provide health and readiness endpoints.
- FR-OPS-002: Provide structured logs and task diagnostics.
- FR-OPS-003: Support database migrations, backup, and restore.
- FR-OPS-004: Provide configurable storage, bind address, port, and worker concurrency.
- FR-OPS-005: Document safe local and remote deployment.

## 3. Non-functional requirements

- NFR-SEC-001: Secrets remain server-side and are redacted from logs.
- NFR-SEC-002: Privileged tools are enforced by a backend policy engine.
- NFR-SEC-003: Workers use least privilege and isolated workspaces.
- NFR-DUR-001: Conversations, tasks, schedules, and events survive restart.
- NFR-OBS-001: Every task and tool invocation has a traceable identifier.
- NFR-PERF-001: Streaming should begin as soon as provider output is available.
- NFR-PERF-002: Long-running work must not block the HTTP request process.
- NFR-MAINT-001: Modules expose typed interfaces and are independently testable.
- NFR-COMPAT-001: Provider-specific behavior is isolated behind adapters.
- NFR-PRIV-001: Data retention and deletion are explicit and documented.
- NFR-UX-001: Unsupported capabilities are communicated clearly.

## 4. Release policy

A requirement is complete only when implementation, automated tests, user-facing behavior, error handling, security review where applicable, and documentation are all present.