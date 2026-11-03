# 04 — System Architecture

## 1. Recommended topology

Start with a modular monolith and separate worker processes. This keeps local development and deployment manageable while preserving module boundaries that can later be extracted into services.

    Browser UI
       |
       v
    HTTP API / SSE Gateway
       |
       +---- Chat Orchestrator ---- Model Router ---- Provider Adapters
       |             |
       |             +---- Context Builder / RAG
       |             +---- Tool Registry ---- Permission Engine
       |             |          +---- Web Search / Fetch
       |             |          +---- File Tools
       |             |          +---- Browser Tools
       |             |          +---- Coding Tools
       |             |          +---- MCP / Connector / Plugin Tools
       |             |
       |             +---- Artifact Engine
       |
       +---- Project / File / Memory / Settings APIs
       |
       +---- Task API ---- Persistent Queue ---- Agent Workers
       |                                      +-- Research Worker
       |                                      +-- Coding Worker
       |                                      +-- Browser Worker
       |                                      +-- General Worker
       |
       +---- Scheduler / Dispatcher
       |
       +---- Database and Local Storage

## 2. Suggested technology choices

| Layer | Initial choice | Notes |
|---|---|---|
| Frontend | React + TypeScript + Vite | Local web workspace |
| Styling | Tailwind CSS + component primitives | Accessible reusable UI |
| State | Zustand for UI state; TanStack Query for server state | Avoid duplicated server cache |
| Backend | Node.js + TypeScript + Fastify | Typed modular API |
| Validation | Zod | Request and tool schema validation |
| ORM | Drizzle ORM | Typed schema and migrations |
| Initial DB | SQLite | Suitable for single-node local deployment |
| Search | SQLite FTS5 initially | PostgreSQL full-text later if needed |
| Vector retrieval | Pluggable vector adapter | Do not bind RAG to one vector database |
| Queue | Persistent SQLite-backed queue initially or Redis/BullMQ | Select one durable implementation before agent phase |
| Browser | Playwright | DOM/browser automation only |
| Editor | Monaco Editor | Coding workspace |
| Tests | Vitest + Playwright | Unit, integration, E2E |
| Packaging | Docker Compose optional | Do not require Docker for local development |

SQLite and a single-node queue are acceptable for an initial single-workspace release. If multiple workers, high concurrency, or multiple application replicas are required, use PostgreSQL and Redis/BullMQ with explicit operational requirements.

## 3. Backend modules

### API Gateway
- REST endpoints and SSE streams.
- Request validation, response normalization, rate limiting, and health checks.
- No provider or tool business logic.

### Chat Engine
- Conversation and turn lifecycle.
- Context assembly.
- Message persistence.
- Stream event orchestration.
- Cancellation and retry coordination.

### Model Router
- Resolves aliases to configured IDs.
- Selects provider adapters.
- Enforces capability checks.
- Normalizes provider events and errors.

### Provider Adapters
- Encapsulate protocol-specific request/response handling.
- Keep Anthropic-compatible, OpenAI-compatible, and future adapters separate.
- Normalize tools, usage, streaming, vision, and thinking only where supported.

### Tool Registry
- Registers typed tools and metadata.
- Validates input/output schemas.
- Exposes tools to the model in the provider's required format.
- Routes invocation through Permission Engine.

### Agent Runtime
- Planner, step scheduler, observer, retry policy, checkpoints, budgets, and task events.
- Must not run long tasks inside an HTTP request handler.

### Workers
- Execute background work in bounded processes/containers.
- Use task leases/heartbeats and durable checkpoints.
- Separate coding and browser workers from the main API process.

### Project and Knowledge Engine
- Project metadata and instructions.
- File ingestion, chunking, embedding adapter, retrieval, and citation source map.

### Research Engine
- Search provider adapter, fetcher, source normalization, deduplication, evaluation, iterative planning, and report synthesis.

### Artifact Engine
- Artifact schema, versions, source storage, preview routing, export, and sandbox policy.

### Memory Engine
- Candidate extraction, privacy filtering, approval, scope, retrieval, expiry, and deletion.

### Scheduler
- Cron parsing, timezone-aware next-run calculation, durable due-task dispatch, and idempotency.

### MCP / Connector / Plugin / Skill managers
- Lifecycle, manifests, validation, tool discovery, configuration, and runtime integration.
- External code is not trusted by default.

### Permission Engine
- Central policy evaluation for every tool call.
- Evaluates tool identity, scope, target, operation, task, and configured approval policy.
- Must run on the backend, never only in the UI.

## 4. Frontend areas

- Chat: messages, streaming, composer, attachments, citations, tool statuses.
- Projects: project list, instructions, files, knowledge status, scoped chats.
- Artifacts: preview, source/version editor, export.
- Research: plan, source list, progress, report.
- Tasks: queue, plan, current step, approvals, logs, pause/resume/cancel.
- Coding: file tree, editor, terminal output, diff, tests, Git state.
- Browser: session status, current URL, page snapshot, screenshots, action log.
- Skills: discovery, enable/disable, documentation.
- MCP and connectors: server status, tools, configuration, permissions.
- Plugins: installed manifests and capabilities.
- Memory: scoped records, candidates, edit/delete controls.
- Schedules: cron, timezone, next run, history.
- Settings: provider status, model aliases, tool policies, storage, runtime health.

## 5. Model and tool boundaries

- Frontend never talks directly to the model provider.
- Chat Engine talks to ModelRouter, not a vendor SDK directly.
- Model output is untrusted input.
- Tool calls are schema-validated and permission-checked before execution.
- Tool results are normalized and size-limited before returning to a model.
- Provider adapters cannot bypass the permission engine.
- Tool workers receive only the minimum required configuration.

## 6. Event architecture

Use a normalized internal event envelope:

    {
      eventId,
      eventType,
      conversationId,
      taskId,
      messageId,
      sequence,
      occurredAt,
      payload
    }

Persist durable task events. Chat token deltas may be transient while generation is active, but the final message and relevant tool/approval records must be durable.

## 7. Resilience

- Use request IDs and task IDs for tracing.
- Add provider timeouts and bounded retries with backoff.
- Do not retry non-idempotent external actions automatically.
- Use worker leases and heartbeats.
- Recover stale running tasks through a reconciler.
- Persist scheduler occurrences before dispatch.
- Implement graceful shutdown that stops new work and checkpoints current work.
- Keep database migrations versioned and reversible where practical.

## 8. Suggested repository structure

    apps/
      web/
      server/
    packages/
      shared/
      provider-adapters/
      tool-runtime/
      agent-sdk/
      artifact-sdk/
      file-sdk/
      ui/
    workers/
      agent/
      coding/
      browser/
      research/
    skills/
    plugins/
    mcp/
    docs/
    tests/
    data/                  # ignored by Git; runtime data only

## 9. Architecture decision records

Create an ADR before changing any of these:
- Database and persistent queue technology.
- Provider protocol and capability model.
- Sandbox implementation.
- Vector storage and embedding provider.
- Browser network policy.
- Plugin trust and installation model.
- Public network exposure and perimeter access control.