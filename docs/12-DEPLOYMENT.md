# 12 — Deployment and Operations

## 1. Deployment modes

### Local development
- Bind to 127.0.0.1.
- Use a local SQLite database.
- Store runtime files in an ignored data directory.
- Run the API and web development servers separately.
- Use test/fake providers for automated tests.

### Local production
- Build frontend assets and serve them through the backend or a local reverse proxy.
- Run API and worker processes with a process supervisor.
- Use persistent local storage and a verified backup plan.
- Keep the service bound to loopback unless network access is intentionally configured.

### VPS / remote access
- Do not expose the application directly to the public internet without a perimeter access control.
- Prefer a private VPN or authenticated reverse proxy with TLS.
- Keep APP_HOST on loopback behind the proxy where possible.
- Restrict firewall ingress.
- Run workers as an unprivileged user.
- Place coding/browser sandboxes in a separate restricted runtime.
- Monitor disk usage, memory, task queue depth, and provider failures.

## 2. Required environment

Copy .env.example to .env and configure:
- APP_HOST and APP_PORT.
- AI_PROVIDER and AI_PROTOCOL.
- AI_BASE_URL and AI_API_KEY.
- AI_MODEL_FABLE, AI_MODEL_OPUS, AI_MODEL_SONNET, AI_MODEL_HAIKU.
- AI_DEFAULT_MODEL.
- DATABASE_URL.
- STORAGE_PATH and WORKSPACE_PATH.
- APP_ENCRYPTION_KEY.
- Optional web search, embeddings, STT, and TTS providers.

Never commit .env. Restrict file permissions so only the service operator can read it.

## 3. Startup sequence

1. Load and validate environment.
2. Verify storage directories and permissions.
3. Open database.
4. Apply migrations.
5. Initialize provider adapters and validate configuration shape.
6. Initialize tool registry and permission policies.
7. Start API server.
8. Start worker processes.
9. Start scheduler dispatcher.
10. Run readiness checks.

Do not fail the entire application just because an optional integration (voice, MCP, search, embeddings) is not configured. Mark that capability unavailable. Required core configuration failures must stop startup with a clear sanitized error.

## 4. Process model

Recommended processes:
- web/API server
- general agent worker
- coding worker
- browser worker
- research worker
- scheduler/dispatcher

For a low-resource local installation these may share a worker process with bounded concurrency, but privileged runtimes must still use isolation boundaries.

## 5. Storage layout

    data/
      database/
      uploads/
      artifacts/
      indexes/
      workspaces/
      browser-downloads/
      backups/
      logs/

The data directory must be excluded from Git. Use generated storage keys instead of user-provided names for physical paths.

## 6. Health and readiness

Liveness:
- Process is running and event loop responds.

Readiness:
- Database available.
- Migrations current.
- Required storage paths writable.
- Required provider configuration present.
- Worker queue initialized.

Optional integrations should expose their own health status instead of making core readiness fail.

## 7. Backup and restore

Backup should include:
- Database snapshot.
- Uploaded originals.
- Artifact source and versions.
- Project indexes or enough metadata to rebuild them.
- Task and schedule history.
- Relevant non-secret configuration template.

Do not include .env secrets in an ordinary backup unless using an encrypted secret-backup workflow.

Restore procedure:
1. Stop API, workers, and scheduler.
2. Verify backup integrity.
3. Restore database and storage to a clean location.
4. Validate schema version.
5. Rebuild derived indexes if needed.
6. Validate file checksums.
7. Start services.
8. Run readiness checks and a smoke test.

Test backup restoration regularly; a backup that has never been restored is not a verified recovery plan.

## 8. Logging and observability

Use structured logs with:
- timestamp
- level
- service
- requestId
- conversationId
- taskId
- workerId
- event
- duration
- safe error code

Redact:
- Authorization headers.
- API keys.
- Cookies.
- Personal tokens.
- Sensitive prompt content when configured.
- Browser storage state.

Expose operational metrics:
- Provider success/error counts.
- First-token and total latency.
- Tool invocation counts and duration.
- Task queue depth and age.
- Worker lease expirations.
- Schedule dispatch failures.
- Storage size.
- Database health.

## 9. Upgrade process

1. Back up database and storage.
2. Stop workers or put them into drain mode.
3. Deploy the new version.
4. Run migrations.
5. Start API and workers.
6. Verify health/readiness.
7. Resume queued tasks after checking compatibility.
8. Keep rollback instructions for application code and schema.

Do not automatically replay uncertain external actions after an upgrade.

## 10. Operational safety checklist

- [ ] APP_HOST defaults to 127.0.0.1.
- [ ] Remote exposure has VPN or authenticated reverse proxy.
- [ ] TLS enabled for remote access.
- [ ] .env permissions are restricted.
- [ ] Secrets are absent from logs and Git.
- [ ] Worker processes run unprivileged.
- [ ] Coding workspace and browser runtime are isolated.
- [ ] Firewall restricts inbound ports.
- [ ] Backups are scheduled and restore-tested.
- [ ] Disk and worker resource limits are configured.
- [ ] Application and dependency updates are reviewed.