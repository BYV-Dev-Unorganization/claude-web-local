# Documentation Index

This directory is the source of truth for the Claude Web Local product plan.

## Documents

| Document | Purpose |
|---|---|
| [00 — Overview](./00-OVERVIEW.md) | Vision, scope, product principles, and decisions |
| [01 — Requirements](./01-REQUIREMENTS.md) | Functional and non-functional requirements |
| [02 — Use Cases](./02-USE-CASES.md) | Actors, workflows, and acceptance scenarios |
| [03 — Activity Diagrams](./03-ACTIVITY-DIAGRAMS.md) | Core workflow diagrams |
| [04 — Architecture](./04-ARCHITECTURE.md) | System boundaries, modules, and runtime design |
| [05 — Database / ERD](./05-DATABASE-ERD.md) | Persistent data model and relationships |
| [06 — API Specification](./06-API-SPECIFICATION.md) | REST endpoints, SSE events, and API conventions |
| [07 — Model & Provider](./07-MODEL-PROVIDER.md) | Environment configuration, adapters, and capability routing |
| [08 — Agent Runtime](./08-AGENT-RUNTIME.md) | Planning, tools, execution, delegation, and scheduling |
| [09 — Security](./09-SECURITY.md) | Threat model, permissions, and isolation requirements |
| [10 — Implementation Roadmap](./10-IMPLEMENTATION-ROADMAP.md) | Phases, dependencies, and deliverables |
| [11 — Testing](./11-TESTING.md) | Test strategy and release gates |
| [12 — Deployment](./12-DEPLOYMENT.md) | Local/VPS setup, operations, backup, and recovery |

## Product decisions

- Local-first and self-hosted.
- No application login/logout flow.
- No Computer Use or general desktop control.
- Browser automation through a controlled browser runtime is in scope.
- Provider endpoint, API key, and model IDs are configured in environment variables.
- The configured model aliases are Fable, Opus, Sonnet, and Haiku.
- The backend owns provider credentials and all privileged tool execution.
- Feature completion means a working implementation with tests and documentation, not a UI-only placeholder.

## Planning status

These documents describe the intended product. They do not claim that the features have already been implemented. Implementation status must be tracked separately through issues, pull requests, and release notes.

## Change policy

Any change to the product scope, model configuration contract, security boundary, API contract, or data model should update the relevant document in the same pull request as the implementation change.