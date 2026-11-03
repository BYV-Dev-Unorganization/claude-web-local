# 10 — Implementation Roadmap

## 1. Delivery strategy

Use small vertical slices. Every phase must leave the application runnable and testable. The roadmap describes dependencies and release gates, not calendar estimates.

## 2. Phase 0 — Repository and engineering foundation

Deliverables:
- Monorepo structure and package boundaries.
- TypeScript configuration and lint/format rules.
- Environment validation and .env.example.
- Fastify server and React application skeleton.
- Database connection and migration tooling.
- Structured logging, request IDs, and error format.
- Health and readiness endpoints.
- CI checks.

Exit criteria:
- Clean checkout can install, migrate, start, and run smoke tests.
- Runtime data and secrets are excluded from Git.

## 3. Phase 1 — Provider and Chat Core

Deliverables:
- Provider adapter interface.
- ModelRouter and four aliases.
- Provider configuration test.
- Capability registry.
- Conversation/message schema.
- Chat orchestration and SSE streaming.
- Markdown and code rendering.
- Stop, retry, regenerate, edit, and history.
- Basic file/image attachment references.

Exit criteria:
- All configured aliases resolve to environment-supplied IDs.
- Provider compatibility tests pass for each enabled capability.
- Multi-turn conversations persist across restart.
- No API secret appears in client responses or logs.

## 4. Phase 2 — Projects and file knowledge

Deliverables:
- Project CRUD and instructions.
- File upload and safe storage.
- Document parsers.
- Chunking and ingestion jobs.
- Embedding adapter and retrieval interface.
- FTS/lexical fallback if embedding provider is not configured.
- Project-scoped retrieval and citations.

Exit criteria:
- A project can ingest, search, remove, and re-index documents.
- Retrieval does not cross project boundaries.

## 5. Phase 3 — Tool Registry and Web Research

Deliverables:
- Shared tool schemas and registry.
- Permission evaluation integration.
- Search provider adapter.
- Safe URL fetcher and content extraction.
- Citation source model and UI.
- Research plan and bounded research worker.
- Research report and export.

Exit criteria:
- Research runs as a durable job.
- Citations resolve to actual fetched sources.
- SSRF and source-size policies are tested.

## 6. Phase 4 — Artifacts and visualizations

Deliverables:
- Artifact data model and versions.
- HTML/SVG/Markdown support.
- Sandboxed preview origin/frame.
- Mermaid and chart renderers.
- React preview strategy.
- Export adapters.
- Artifact management UI.

Exit criteria:
- Generated artifacts reopen after restart.
- Preview cannot access trusted application origin or secrets.

## 7. Phase 5 — Durable Agent Runtime

Deliverables:
- Persistent queue and worker leases.
- Task state machine.
- Planner/orchestrator loop.
- Tool calling and tool-result continuation.
- Checkpoints and recovery.
- Task event stream.
- Pause, resume, cancel, retry.
- Approval workflow and budgets.

Exit criteria:
- A long-running task continues or safely recovers after server restart.
- No privileged action bypasses Permission Engine.
- Uncertain side effects are not blindly retried.

## 8. Phase 6 — Coding Workspace

Deliverables:
- Workspace registry and snapshots.
- Isolated coding worker.
- File read/write/search tools.
- Command/test runner.
- Git status/diff/branch/commit.
- Diff viewer and rollback UI.
- Resource and network controls.

Exit criteria:
- Agent changes only the selected workspace.
- Commands run outside the API process.
- Security tests pass for path traversal and command restrictions.

## 9. Phase 7 — Browser Automation

Deliverables:
- Playwright worker.
- Isolated sessions.
- DOM snapshot and action tools.
- Screenshot and download management.
- URL/domain/network policy.
- Approval for sensitive interactions.
- Browser execution log.

Exit criteria:
- Browser tasks work without Computer Use.
- Host filesystem and private network protections are tested.

## 10. Phase 8 — MCP, connectors, plugins, and skills

Deliverables:
- MCP lifecycle manager and transports.
- Tool discovery and schema validation.
- Connector adapters.
- Plugin manifest and trust model.
- Skill loader and metadata.
- Activation and permissions UI.

Exit criteria:
- External components are disabled by default until explicitly reviewed and enabled.
- All invocations are auditable and permission-checked.

## 11. Phase 9 — Memory and scheduled tasks

Deliverables:
- Candidate memory extraction and filtering.
- Review/edit/delete UI.
- Scoped memory retrieval.
- Cron parser and timezone support.
- Durable schedule dispatcher.
- Occurrence idempotency.
- Task history and notifications.

Exit criteria:
- Approved memory is scoped and retrievable.
- A due schedule dispatches once even across restarts.

## 12. Phase 10 — Multi-agent, voice, and advanced outputs

Deliverables:
- Parent/child tasks.
- Agent roles and restricted tool sets.
- Parallel execution and result aggregation.
- STT/TTS adapters.
- Audio UI and interruption.
- Advanced charts and dashboards.
- Additional file export formats.

Exit criteria:
- Global concurrency and budgets are enforced.
- Voice providers can be configured independently.

## 13. Phase 11 — Production hardening

Deliverables:
- Security and dependency audit.
- Load and soak testing.
- Backup/restore workflow.
- Migration recovery.
- Deployment guides.
- Operational metrics and diagnostics.
- Full E2E suite.
- Feature matrix and release notes.

Exit criteria:
- Clean-install and upgrade paths are tested.
- No known critical/high-severity security issue remains open.
- Every advertised feature has a passing acceptance test or is clearly marked unavailable.

## 14. Cross-phase engineering rules

- Update documentation in the same PR as contract changes.
- Keep feature flags only for genuinely incomplete or optional capabilities; do not use flags to conceal broken functionality.
- Do not mark a phase complete while its exit criteria fail.
- Add migration tests for every schema change.
- Add provider contract tests for adapter changes.
- Keep security review mandatory for tools that access filesystem, network, shell, browser, MCP, or external side effects.

## 15. Suggested issue labels

- type:feature
- type:bug
- type:docs
- type:security
- area:frontend
- area:backend
- area:provider
- area:agent
- area:research
- area:browser
- area:database
- phase:0 through phase:11
- priority:p0 / priority:p1 / priority:p2