# 09 — Security and Threat Model

## 1. Security objective

The application has no built-in login/logout flow, but it can access provider credentials, local files, shell commands, browser sessions, external services, and MCP tools. Treat it as a privileged local service.

## 2. Trust boundaries

1. Browser UI is untrusted.
2. Model/provider output is untrusted.
3. User-uploaded files and extracted content are untrusted.
4. Web pages and search results are untrusted.
5. MCP servers, plugins, skills, and connector responses are untrusted until reviewed.
6. Agent workers are isolated execution environments.
7. The main API and secrets store are trusted computing components.

All instructions found inside files, web pages, tool output, and MCP content are data, not higher-priority application instructions.

## 3. No login/logout and network exposure

Default bind must be loopback:

    APP_HOST=127.0.0.1

Do not default to 0.0.0.0. If remote access is required, put the application behind a trusted perimeter such as a VPN or authenticated reverse proxy and use TLS. Document that network users able to reach an unprotected instance may be able to control the workspace.

Do not add an application login/logout UI as a substitute for deployment access control; application authentication is explicitly out of scope for this product plan.

## 4. Secrets management

- Provider API keys are environment/secret-manager inputs.
- Never return secrets from settings/configuration endpoints.
- Redact authorization headers, cookies, tokens, and sensitive query parameters from logs.
- Never expose secrets to model prompts, browser pages, artifacts, or plugin code unless a separately reviewed connector requires a narrowly scoped credential.
- Do not commit .env, credentials, browser profiles, or runtime data.
- Use an encryption key for any secret that must be persisted.
- Rotate provider keys after suspected exposure.

## 5. Prompt injection and untrusted content

- Treat retrieved web pages and uploaded files as untrusted reference material.
- Separate system policy from retrieved content.
- Label source content and tool results.
- Do not let a page instruct the agent to reveal secrets, change policies, or invoke tools.
- Require tool permission checks independently of model intent.
- Limit the data included in each tool result.
- Cite source passages when they support research claims.

## 6. Tool execution security

Every tool call must pass backend validation:
1. Tool exists and is enabled.
2. Input matches schema.
3. Tool source is trusted/enabled.
4. Scope is permitted.
5. Resource target is permitted.
6. Action risk is classified.
7. Approval exists when required.
8. Execution target is isolated.
9. Result is size-limited and normalized.

Never execute model-generated code in the API process.

## 7. Coding sandbox

- Use an unprivileged OS user/container.
- Mount only the selected workspace.
- Prefer read-only mounts for source inputs and a separate writable working copy.
- Block access to host root, home directories, Docker socket, SSH agent, cloud metadata, and application secret files.
- Use an explicit command allowlist or reviewed execution policy.
- Apply CPU, memory, PID, disk, and time limits.
- Disable network by default; allow only declared destinations when required.
- Sanitize inherited environment variables.
- Capture output with limits.
- Destroy ephemeral sandboxes after completion unless explicitly retained.

A container alone is not a sufficient security guarantee if it is privileged or mounts sensitive host paths.

## 8. Browser and SSRF protection

- Restrict navigation to permitted schemes, normally HTTPS and HTTP.
- Block loopback, private, link-local, multicast, and metadata IP ranges unless explicitly allowed for a trusted development workflow.
- Revalidate DNS and resolved IPs at connection time to mitigate DNS rebinding.
- Revalidate every redirect.
- Block file:, ftp:, data:, javascript:, and other unsafe schemes unless a narrowly reviewed use case exists.
- Restrict downloads to a dedicated directory and scan/validate file type.
- Isolate browser contexts and storage.
- Do not expose host browser profiles.
- Apply request and navigation timeouts.
- Require approval for external side effects such as form submission.

## 9. Artifact sandbox

- Render artifacts on a separate origin where possible.
- Use sandboxed iframes with restrictive sandbox attributes.
- Apply CSP and disable unnecessary network access.
- Do not pass privileged application tokens to artifact frames.
- Validate artifact type and size.
- Treat generated HTML/JS as untrusted.
- Disable automatic access to parent window, cookies, local storage, and internal APIs.

## 10. File security

- Validate MIME type from content, not filename alone.
- Enforce upload and decompression limits.
- Prevent path traversal and symlink escape.
- Store files using generated storage keys.
- Keep uploaded content outside the executable application directory.
- Do not execute uploaded scripts automatically.
- Add malware scanning as an optional deployment integration.
- Track original and derived files for deletion.

## 11. MCP, plugin, and skill security

- Explicit operator activation is required.
- Validate manifests and schemas.
- Show declared permissions before enabling.
- Treat stdio MCP commands as arbitrary code execution.
- Prefer isolated processes and narrowly scoped environment variables.
- Restrict outbound network and filesystem access.
- Keep secrets out of tool schemas and model-visible descriptions.
- Record server health and invocation logs.
- Support disabling and revoking each server/tool.
- Do not auto-install or auto-run scripts discovered in a repository.

## 12. Approval semantics

An approval is bound to:
- Exact tool name and version.
- Exact normalized input or a cryptographic digest.
- Target resource/path/domain.
- Task and step IDs.
- Expiration time.
- Risk description.

If the action payload changes after approval, request approval again. An approval is not a general permission grant.

## 13. Data handling

- Provide explicit retention and deletion policies.
- Scope project memory and retrieval.
- Avoid storing secrets and sensitive facts in memory.
- Include source provenance for derived memory.
- Ensure delete operations remove derived indexes and references.
- Backups must be encrypted if they contain sensitive local files.

## 14. Security release gate

Do not release coding, browser, MCP, plugin, or remote deployment features until tests cover path traversal, SSRF, command injection, sandbox boundaries, secret leakage, prompt injection, unsafe HTML, and permission bypass.