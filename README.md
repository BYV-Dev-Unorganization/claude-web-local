# Claude Web Local

A local-first AI workspace for chat, projects, knowledge files, artifacts, and explicit memory.

> This branch is an implementation slice, not a claim that the complete product roadmap is finished. See the implementation status in docs/IMPLEMENTATION-STATUS.md.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- A provider endpoint implementing either Anthropic Messages or OpenAI Chat Completions

## Install

    git clone --branch feat/full-claude-web-local https://github.com/BYV-Dev-Unorganization/claude-web-local.git
    cd claude-web-local
    npm install
    cp .env.example .env

Edit .env. Set AI_PROVIDER, AI_PROTOCOL, AI_BASE_URL, AI_API_KEY, all four model IDs (AI_MODEL_FABLE, AI_MODEL_OPUS, AI_MODEL_SONNET, AI_MODEL_HAIKU), and AI_DEFAULT_MODEL. Model IDs are provider-specific; do not copy example names literally.

## Run

    npm run dev

- Web UI: http://127.0.0.1:5173
- API: http://127.0.0.1:3000
- Liveness: http://127.0.0.1:3000/api/v1/health
- Readiness: http://127.0.0.1:3000/api/v1/ready

The API binds to 127.0.0.1 by default. There is intentionally no application login/logout. Do not bind to a public interface or expose the service over a tunnel unless a VPN or authenticated reverse proxy protects it.

For the restricted coding command runner, install Docker and build the worker image once:

    npm run build:sandbox

The container runs without network access, with a read-only root filesystem, dropped Linux capabilities, CPU/memory/PID limits, and only the selected workspace mounted. The coding UI asks for explicit confirmation before writes and commands.

## Current behavior

The current slice provides streaming multi-turn chat, conversation rename and non-destructive branch/edit/regenerate flows, project editing/archiving and text-file management with lexical search, artifact editing/version restore/export and sandboxed HTML preview, explicit memory CRUD, persisted task lifecycle/approval APIs, ordered task events, permission-gated manual workspace tool execution, and a manually operated workspace explorer with a Docker-isolated command runner. Task records and approval decisions are durable, but there is not yet an autonomous planner or worker capable of planning and continuing tasks on its own.

The provider API key stays in the server process. The client receives alias configuration status only. The thinking indicator is shown only when a provider emits a thinking phase; private reasoning content is never displayed.

PDF, DOCX, XLSX, images, semantic embeddings/citations, deep research, durable agent orchestration, autonomous coding-agent integration, browser automation, MCP, connector/plugin/skill execution, scheduling, multi-agent orchestration, and voice are not enabled in this slice. They are exposed as unavailable in /api/v1/capabilities rather than being simulated.

## Verification

    npm run typecheck
    npm test
    npm run build

GitHub Actions runs the same checks for pushes to feat/full-claude-web-local. A test result must be read from the actual workflow run; local commands are not claimed to have been executed by the GitHub connector.

## Storage and secrets

- .env contains provider secrets and is ignored by Git.
- data/ contains the SQLite database and uploaded files and is ignored by Git.
- Only text-like files are accepted by the initial ingestion adapter.
- The API's default CORS policy accepts local browser origins only.

## Architecture and scope

- Product overview: docs/00-OVERVIEW.md
- System architecture: docs/04-ARCHITECTURE.md
- Database ERD: docs/05-DATABASE-ERD.md
- Security model: docs/09-SECURITY.md
- Implementation status: docs/IMPLEMENTATION-STATUS.md
- ADR 0001: docs/adr/0001-runtime-foundation.md
