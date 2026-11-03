# Implementation status

This file tracks evidence for the implementation branch. Planning documents remain the source of product requirements.

## Available in the current implementation slice

- [x] TypeScript/npm workspace foundation.
- [x] Fastify API with request logging, normalized error responses, and local-origin CORS policy.
- [x] SQLite persistence with foreign keys, WAL, and additive schema migrations.
- [x] Environment-driven provider configuration and the fable/opus/sonnet/haiku alias contract.
- [x] Anthropic Messages and OpenAI Chat Completions text streaming adapters.
- [x] Provider-native tool calling, structured JSON output, and model capability probing for the configured aliases.
- [x] Per-alias thinking mode, budget, and reasoning-effort environment configuration.
- [x] Conversation CRUD, multi-turn history, SSE streaming, cancellation handling, and usage persistence where returned.
- [x] Projects and project instructions.
- [x] Text/Markdown/JSON/CSV/source-code file upload, storage, chunking, and lexical search.
- [x] Artifact persistence, version creation, restoration, and sandboxed HTML preview in the UI.
- [x] Explicit memory CRUD with project/global scope.
- [x] Capability endpoint that reports unavailable subsystems rather than simulating them.
- [x] Durable task planner, worker pool, queue leases, checkpoints, tool continuation, budgets, approvals, and recovery primitives.

## Remaining scope (not to be represented as complete)

- [ ] Attachments/images in chat and Office/PDF/image document parsers.
- [ ] Embedding provider, semantic retrieval, citations, and retrieval isolation tests.
- [~] Conversation rename and non-destructive branch/edit/regenerate flows. A branch copies the selected message prefix, rewires message ancestry, and records parent-conversation/branch-point lineage. Conversation export and dedicated message-level search are not implemented.
- [ ] Research search/fetch workers, source evaluation, durable deep-research plans, and citation validation.
- [x] Durable task creation/list/detail APIs, validated state transitions, persisted ordered task events, pause/resume/cancel/retry records, and approvals bound to a SHA-256 digest of the exact stored action payload.
- [x] Explicit task-to-workspace binding. Coding tasks without workspaceId are rejected; no workspace is selected implicitly.
- [x] Structured planner persists ordered steps and checkpoints; provider tool calls are continued with actual tool results and tool errors.
- [x] Supervised in-process worker pool starts after server startup when provider credentials and at least one model alias are configured. It uses atomic claims, hashed lease tokens, heartbeat, bounded concurrency, and graceful shutdown.
- [x] Checkpoints are persisted before/after model turns and tool results. Iteration, runtime, tool-call, output-token, and tool-result-size budgets are enforced.
- [x] Exact-payload approval remains required for mutating tools; tool execution uses the selected workspace and isolated Docker worker.
- [x] Lease recovery requeues safe work and pauses uncertain/in-flight side effects for operator review. Completed tool invocations after the last checkpoint are not replayed automatically; private checkpoint JSON is omitted from public task routes.
- [ ] Separate OS worker deployment mode, multi-process stress/soak tests, live provider-contract checks against all configured model IDs, and process-kill crash-injection/E2E recovery tests.
- [~] Manual workspace explorer and file read/write API; confirmed commands and Git status/diff run through a Docker container with network disabled. Git branch/commit workflows, snapshots, rollback, and full security validation remain incomplete.
- [ ] Playwright browser worker, hardened network egress, session lifecycle, and sensitive-action approvals.
- [ ] MCP transports/discovery/lifecycle, connectors, plugin installation/runtime, and skill execution.
- [ ] Memory candidate extraction/approval/provenance workflow.
- [ ] Cron scheduler and durable occurrence dispatch.
- [ ] Multi-agent orchestration and voice adapters.
- [~] Unit tests cover task lifecycle/approval integrity, workspace tool approval gates, provider adapter contracts, worker lease recovery, task planning/tool continuation, and conversation branch lineage. Full E2E, migration-upgrade matrix, cross-process recovery, load, and soak coverage remain incomplete.
- [ ] Production static serving, backup/restore automation, and hardened remote deployment.

## Verification policy

A checkbox above is an implementation inventory, not a test result. Test and build results must be recorded from an actual CI run for the latest branch head. A subsystem remains unavailable until its implementation and required security tests exist.
