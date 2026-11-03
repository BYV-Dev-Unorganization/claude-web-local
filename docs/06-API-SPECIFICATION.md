# 06 — API Specification

## 1. API conventions

- Prefix all application endpoints with /api/v1.
- Use JSON request/response bodies unless a file upload or stream is required.
- Validate all input with shared schemas.
- Use stable error codes and request IDs.
- Return 202 for accepted background work.
- Use cursor pagination for large lists.
- Use UTC timestamps in ISO 8601 format.
- Do not return environment variables, provider secrets, or raw internal configuration.

## 2. Standard error response

    {
      "error": {
        "code": "MODEL_NOT_CONFIGURED",
        "message": "The selected model alias is not configured.",
        "details": {
          "alias": "sonnet"
        },
        "requestId": "req_..."
      }
    }

Error codes should include validation_error, not_found, conflict, provider_unavailable, model_not_configured, capability_unsupported, permission_denied, approval_required, rate_limited, task_budget_exceeded, and internal_error.

## 3. Health and configuration

| Method | Path | Purpose |
|---|---|---|
| GET | /api/v1/health | Process liveness |
| GET | /api/v1/ready | Database/provider configuration readiness |
| GET | /api/v1/config/public | Safe public application configuration |
| GET | /api/v1/models | Configured aliases and public capabilities |
| POST | /api/v1/models/test | Test configured provider connectivity |

Public configuration must never include API keys or secret environment values.

## 4. Conversations and chat

| Method | Path | Purpose |
|---|---|---|
| POST | /api/v1/conversations | Create conversation |
| GET | /api/v1/conversations | List/search conversations |
| GET | /api/v1/conversations/:id | Read conversation metadata |
| PATCH | /api/v1/conversations/:id | Rename/update/archive |
| DELETE | /api/v1/conversations/:id | Delete conversation |
| GET | /api/v1/conversations/:id/messages | List messages |
| POST | /api/v1/conversations/:id/turns | Start a turn and stream events |
| POST | /api/v1/conversations/:id/turns/:turnId/cancel | Cancel active turn |
| POST | /api/v1/conversations/:id/messages/:messageId/regenerate | Regenerate response |
| POST | /api/v1/conversations/:id/messages/:messageId/branch | Branch from message |
| POST | /api/v1/conversations/:id/export | Export conversation |

POST turns accepts prompt, modelAlias, attachmentIds, projectId, and optional generation settings. The request returns a streaming response using fetch-readable SSE. A separate durable turn resource should be available for reconnecting after a client disconnect.

## 5. Projects and files

| Method | Path | Purpose |
|---|---|---|
| POST | /api/v1/projects | Create project |
| GET | /api/v1/projects | List projects |
| GET | /api/v1/projects/:id | Read project |
| PATCH | /api/v1/projects/:id | Update instructions/metadata |
| DELETE | /api/v1/projects/:id | Archive/delete project |
| POST | /api/v1/projects/:id/files | Upload project file |
| GET | /api/v1/projects/:id/files | List project files |
| DELETE | /api/v1/projects/:id/files/:fileId | Remove file and index |
| POST | /api/v1/projects/:id/reindex | Rebuild retrieval index |
| POST | /api/v1/projects/:id/search | Search project knowledge |

Use multipart uploads with enforced size limits. Ingestion should return a file resource with a processing status.

## 6. File API

| Method | Path | Purpose |
|---|---|---|
| POST | /api/v1/files | Upload file |
| GET | /api/v1/files/:id | Read file metadata |
| GET | /api/v1/files/:id/content | Download or preview content |
| DELETE | /api/v1/files/:id | Delete file and derived data |

Content endpoints must verify the file is within the current local workspace scope and must not accept arbitrary filesystem paths.

## 7. Artifacts

| Method | Path | Purpose |
|---|---|---|
| POST | /api/v1/artifacts | Create artifact |
| GET | /api/v1/artifacts | List artifacts |
| GET | /api/v1/artifacts/:id | Read artifact |
| PATCH | /api/v1/artifacts/:id | Update artifact metadata |
| DELETE | /api/v1/artifacts/:id | Delete artifact |
| GET | /api/v1/artifacts/:id/versions | List versions |
| POST | /api/v1/artifacts/:id/versions | Create version |
| POST | /api/v1/artifacts/:id/restore/:versionId | Restore version |
| GET | /api/v1/artifacts/:id/preview | Serve isolated preview |
| GET | /api/v1/artifacts/:id/export | Export artifact |

