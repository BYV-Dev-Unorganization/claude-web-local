# 00 — Product Overview

## 1. Product summary

Claude Web Local is a local-first, self-hosted AI workspace inspired by the broad workflow capabilities of Claude Web. It combines conversational AI, project knowledge, research, artifacts, coding assistance, browser automation, reusable tools, and long-running agent workflows in one application.

The goal is functional capability parity at the product-workflow level where technically feasible. It is not a claim of identical proprietary implementation, model behavior, or access to Anthropic-exclusive services.

## 2. Product goals

1. Provide a polished web chat with streaming, history, attachments, model selection, and rich responses.
2. Support persistent projects with instructions, files, retrieval, and project-scoped context.
3. Produce editable artifacts such as HTML, React previews, SVG, diagrams, charts, and documents.
4. Execute grounded web research with source tracking and citations.
5. Run long-lived agent tasks that can plan, use approved tools, pause, resume, and survive server restarts.
6. Provide a coding workspace that can inspect and modify an explicitly selected repository or folder.
7. Provide controlled browser automation without controlling the user's desktop.
8. Support MCP, connectors, plugins, and skills as extensibility mechanisms.
9. Persist useful memories and scheduled workflows with transparent controls.
10. Keep provider credentials and privileged execution on the backend.

## 3. Explicit scope decisions

### Included

- Chat, streaming, conversation history, search, branching, editing, retry, and regeneration.
- Model aliases: fable, opus, sonnet, and haiku.
- Environment-based provider endpoint, API key, and model IDs.
- Extended-thinking integration only when the selected provider/model exposes a supported capability.
- Projects, document ingestion, semantic retrieval, and project memory.
- Artifacts, sandboxed previews, versioning, and export.
- Web search, web fetch, research planning, source evaluation, and citations.
- Agent runtime, background tasks, approvals, and execution history.
- Coding workspace, filesystem tools, terminal runner, Git tools, and test runner.
- Browser automation using Playwright or an equivalent browser automation runtime.
- MCP servers, connectors, plugins, and skills.
- Memory, scheduled tasks, multi-agent delegation, and parallel execution.
- File parsing, generation, voice adapters, visualizations, backup, and restore.

### Excluded

- Application-level login and logout.
- Computer Use, desktop control, mouse/keyboard control of the host desktop, and general screen operation.
- Hard dependency on one AI vendor or a model name embedded in source code.
- Exposing provider API keys to browser code.
- Unrestricted shell, filesystem, network, browser, or MCP access.
- Claiming hidden chain-of-thought access or displaying private reasoning that a provider does not expose.

## 4. Primary user and operating model

The initial product is a single-workspace local deployment. The application does not maintain user accounts or a login session. The operator configures the process through environment variables and manages projects, conversations, files, tasks, and integrations from the local UI.

If the service is exposed beyond loopback, access protection must be provided at the deployment boundary (for example, a VPN or authenticated reverse proxy). Removing application login does not make an internet-exposed service safe.

## 5. Product principles

- Local-first: data and workspace files are stored on infrastructure controlled by the operator.
- Provider-agnostic: model access is abstracted behind adapters and capability declarations.
- Capability-aware: unavailable model features are disabled or clearly explained, never silently simulated.
- Tool-mediated: agents act through registered tools with schemas and permissions.
- Durable: task state, task events, and schedules survive restarts.
- Observable: tool calls, approvals, errors, model usage, and task transitions are traceable.
- Secure by default: sandboxing and least privilege are mandatory for privileged execution.
- Incremental: each phase delivers testable capabilities and stable contracts.

## 6. Model aliases

| Alias | Intended workload | Actual model ID |
|---|---|---|
| fable | General-purpose or alternate model | Environment variable |
| opus | Complex reasoning, planning, and coding | Environment variable |
| sonnet | Default interactive model | Environment variable |
| haiku | Lightweight and latency-sensitive tasks | Environment variable |

These names are application aliases only. The actual provider model identifiers are supplied by the operator. The alias does not imply that a provider actually offers a model with that name.

## 7. Success criteria

The product is considered ready for a first stable release when:

- A clean install can start from documented configuration.
- All configured aliases are resolved without hardcoded IDs.
- Chat and streaming work with a verified compatible provider.
- Core records persist across restarts.
- Tool execution is permission-checked on the backend.
- Coding and browser workers are isolated from the main application.
- Scheduled tasks and agent tasks recover safely after restart.
- Every feature marked complete has automated tests and user-facing documentation.
- Secrets are not included in client responses, logs, exported artifacts, or repository files.

## 8. Non-goals

This project does not attempt to reproduce Claude's proprietary backend, internal orchestration, private model reasoning, or exact UI implementation. It aims to provide a comparable workflow through independently implemented and replaceable components.