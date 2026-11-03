# 11 — Testing Strategy

## 1. Testing principles

- Test observable behavior, not internal implementation details only.
- Use deterministic fakes for provider and tool tests.
- Keep a separate opt-in compatibility suite for real provider APIs.
- Never use production API keys in CI.
- Test permission denial paths as thoroughly as allowed paths.
- Test restart/recovery behavior for durable workflows.

## 2. Test layers

### Unit tests

Use Vitest for:
- Environment parsing and validation.
- Model alias resolution.
- Provider error normalization.
- Capability checks.
- SSE event normalization.
- Prompt/context assembly.
- Tool schema validation.
- Permission policy decisions.
- Task state transitions.
- Budget accounting.
- Scheduler next-run and idempotency.
- Citation mapping and source deduplication.
- Memory scope and filtering.
- File path and MIME validation.

### Integration tests

Use a temporary database and fake provider:
- Chat persistence and multi-turn flow.
- Provider adapter streaming and tool round trip.
- Conversation branching and regeneration.
- Project file ingestion and retrieval.
- Research source persistence and citation mapping.
- Artifact versioning and export.
- Agent task queue, worker leases, and checkpoint recovery.
- Approval flow and denial.
- Browser worker URL policy.
- Coding worker workspace boundary.
- MCP lifecycle and tool invocation.
- Scheduler dispatch after restart.

### End-to-end tests

Use Playwright against a test application:
1. Open local application.
2. Start a conversation.
3. Select a configured alias.
4. Send a message and observe stream.
5. Stop and retry a generation.
6. Create a project and upload a fixture document.
7. Ask a project-scoped question and inspect citations.
8. Generate and reopen an artifact.
9. Start a research job and inspect sources.
10. Start a task and approve a sensitive action.
11. Pause and resume a task.
12. Inspect coding diff and test result.
13. Run an allowed browser workflow.
14. Create a schedule and inspect its occurrence.
15. Restart test server and verify durable state.

## 3. Provider compatibility suite

For each configured provider/model alias, verify:
- Valid endpoint and authentication.
- Basic text completion.
- Streaming order and completion.
- Multi-turn history.
- Tool invocation and continuation.
- Usage metadata.
- Timeout and retry behavior.
- Cancellation where supported.
- Vision when declared.
- Thinking when declared.
- Structured output when declared.

Record the tested provider protocol, model ID, and date in test output. Do not infer support from a model label.

## 4. Security test matrix

| Area | Required cases |
|---|---|
| Secrets | Key absent from API, logs, UI payloads, artifacts |
| Filesystem | Path traversal, symlink escape, unauthorized root |
| Shell | Command injection, environment leakage, timeout |
| Browser | SSRF, redirect to private IP, DNS rebinding, unsafe scheme |
| Artifacts | XSS, parent-window access, CSP bypass attempts |
| Uploads | MIME spoofing, oversized files, archive bombs |
| MCP/plugins | Untrusted command, invalid schema, permission bypass |
| Prompt injection | Malicious instructions in webpage/file/tool output |
| Approvals | Changed payload after approval, expired approval, replay |
| Scheduler | Duplicate dispatch, timezone/DST transitions |
| Recovery | Worker crash during action and uncertain side effects |

## 5. Performance and reliability tests

- First-token latency under representative load.
- Streaming stability for long responses.
- Concurrent chat and agent requests.
- Large document ingestion.
- Retrieval latency and index growth.
- Task queue throughput and worker recovery.
- Browser memory and session cleanup.
- Database query plans and write contention.
- Long-running soak test with repeated tasks and restarts.

Define measurable targets after baseline profiling; avoid hardcoded latency claims before testing on the target hardware/provider.

## 6. Test data and fixtures

Maintain fixtures for:
- Short and long text files.
- PDF, DOCX, XLSX, CSV, JSON, images, and source code.
- Malicious HTML and prompt-injection examples.
- Websites served from a controlled local test server.
- Git repositories with known changes and tests.
- Fake MCP servers.
- Fake streaming providers with deterministic events.

## 7. CI pipeline

Recommended pipeline:
1. Install dependencies with lockfile.
2. Typecheck.
3. Lint and format check.
4. Unit tests.
5. Integration tests.
6. Build frontend and backend.
7. Migration validation.
8. E2E smoke tests.
9. Dependency and secret scanning.
10. Artifact upload for logs/reports.

Real-provider tests should be a separate manually triggered workflow using secured CI secrets.

## 8. Definition of Done

A feature is done only when:
- Acceptance criteria pass.
- Types and schemas are validated.
- Error and cancellation paths are covered.
- Permissions are enforced where relevant.
- Persistence/recovery behavior is tested where relevant.
- UI has loading, empty, success, and error states.
- Documentation is updated.
- No secret or runtime data is committed.
- CI passes.