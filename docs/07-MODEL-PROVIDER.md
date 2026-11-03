# 07 — Model and Provider Configuration

## 1. Configuration contract

The provider endpoint, API key, and actual model IDs are supplied by environment variables. No provider credential or model identifier is hardcoded into application source.

The application exposes four stable internal aliases:
- fable
- opus
- sonnet
- haiku

Each alias resolves to an actual model ID from the environment. The alias name is not a claim that the provider offers that model.

## 2. Example environment file

    # Application
    APP_NAME=Claude Web Local
    APP_ENV=development
    APP_HOST=127.0.0.1
    APP_PORT=3000
    APP_TIMEZONE=Asia/Makassar

    # Provider protocol and endpoint
    AI_PROVIDER=anthropic-compatible
    AI_PROTOCOL=anthropic-messages
    AI_BASE_URL=https://api.example.com
    AI_API_KEY=replace_me

    # Model IDs supplied by the selected provider
    AI_MODEL_FABLE=provider-model-id-for-fable
    AI_MODEL_OPUS=provider-model-id-for-opus
    AI_MODEL_SONNET=provider-model-id-for-sonnet
    AI_MODEL_HAIKU=provider-model-id-for-haiku
    AI_DEFAULT_MODEL=sonnet

    # Generation limits
    AI_MAX_OUTPUT_TOKENS=8192
    AI_REQUEST_TIMEOUT_MS=180000
    AI_MAX_RETRIES=2
    AI_MAX_CONCURRENT_REQUESTS=4

    # Optional capability overrides; prefer adapter discovery where possible
    AI_CAPABILITIES_MODE=declared
    AI_SUPPORTS_STREAMING=true
    AI_SUPPORTS_TOOL_CALLS=true
    AI_SUPPORTS_VISION=false
    AI_SUPPORTS_THINKING=false

    # Search provider
    WEB_SEARCH_PROVIDER=
    WEB_SEARCH_API_KEY=

    # Embeddings
    EMBEDDING_PROVIDER=
    EMBEDDING_BASE_URL=
    EMBEDDING_API_KEY=
    EMBEDDING_MODEL=

    # Voice providers
    STT_PROVIDER=
    STT_API_KEY=
    TTS_PROVIDER=
    TTS_API_KEY=

    # Local persistence
    DATABASE_URL=file:./data/claude-web-local.sqlite
    STORAGE_PATH=./data/storage
    WORKSPACE_PATH=./data/workspaces

    # Runtime
    WORKER_CONCURRENCY=2
    TASK_MAX_ITERATIONS=30
    TASK_MAX_RUNTIME_SECONDS=1800
    TASK_MAX_TOOL_CALLS=100

    # Security
    APP_ENCRYPTION_KEY=replace_with_random_secret
    ARTIFACT_PREVIEW_ORIGIN=http://127.0.0.1:3001

Never commit a populated .env file. Commit only .env.example with placeholders.

## 3. Provider adapter architecture

Define a provider-neutral interface:

    interface ProviderAdapter {
      id: string;
      validateConfiguration(): Promise<ProviderHealth>;
      getCapabilities(modelId: string): Promise<ModelCapabilities>;
      generate(request: NormalizedGenerationRequest): Promise<NormalizedResponse>;
      stream(request: NormalizedGenerationRequest): AsyncIterable<NormalizedStreamEvent>;
      cancel?(providerRequestId: string): Promise<void>;
    }

Adapters normalize:
- Text input and output.
- System instructions.
- Streaming deltas.
- Tool declarations and tool-call results.
- Token usage.
- Provider errors and rate limits.
- Image/vision inputs where supported.
- Thinking configuration and provider-exposed thinking metadata where supported.
- Structured output where supported.

Do not assume that two APIs described as Anthropic-compatible implement identical tool, thinking, vision, or streaming behavior.

## 4. ModelRouter

Responsibilities:
1. Load and validate model alias configuration at startup.
2. Resolve alias to configured provider model ID.
3. Select the correct provider adapter and protocol.
4. Check requested capabilities.
5. Apply generation limits and timeout.
6. Normalize provider events.
7. Map errors to stable application errors.
8. Record usage metadata.
9. Support cancellation and bounded retry.

The frontend sends an alias, not an arbitrary provider model ID. The server performs the resolution.

## 5. Model alias registry

| Alias | Environment variable | Intended role |
|---|---|---|
| fable | AI_MODEL_FABLE | Alternate/general model |
| opus | AI_MODEL_OPUS | Complex planning and coding |
| sonnet | AI_MODEL_SONNET | Default chat and balanced workloads |
| haiku | AI_MODEL_HAIKU | Lightweight/latency-sensitive tasks |

AI_DEFAULT_MODEL must match a configured alias. Missing aliases should be reported as unavailable, not silently mapped to another model.

## 6. Capability registry

Capabilities should be represented per resolved model, not globally assumed:

    interface ModelCapabilities {
      streaming: boolean;
      toolCalling: boolean;
      vision: boolean;
      thinking: boolean;
      structuredOutput: boolean;
      cancellation: boolean;
      maxInputTokens?: number;
      maxOutputTokens?: number;
    }

Capability sources:
- Adapter-known protocol behavior.
- Explicit operator configuration.
- A safe provider capability test, if available.

Never infer capability solely from a model alias or display name.

## 7. Thinking behavior

- The UI may show a thinking indicator while a supported request is being processed.
- Provider-specific thinking parameters must be adapter-owned.
- Store only content/metadata explicitly returned for display by the provider.
- Do not request, reconstruct, or display hidden chain-of-thought.
- If thinking is unavailable, disable the option and explain why.

## 8. Tool calling

Provider tool schemas are translated from a shared internal JSON Schema representation. Provider responses are parsed into normalized tool calls. Before execution:
1. Validate the tool name.
2. Validate arguments against the registered schema.
3. Resolve the source and permission policy.
4. Check workspace/domain/resource constraints.
5. Request approval when required.
6. Execute in the appropriate worker.
7. Normalize and limit the result.
8. Return the result to the model.

## 9. Reliability and cost controls

- Configure timeout and maximum retries.
- Use exponential backoff with jitter for retryable failures.
- Respect Retry-After when provided.
- Do not retry invalid requests, permission denials, or unknown side effects.
- Bound concurrent provider calls.
- Bound context size and tool-result size.
- Record token usage if available.
- Provide an optional hard usage budget per task.
- Redact credentials from logs and error messages.

## 10. Testing provider compatibility

For every provider configuration, test:
- Authentication and base URL.
- Basic text generation.
- Streaming sequence.
- Multi-turn context.
- Tool-call round trip.
- Tool-result continuation.
- Vision input if enabled.
- Thinking parameters if enabled.
- Cancellation if supported.
- Error normalization and rate-limit handling.

A provider is compatible only for the features that pass these tests.