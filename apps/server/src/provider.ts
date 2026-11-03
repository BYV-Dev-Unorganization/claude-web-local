import { config, type ModelAlias } from "./config.js";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
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
      system: messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n"),
      messages: messages.filter((message) => message.role !== "system").map((message) => ({ role: message.role, content: message.content }))
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


export type AgentToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};
export type AgentToolCall = { id: string; name: string; input: unknown };
export type AgentMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: AgentToolCall[];
  /** Opaque provider blocks are persisted only for correct Anthropic continuation; never render them in the UI. */
  providerContent?: unknown[];
};
export type AgentTurnResult = {
  text: string;
  toolCalls: AgentToolCall[];
  inputTokens: number;
  outputTokens: number;
  stopReason?: string;
  providerContent?: unknown[];
};
export type AgentTurnOptions = {
  tools?: AgentToolDefinition[];
  outputSchema?: Record<string, unknown>;
  forceToolName?: string;
};

function safeProviderError(bodyText: string): string {
  const safe = config.AI_API_KEY ? bodyText.split(config.AI_API_KEY).join("[REDACTED]") : bodyText;
  return safe.replace(/(sk-[A-Za-z0-9_-]{12,}|Bearer\\s+\\S+)/gi, "[REDACTED]").slice(0, 1000);
}

function toAnthropicMessages(messages: AgentMessage[]) {
  const result: Array<{ role: "user" | "assistant"; content: unknown }> = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "tool") {
      result.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: message.toolCallId, content: message.content }]
      });
    } else if (message.role === "assistant" && message.providerContent?.length) {
      result.push({ role: "assistant", content: message.providerContent });
    } else {
      result.push({ role: message.role, content: message.content });
    }
  }
  return result;
}

function parseToolArguments(value: unknown): unknown {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return {};
  try { return JSON.parse(value) as unknown; }
  catch { throw new ProviderError("Provider returned malformed tool-call JSON arguments.", false, 502); }
}

/** Provider-neutral non-streaming turn adapter for durable agent/tool execution. */
export async function completeAgentTurn(
  alias: ModelAlias,
  messages: AgentMessage[],
  signal: AbortSignal,
  options: AgentTurnOptions = {}
): Promise<AgentTurnResult> {
  const model = config.models[alias];
  if (!model) throw new ProviderError("Model alias '" + alias + "' is not configured.", false, 400);
  if (!config.AI_API_KEY || !config.AI_BASE_URL || !config.AI_PROVIDER) {
    throw new ProviderError("AI provider configuration is incomplete.", false, 503);
  }

  const modelThinking = config.modelThinking[alias];
  const url = endpoint(config.AI_PROTOCOL);
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  let body: Record<string, unknown>;

  if (config.AI_PROTOCOL === "anthropic-messages") {
    headers["x-api-key"] = config.AI_API_KEY;
    headers["anthropic-version"] = "2023-06-01";
    const tools = options.tools?.map((tool) => ({
      name: tool.name, description: tool.description, input_schema: tool.inputSchema, strict: true
    }));
    const thinking = modelThinking.mode === "off" ? undefined
      : modelThinking.mode === "adaptive" ? { type: "adaptive" }
      : { type: "enabled", budget_tokens: modelThinking.budgetTokens };
    const outputConfig = {
      ...(modelThinking.effort ? { effort: modelThinking.effort } : {}),
      ...(options.outputSchema ? { format: { type: "json_schema", schema: options.outputSchema } } : {})
    };
    body = {
      model,
      max_tokens: Math.max(config.AI_MAX_OUTPUT_TOKENS, thinking?.type === "enabled" ? modelThinking.budgetTokens + 1024 : 1),
      system: messages.filter((message) => message.role === "system").map((message) => message.content).join("\\n\\n"),
      messages: toAnthropicMessages(messages),
      ...(tools?.length ? { tools, tool_choice: options.forceToolName ? { type: "tool", name: options.forceToolName } : { type: "auto" } } : {}),
      ...(thinking ? { thinking } : {}),
      ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {})
    };
  } else {
    headers.authorization = "Bearer " + config.AI_API_KEY;
    const openAiTools = options.tools?.map((tool) => ({
      type: "function",
      function: { name: tool.name, description: tool.description, parameters: tool.inputSchema }
    }));
    body = {
      model,
      max_tokens: config.AI_MAX_OUTPUT_TOKENS,
      messages: messages.map((message) => {
        if (message.role === "assistant" && message.toolCalls?.length) {
          return {
            role: "assistant",
            content: message.content || null,
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) }
            }))
          };
        }
        if (message.role === "tool") return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
        return { role: message.role, content: message.content };
      }),
      ...(openAiTools?.length ? { tools: openAiTools, tool_choice: options.forceToolName
        ? { type: "function", function: { name: options.forceToolName } } : "auto" } : {}),
      ...(options.outputSchema ? {
        response_format: { type: "json_schema", json_schema: { name: "cwl_structured_output", strict: true, schema: options.outputSchema } }
      } : {}),
      ...(modelThinking.mode !== "off" ? { reasoning_effort: modelThinking.effort ?? (modelThinking.mode === "adaptive" ? "medium" : "high") } : {})
    };
  }

  const attempts = config.AI_MAX_RETRIES + 1;
  let response: Response | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      response = await fetch(url, {
        method: "POST", headers, body: JSON.stringify(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(config.AI_REQUEST_TIMEOUT_MS)])
      });
      if (response.ok || (response.status < 500 && response.status !== 429) || attempt + 1 >= attempts) break;
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      if (signal.aborted) throw error;
      if (attempt + 1 >= attempts) throw new ProviderError(error instanceof Error ? error.message : "Provider connection failed.", true);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(500 * (attempt + 1), 2000)));
  }
  if (!response) throw new ProviderError("Provider did not return a response.", true);
  if (!response.ok) throw new ProviderError(
    "Provider returned HTTP " + response.status + ": " + safeProviderError(await response.text().catch(() => "")),
    response.status === 429 || response.status >= 500, response.status
  );

  const data = await response.json() as Record<string, unknown>;
  let text = "";
  const toolCalls: AgentToolCall[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: string | undefined;

  if (config.AI_PROTOCOL === "anthropic-messages") {
    const blocks = Array.isArray(data.content) ? data.content as Array<Record<string, unknown>> : [];
    for (const block of blocks) {
      if (block.type === "text" && typeof block.text === "string") text += block.text;
      if (block.type === "tool_use") {
        toolCalls.push({ id: String(block.id ?? ""), name: String(block.name ?? ""), input: block.input ?? {} });
      }
    }
    const usage = data.usage as Record<string, unknown> | undefined;
    inputTokens = Number(usage?.input_tokens ?? 0);
    outputTokens = Number(usage?.output_tokens ?? 0);
    stopReason = typeof data.stop_reason === "string" ? data.stop_reason : undefined;
    return { text, toolCalls, inputTokens, outputTokens, stopReason, providerContent: blocks };
  }

  const choices = Array.isArray(data.choices) ? data.choices as Array<Record<string, unknown>> : [];
  const choice = choices[0] ?? {};
  const message = choice.message as Record<string, unknown> | undefined;
  if (typeof message?.content === "string") text = message.content;
  const calls = Array.isArray(message?.tool_calls) ? message.tool_calls as Array<Record<string, unknown>> : [];
  for (const call of calls) {
    const fn = call.function as Record<string, unknown> | undefined;
    toolCalls.push({ id: String(call.id ?? ""), name: String(fn?.name ?? ""), input: parseToolArguments(fn?.arguments) });
  }
  const usage = data.usage as Record<string, unknown> | undefined;
  inputTokens = Number(usage?.prompt_tokens ?? 0);
  outputTokens = Number(usage?.completion_tokens ?? 0);
  stopReason = typeof choice.finish_reason === "string" ? choice.finish_reason : undefined;
  return { text, toolCalls, inputTokens, outputTokens, stopReason };
}

