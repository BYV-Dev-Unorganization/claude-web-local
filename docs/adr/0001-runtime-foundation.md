# ADR 0001 — Runtime foundation

- Status: accepted for the first implementation slice
- Date: 2026-11-03

## Context

The product is a single-operator local workspace. It needs a low-friction installation, durable local records, a provider boundary, and a frontend/backend split. The product plan recommends React/Vite, Fastify, SQLite, typed validation, and Playwright for browser-only automation.

## Decisions

1. Use an npm workspaces monorepo with apps/server and apps/web.
2. Use Fastify 5 and TypeScript strict mode for the API.
3. Use React 19 and Vite for the web client.
4. Use SQLite through better-sqlite3, with WAL and foreign-key enforcement, and keep the Drizzle adapter available for typed repository evolution. SQL schema changes remain reviewable.
5. Keep provider endpoint, credential, protocol, and all four model IDs in environment variables. The public model endpoint returns alias availability only.
6. Bind to 127.0.0.1 by default. Do not add application login/logout.
7. Keep unsupported privileged worker capabilities unavailable rather than running shell, browser, plugin, or MCP code in the API process.

## Consequences

- The first code slice provides a local chat/API foundation and persistent project, text-file, artifact, and explicit-memory records.
- The first text-ingestion adapter intentionally rejects binary formats until parsers and ingestion limits are added.
- Durable agent execution, isolated coding/browser workers, research search adapters, MCP lifecycle, connector/plugin/skill execution, scheduler dispatch, multi-agent orchestration, and voice are not advertised as available until their execution and security boundaries are implemented and tested.
- The ADR must be revisited before selecting a separate queue or vector database.
