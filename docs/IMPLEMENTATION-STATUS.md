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
- [ ] Agent planner/orchestrator, durable queue leases, checkpoints, approvals, pause/resume/retry, and worker recovery.
- [ ] Isolated coding worker/container, shell/test execution, Git operations, snapshots, and rollback.
- [ ] Playwright browser worker, hardened network egress, session lifecycle, and sensitive-action approvals.
- [ ] MCP transports/discovery/lifecycle, connectors, plugin installation/runtime, and skill execution.
- [ ] Memory candidate extraction/approval/provenance workflow.
- [ ] Cron scheduler and durable occurrence dispatch.
- [ ] Multi-agent orchestration and voice adapters.
- [ ] Full E2E, migration, provider-contract, security, recovery, load, and soak test coverage.
- [ ] Production static serving, backup/restore automation, and hardened remote deployment.

## Verification policy

A checkbox above is an implementation inventory, not a test result. Test and build results must be recorded from an actual CI run. A subsystem remains unavailable until its implementation and required security tests exist.