Artifact preview must use a separate origin or strongly sandboxed iframe policy.

## 8. Research

| Method | Path | Purpose |
|---|---|---|
| POST | /api/v1/research | Start research job |
| GET | /api/v1/research/:id | Read job |
| GET | /api/v1/research/:id/events | Stream progress |
| GET | /api/v1/research/:id/sources | List sources |
| GET | /api/v1/research/:id/report | Read final report |
| POST | /api/v1/research/:id/cancel | Cancel job |

Research is a background task and should return 202 with a job ID.

## 9. Tasks and approvals

| Method | Path | Purpose |
|---|---|---|
| POST | /api/v1/tasks | Create agent task |
| GET | /api/v1/tasks | List tasks |
| GET | /api/v1/tasks/:id | Read task |
| GET | /api/v1/tasks/:id/events | Stream/replay task events |
| GET | /api/v1/tasks/:id/steps | List task steps |
| POST | /api/v1/tasks/:id/pause | Pause task |
| POST | /api/v1/tasks/:id/resume | Resume task |
| POST | /api/v1/tasks/:id/cancel | Cancel task |
| POST | /api/v1/tasks/:id/retry | Retry failed task |
| POST | /api/v1/tasks/:id/input | Provide requested input |
| POST | /api/v1/approvals/:id/approve | Approve action |
| POST | /api/v1/approvals/:id/reject | Reject action |

Use idempotency keys when creating tasks. Approval decisions must be durable and tied to the exact action payload that was presented for approval.

## 10. Browser and coding workspaces

| Method | Path | Purpose |
|---|---|---|
| POST | /api/v1/browser/sessions | Create isolated browser session |
| GET | /api/v1/browser/sessions/:id | Read session status |
| POST | /api/v1/browser/sessions/:id/actions | Execute approved browser action |
| POST | /api/v1/browser/sessions/:id/close | Close session |
| POST | /api/v1/workspaces | Register/create coding workspace |
| GET | /api/v1/workspaces | List workspaces |
| GET | /api/v1/workspaces/:id/tree | Read workspace tree |
| GET | /api/v1/workspaces/:id/diff | Read workspace diff |
| POST | /api/v1/workspaces/:id/snapshot | Create snapshot |
| POST | /api/v1/workspaces/:id/rollback | Restore snapshot |

Do not expose a generic endpoint that accepts an arbitrary host filesystem path or arbitrary shell command without policy enforcement.

## 11. MCP, connectors, plugins, and skills

Provide CRUD/enable/disable/health endpoints under:
- /api/v1/mcp/servers
- /api/v1/connectors
- /api/v1/plugins
- /api/v1/skills

Also provide explicit operations for tool discovery, connection testing, validation, activation, and deactivation. Configuration responses must redact credentials.

## 12. Memory and schedules

Memory:
- GET/POST /api/v1/memories
- GET/PATCH/DELETE /api/v1/memories/:id
- POST /api/v1/memories/:id/approve
- POST /api/v1/memories/search

Schedules:
- GET/POST /api/v1/schedules
- GET/PATCH/DELETE /api/v1/schedules/:id
- POST /api/v1/schedules/:id/pause
- POST /api/v1/schedules/:id/resume
- GET /api/v1/schedules/:id/occurrences

## 13. SSE event contract

Every event uses an envelope:

    {
      "id": "evt_...",
      "type": "text.delta",
      "sequence": 12,
      "occurredAt": "2026-01-01T00:00:00.000Z",
      "conversationId": "conv_...",
      "turnId": "turn_...",
      "messageId": "msg_...",
      "taskId": null,
      "data": {}
    }

Recommended event types:
- message.start
- thinking.start
- thinking.delta (only provider-approved displayable content)
- text.delta
- citation.added
- tool.start
- tool.progress
- tool.result
- approval.required
- task.status
- task.progress
- message.usage
- message.complete
- message.error
- message.cancelled

Rules:
- Sequence numbers are monotonic within a stream resource.
- A reconnectable stream supports replay from the last event ID.
- The final persisted message is authoritative.
- Tool output is size-limited and may be summarized before model continuation.
- Do not emit secrets, raw environment variables, or private provider reasoning.

## 14. Pagination and filtering

List endpoints should support limit, cursor, query, projectId, status, modelAlias, and date filters where applicable. Maximum page size must be enforced server-side.

## 15. API versioning

Breaking changes require a new API version or a documented migration period. Keep shared request/response schemas in a shared package and test them against handlers.