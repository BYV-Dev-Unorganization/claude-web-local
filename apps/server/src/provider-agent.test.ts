import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "./config.js";
import { completeAgentTurn, type AgentMessage } from "./provider.js";

type MutableConfig = {
  AI_PROVIDER?: string;
  AI_PROTOCOL: string;
  AI_BASE_URL?: string;
  AI_API_KEY?: string;
  AI_MAX_OUTPUT_TOKENS: number;
  AI_REQUEST_TIMEOUT_MS: number;
  AI_MAX_RETRIES: number;
  models: Record<string, string | undefined>;
  modelThinking: Record<string, { mode: string; budgetTokens: number; effort?: string }>;
};
const mutable = config as unknown as MutableConfig;
const original = {
  AI_PROVIDER: config.AI_PROVIDER,
  AI_PROTOCOL: config.AI_PROTOCOL,
  AI_BASE_URL: config.AI_BASE_URL,
  AI_API_KEY: config.AI_API_KEY,
  AI_MAX_OUTPUT_TOKENS: config.AI_MAX_OUTPUT_TOKENS,
  AI_REQUEST_TIMEOUT_MS: config.AI_REQUEST_TIMEOUT_MS,
  AI_MAX_RETRIES: config.AI_MAX_RETRIES,
  models: { ...config.models },
  modelThinking: { ...config.modelThinking }
};
let requestBody: Record<string, unknown> = {};

function installResponse(payload: unknown) {
  vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify(payload), {
      status: 200, headers: { "content-type": "application/json" }
    });
  }));
}

function resetConfig() {
  Object.assign(mutable, {
    AI_PROVIDER: "test-provider", AI_PROTOCOL: "anthropic-messages",
    AI_BASE_URL: "https://provider.example", AI_API_KEY: "server-secret",
    AI_MAX_OUTPUT_TOKENS: 2048, AI_REQUEST_TIMEOUT_MS: 5000, AI_MAX_RETRIES: 0
  });
  Object.assign(mutable.models, { sonnet: "test-model" });
  Object.assign(mutable.modelThinking, {
    sonnet: { mode: "off", budgetTokens: 4096, effort: undefined }
  });
}

describe("provider agent contract", () => {
  beforeEach(resetConfig);
  afterEach(() => {
    vi.unstubAllGlobals();
    Object.assign(mutable, original);
    Object.assign(mutable.models, original.models);
    Object.assign(mutable.modelThinking, original.modelThinking);
  });

  it("sends Anthropic tool definitions and parses native tool_use blocks", async () => {
    installResponse({
      content: [
        { type: "text", text: "Checking workspace." },
        { type: "tool_use", id: "toolu_1", name: "workspace.list", input: { limit: 10 } }
      ],
      usage: { input_tokens: 17, output_tokens: 9 },
      stop_reason: "tool_use"
    });
    const result = await completeAgentTurn("sonnet", [
      { role: "system", content: "Use tools when needed." },
      { role: "user", content: "List files." }
    ], new AbortController().signal, {
      tools: [{
        name: "workspace.list", description: "List files.",
        inputSchema: { type: "object", properties: { limit: { type: "integer" } }, required: ["limit"], additionalProperties: false }
      }]
    });
    expect(requestBody.model).toBe("test-model");
    expect(requestBody.tool_choice).toEqual({ type: "auto" });
    expect(result.toolCalls).toEqual([{ id: "toolu_1", name: "workspace.list", input: { limit: 10 } }]);
    expect(result.providerContent).toHaveLength(2);
    expect(result.inputTokens).toBe(17);
    expect(requestBody.system).toBe("Use tools when needed.");
  });

  it("sends an Anthropic tool_result in the next turn while preserving assistant blocks", async () => {
    installResponse({
      content: [{ type: "text", text: "There are no files." }],
      usage: { input_tokens: 30, output_tokens: 7 },
      stop_reason: "end_turn"
    });
    const messages: AgentMessage[] = [
      { role: "user", content: "List files." },
      { role: "assistant", content: "", providerContent: [{ type: "tool_use", id: "toolu_1", name: "workspace.list", input: {} }] },
      { role: "tool", toolCallId: "toolu_1", content: "{\"files\":[]}" }
    ];
    await completeAgentTurn("sonnet", messages, new AbortController().signal);
    const bodyMessages = requestBody.messages as Array<Record<string, unknown>>;
    expect(bodyMessages[1]!.role).toBe("assistant");
    expect(bodyMessages[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "{\"files\":[]}" }]
    });
  });

  it("maps OpenAI Chat Completions tool calls, tool results, and JSON schema output", async () => {
    mutable.AI_PROTOCOL = "openai-chat-completions";
    installResponse({
      choices: [{
        message: {
          content: "",
          tool_calls: [{
            id: "call_1", type: "function",
            function: { name: "workspace.list", arguments: "{\"limit\":5}" }
          }]
        },
        finish_reason: "tool_calls"
      }],
      usage: { prompt_tokens: 11, completion_tokens: 4 }
    });
    const messages: AgentMessage[] = [
      { role: "user", content: "List files." },
      { role: "assistant", content: "", toolCalls: [{ id: "call_prev", name: "workspace.list", input: { limit: 2 } }] },
      { role: "tool", toolCallId: "call_prev", content: "{\"files\":[]}" }
    ];
    const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };
    const result = await completeAgentTurn("sonnet", messages, new AbortController().signal, { outputSchema: schema });
    expect(result.toolCalls[0]!).toEqual({ id: "call_1", name: "workspace.list", input: { limit: 5 } });
    const bodyMessages = requestBody.messages as Array<Record<string, unknown>>;
    expect(((bodyMessages[1]!).tool_calls as unknown[]).length).toBe(1);
    expect(bodyMessages[2]!.role).toBe("tool");
    expect(requestBody.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "cwl_structured_output", strict: true, schema }
    });
  });

  it("sends per-alias Anthropic thinking settings only when enabled", async () => {
    mutable.modelThinking.sonnet = { mode: "enabled", budgetTokens: 2048, effort: "high" };
    installResponse({ content: [{ type: "text", text: "Done." }], usage: { input_tokens: 2, output_tokens: 2 }, stop_reason: "end_turn" });
    await completeAgentTurn("sonnet", [{ role: "user", content: "Do a careful task." }], new AbortController().signal);
    expect(requestBody.thinking).toEqual({ type: "enabled", budget_tokens: 2048 });
    expect(requestBody.output_config).toEqual({ effort: "high" });
  });
});
