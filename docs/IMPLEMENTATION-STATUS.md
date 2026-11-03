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
- [ ] Conversation edit/branch/regenerate/export and message-level search.
- [ ] Research search/fetch workers, durable plans, source evaluation, and citation validation.
- [~] Durable task creation/list/detail APIs, validated task state transitions, persisted ordered task events, pause/resume/cancel/retry records, and approval decisions bound to a SHA-256 digest of the exact stored action payload. Registered workspace tools now have a server-side execution gate: read-only calls require a running task; mutating calls require `approve-each`, an exact workspace/input approval, one-time approval consumption, and persisted invocation logs. The coding tool implementations use the isolated Docker workspace worker. Automated planning, worker leases/heartbeats, autonomous tool continuation, checkpoints, crash recovery, execution budgets, and durable worker recovery are still not implemented.
- [~] Manual workspace explorer and file read/write API; confirmed commands and Git status/diff run through a Docker container with network disabled. Autonomous agent integration, Git branch/commit workflows, snapshots, rollback, and security validation remain incomplete.
- [ ] Playwright browser worker, hardened network egress, session lifecycle, and sensitive-action approvals.
- [ ] MCP transports/discovery/lifecycle, connectors, plugin installation/runtime, and skill execution.
- [ ] Memory candidate extraction/approval/provenance workflow.
- [ ] Cron scheduler and durable occurrence dispatch.
- [ ] Multi-agent orchestration and voice adapters.
- [ ] Full E2E, migration, provider-contract, container-boundary, recovery, load, and soak test coverage.
- [ ] Production static serving, backup/restore automation, and hardened remote deployment.

## Verification policy

A checkbox above is an implementation inventory, not a test result. Test and build results must be recorded from an actual CI run. A subsystem remains unavailable until its implementation and required security tests exist.
