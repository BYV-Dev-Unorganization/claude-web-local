import { config, type ModelAlias } from "./config.js";

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type ProviderEvent =
  | { type: "text.delta"; text: string }
  | { type: "thinking.start" }
  | { type: "usage"; inputTokens?: number; outputTokens?: number }
  | { type: "done"; requestId?: string }
  | { type: "provider.error"; message: string; retryable: boolean };

export class ProviderError extends Error {
  constructor(message: string, public readonly retryable: boolean, public readonly status?: number) {
    super(message);
    this.name = "ProviderError";
  }
}

function endpoint(protocol: string): URL {
  const base = new URL(config.AI_BASE_URL!);
  const basePath = base.pathname.replace(/\/+$/, "");
  if (protocol === "anthropic-messages") {
    base.pathname = basePath.endsWith("/v1") ? basePath + "/messages" : basePath + "/v1/messages";
  } else {
    base.pathname = basePath.endsWith("/v1") ? basePath + "/chat/completions" : basePath + "/v1/chat/completions";
  }
  return base;
}

function parseSseData(line: string): unknown | undefined {
  if (!line.startsWith("data:")) return undefined;
  const value = line.slice(5).trim();
  if (!value || value === "[DONE]") return value === "[DONE]" ? { done: true } : undefined;
  try { return JSON.parse(value) as unknown; } catch { return undefined; }
}

export async function* streamCompletion(
  alias: ModelAlias,
  messages: ChatMessage[],
  signal: AbortSignal
): AsyncGenerator<ProviderEvent> {
  const model = config.models[alias];
  if (!model) throw new ProviderError("Model alias '" + alias + "' is not configured.", false, 400);
  if (!config.AI_API_KEY || !config.AI_BASE_URL || !config.AI_PROVIDER) {
    throw new ProviderError("AI provider configuration is incomplete. Configure AI_PROVIDER, AI_BASE_URL, AI_API_KEY and all model aliases.", false, 503);
  }

  const protocol = config.AI_PROTOCOL;
  const url = endpoint(protocol);
  const headers: Record<string, string> = { "content-type": "application/json", accept: "text/event-stream" };
  let body: Record<string, unknown>;

  if (protocol === "anthropic-messages") {
    headers["x-api-key"] = config.AI_API_KEY;
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model,
      max_tokens: config.AI_MAX_OUTPUT_TOKENS,
      stream: true,
      messages: messages.map((message) => ({ role: message.role, content: message.content }))
    };
  } else {
    headers.authorization = "Bearer " + config.AI_API_KEY;
    body = {
      model,
      stream: true,
      stream_options: { include_usage: true },
      messages: messages.map((message) => ({ role: message.role, content: message.content }))
    };
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(config.AI_REQUEST_TIMEOUT_MS)])
    });
  } catch (error) {
    if (signal.aborted) return;
    throw new ProviderError(error instanceof Error ? error.message : "Provider connection failed.", true);
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    const safeBody = (config.AI_API_KEY ? bodyText.split(config.AI_API_KEY).join("[REDACTED]") : bodyText).slice(0, 1000);
    throw new ProviderError("Provider returned HTTP " + response.status + (safeBody ? ": " + safeBody : ""), response.status === 429 || response.status >= 500, response.status);
  }
  if (!response.body) throw new ProviderError("Provider returned an empty streaming body.", true);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let requestId: string | undefined;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const event = parseSseData(line);
        if (!event || typeof event !== "object") continue;
        const data = event as Record<string, unknown>;
        if (protocol === "anthropic-messages") {
          if (data.type === "message_start" && data.message && typeof data.message === "object") {
            requestId = String((data.message as Record<string, unknown>).id ?? "");
          } else if (data.type === "content_block_start") {
            const block = data.content_block as Record<string, unknown> | undefined;
            if (block?.type === "thinking") yield { type: "thinking.start" };
          } else if (data.type === "content_block_delta") {
            const delta = data.delta as Record<string, unknown> | undefined;
            if (delta?.type === "text_delta" && typeof delta.text === "string") yield { type: "text.delta", text: delta.text };
            if (delta?.type === "thinking_delta") yield { type: "thinking.start" };
          } else if (data.type === "message_delta") {
            const usage = data.usage as Record<string, unknown> | undefined;
            if (usage) yield { type: "usage", outputTokens: Number(usage.output_tokens ?? 0) };
          } else if (data.type === "message_stop") {
            yield { type: "done", ...(requestId ? { requestId } : {}) };
          } else if (data.type === "error") {
            const error = data.error as Record<string, unknown> | undefined;
            throw new ProviderError(String(error?.message ?? "Provider stream error"), true);
          }
        } else {
          const choices = data.choices as Array<Record<string, unknown>> | undefined;
          const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
          if (typeof delta?.content === "string" && delta.content) yield { type: "text.delta", text: delta.content };
          if (data.usage && typeof data.usage === "object") {
            const usage = data.usage as Record<string, unknown>;
            yield { type: "usage", inputTokens: Number(usage.prompt_tokens ?? 0), outputTokens: Number(usage.completion_tokens ?? 0) };
          }
          if (choices?.[0]?.finish_reason) yield { type: "done", ...(requestId ? { requestId } : {}) };
          if (data.done === true) yield { type: "done", ...(requestId ? { requestId } : {}) };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function testProvider(alias: ModelAlias): Promise<{ ok: boolean; latencyMs: number; protocol: string }> {
  const started = Date.now();
  const controller = new AbortController();
  let text = "";
  for await (const event of streamCompletion(alias, [{ role: "user", content: "Reply with exactly: OK" }], controller.signal)) {
    if (event.type === "text.delta") text += event.text;
  }
  if (!text.trim()) throw new ProviderError("Provider test completed without text output.", false);
  return { ok: true, latencyMs: Date.now() - started, protocol: config.AI_PROTOCOL };
}
