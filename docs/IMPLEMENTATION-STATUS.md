# Implementation status

This file tracks evidence for the implementation branch. Planning documents remain the source of product requirements.

## Available in the current implementation slice

- [x] TypeScript/npm workspace foundation.
- [x] Fastify API with request logging, normalized error responses, and local-origin CORS policy.
- [x] SQLite persistence with foreign keys and WAL.
- [x] Environment-driven provider configuration and the fable/opus/sonnet/haiku alias contract.
- [x] Anthropic Messages and OpenAI Chat Completions text streaming adapters.
- [x] Conversation CRUD, multi-turn history, SSE streaming, cancellation handling, and usage persistence where returned.
- [x] Projects and project instructions.
- [x] Text/Markdown/JSON/CSV/source-code file upload, storage, chunking, and lexical search.
- [x] Artifact persistence, version creation, restoration, and sandboxed HTML preview in the UI.
- [x] Explicit memory CRUD with project/global scope.
- [x] A capability endpoint that explicitly reports unavailable subsystems.
- [x] Initial security-policy tests and GitHub Actions validation workflow.

## Not yet implemented (not to be represented as complete)

- [ ] Attachments/images in chat and Office/PDF/image document parsers.
- [ ] Embedding provider, semantic retrieval, citations, and retrieval isolation tests.
- [ ] Provider tool-call round trip, capability probing per model, structured output, and provider-specific thinking configuration.
- [~] Conversation rename and non-destructive branch/edit/regenerate flows. A branch copies the selected message prefix, rewires message ancestry, and records parent-conversation/branch-point lineage. Conversation export and dedicated message-level search are not implemented.
- [ ] Research search/fetch workers, durable plans, source evaluation, and citation validation.
- [~] Durable task creation/list/detail APIs, validated task state transitions, persisted ordered task events, pause/resume/cancel/retry records, and approval decisions bound to a SHA-256 digest of the exact stored action payload. Registered workspace tools have a server-side execution gate: read-only calls require a running task; mutating calls require `approve-each`, an exact workspace/input approval, one-time approval consumption, and persisted invocation logs. The coding tool implementations use the isolated Docker workspace worker. Added durable worker queue primitives: atomic queued-task claims, hashed lease-token ownership, heartbeat, release, attempt counting, and expired-lease recovery. Recovery requeues tasks only when no tool invocation was in flight; uncertain side effects pause the task for operator review. A full autonomous planner, worker process lifecycle/supervision, tool-result continuation, checkpoints, execution budgets, and end-to-end crash recovery remain incomplete.
- [~] Manual workspace explorer and file read/write API; confirmed commands and Git status/diff run through a Docker container with network disabled. Autonomous agent integration, Git branch/commit workflows, snapshots, rollback, and security validation remain incomplete.
- [ ] Playwright browser worker, hardened network egress, session lifecycle, and sensitive-action approvals.
- [ ] MCP transports/discovery/lifecycle, connectors, plugin installation/runtime, and skill execution.
- [ ] Memory candidate extraction/approval/provenance workflow.
- [ ] Cron scheduler and durable occurrence dispatch.
- [ ] Multi-agent orchestration and voice adapters.
- [~] Unit tests cover task lifecycle/approval integrity, workspace tool approval gates, and conversation branch lineage; CI exercises sandbox build/smoke, TypeScript checks, unit tests, and application builds. Full E2E, migration-upgrade matrix, provider-contract, browser/container-boundary, recovery, load, and soak coverage remain incomplete.
- [ ] Production static serving, backup/restore automation, and hardened remote deployment.

## Verification policy

A checkbox above is an implementation inventory, not a test result. Test and build results must be recorded from an actual CI run. A subsystem remains unavailable until its implementation and required security tests exist.