export type ModelCapabilityReport = {
  alias: ModelAlias;
  modelId: string;
  protocol: string;
  probedAt: string;
  chat: boolean;
  toolCalling: boolean;
  structuredOutput: boolean;
  thinking: boolean | null;
  thinkingConfigured: string;
  errors: string[];
};
const capabilityCache = new Map<ModelAlias, ModelCapabilityReport>();

export function cachedModelCapabilities(): ModelCapabilityReport[] {
  return (Object.keys(config.models) as ModelAlias[]).map((alias) => capabilityCache.get(alias) ?? ({
    alias, modelId: config.models[alias] ?? "", protocol: config.AI_PROTOCOL, probedAt: "",
    chat: false, toolCalling: false, structuredOutput: false, thinking: null,
    thinkingConfigured: config.modelThinking[alias].mode, errors: []
  }));
}

/** Executes real low-token checks against the configured model id for one alias. */
export async function probeModelCapabilities(alias: ModelAlias): Promise<ModelCapabilityReport> {
  const errors: string[] = [];
  const base: ModelCapabilityReport = {
    alias, modelId: config.models[alias] ?? "", protocol: config.AI_PROTOCOL,
    probedAt: new Date().toISOString(), chat: false, toolCalling: false,
    structuredOutput: false, thinking: null, thinkingConfigured: config.modelThinking[alias].mode, errors
  };
  if (!base.modelId) {
    errors.push("Model alias is not configured.");
    capabilityCache.set(alias, base);
    return base;
  }
  const controller = new AbortController();
  try {
    await completeAgentTurn(alias, [{ role: "user", content: "Reply with exactly OK." }], controller.signal);
    base.chat = true;
  } catch (error) { errors.push("chat: " + (error instanceof Error ? error.message : "probe failed")); }
  try {
    const probeTool = {
      name: "cwl_probe_tool", description: "Capability check. Call this with {ok:true}.",
      inputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false }
    };
    const turn = await completeAgentTurn(alias, [
      { role: "system", content: "This is a tool capability check. Call cwl_probe_tool with ok=true." },
      { role: "user", content: "Call the capability test tool." }
    ], controller.signal, { tools: [probeTool] });
    base.toolCalling = turn.toolCalls.some((call) => call.name === "cwl_probe_tool");
    if (!base.toolCalling) errors.push("tool calling: model returned no probe tool call");
  } catch (error) { errors.push("tool calling: " + (error instanceof Error ? error.message : "probe failed")); }
  try {
    const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };
    const turn = await completeAgentTurn(alias, [
      { role: "system", content: "Return JSON matching the required schema. Output JSON only." },
      { role: "user", content: "Return {\\"ok\\":true}." }
    ], controller.signal, { outputSchema: schema });
    base.structuredOutput = JSON.parse(turn.text).ok === true;
    if (!base.structuredOutput) errors.push("structured output: response did not match the probe schema");
  } catch (error) { errors.push("structured output: " + (error instanceof Error ? error.message : "probe failed")); }
  if (base.chat && config.modelThinking[alias].mode !== "off") {
    try {
      const turn = await completeAgentTurn(alias, [{ role: "user", content: "Reply with exactly OK." }], controller.signal);
      base.thinking = Boolean(turn.stopReason);
    } catch (error) {
      base.thinking = false;
      errors.push("thinking: " + (error instanceof Error ? error.message : "probe failed"));
    }
  }
  capabilityCache.set(alias, base);
  return base;
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
