import dotenv from "dotenv";
import { z } from "zod";
import path from "node:path";

dotenv.config();

const optionalText = z.preprocess((value) => value === "" ? undefined : value, z.string().optional());
const schema = z.object({
  APP_NAME: z.string().default("Claude Web Local"),
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_HOST: z.string().default("127.0.0.1"),
  APP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_TIMEZONE: z.string().default("Asia/Makassar"),
  AI_PROVIDER: optionalText,
  AI_PROTOCOL: z.enum(["anthropic-messages", "openai-chat-completions"]).default("anthropic-messages"),
  AI_BASE_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  AI_API_KEY: optionalText,
  AI_MODEL_FABLE: optionalText,
  AI_MODEL_OPUS: optionalText,
  AI_MODEL_SONNET: optionalText,
  AI_MODEL_HAIKU: optionalText,
  AI_DEFAULT_MODEL: z.enum(["fable", "opus", "sonnet", "haiku"]).default("sonnet"),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1).max(131072).default(8192),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(180000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  AI_THINKING_MODE_FABLE: z.enum(["off", "enabled", "adaptive"]).default("off"),
  AI_THINKING_MODE_OPUS: z.enum(["off", "enabled", "adaptive"]).default("off"),
  AI_THINKING_MODE_SONNET: z.enum(["off", "enabled", "adaptive"]).default("off"),
  AI_THINKING_MODE_HAIKU: z.enum(["off", "enabled", "adaptive"]).default("off"),
  AI_THINKING_BUDGET_FABLE: z.coerce.number().int().min(1024).max(65536).default(4096),
  AI_THINKING_BUDGET_OPUS: z.coerce.number().int().min(1024).max(65536).default(4096),
  AI_THINKING_BUDGET_SONNET: z.coerce.number().int().min(1024).max(65536).default(4096),
  AI_THINKING_BUDGET_HAIKU: z.coerce.number().int().min(1024).max(65536).default(4096),
  AI_REASONING_EFFORT_FABLE: z.preprocess((value) => value === "" ? undefined : value, z.enum(["low", "medium", "high"]).optional()),
  AI_REASONING_EFFORT_OPUS: z.preprocess((value) => value === "" ? undefined : value, z.enum(["low", "medium", "high"]).optional()),
  AI_REASONING_EFFORT_SONNET: z.preprocess((value) => value === "" ? undefined : value, z.enum(["low", "medium", "high"]).optional()),
  AI_REASONING_EFFORT_HAIKU: z.preprocess((value) => value === "" ? undefined : value, z.enum(["low", "medium", "high"]).optional()),
  TASK_MAX_TOOL_RESULT_BYTES: z.coerce.number().int().min(1024).max(1048576).default(65536),
  DATABASE_URL: z.string().default("file:./data/claude-web-local.sqlite"),
  STORAGE_PATH: z.string().default("./data/storage"),
  WORKSPACE_PATH: z.string().default("./data/workspaces"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).max(104857600).default(20971520),
  WEB_SEARCH_PROVIDER: optionalText,
  WEB_SEARCH_API_KEY: optionalText,
  EMBEDDING_PROVIDER: optionalText,
  EMBEDDING_BASE_URL: optionalText,
  EMBEDDING_API_KEY: optionalText,
  EMBEDDING_MODEL: optionalText,
  STT_PROVIDER: optionalText,
  STT_API_KEY: optionalText,
  TTS_PROVIDER: optionalText,
  TTS_API_KEY: optionalText,
  APP_ENCRYPTION_KEY: optionalText,
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  TASK_MAX_ITERATIONS: z.coerce.number().int().min(1).max(200).default(30),
  TASK_MAX_RUNTIME_SECONDS: z.coerce.number().int().min(10).max(86400).default(1800),
  TASK_MAX_TOOL_CALLS: z.coerce.number().int().min(1).max(1000).default(100),
  BROWSER_ALLOWED_HOSTS: optionalText
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const problems = parsed.error.issues.map((issue) => issue.path.join(".") + ": " + issue.message);
  throw new Error("Invalid environment configuration: " + problems.join("; "));
}

const env = parsed.data;
if (!["127.0.0.1", "::1", "localhost"].includes(env.APP_HOST)) {
  throw new Error("APP_HOST must remain loopback. Put remote access behind a VPN or authenticated reverse proxy that connects to 127.0.0.1.");
}
if (env.AI_BASE_URL) {
  const providerUrl = new URL(env.AI_BASE_URL);
  if (!["http:", "https:"].includes(providerUrl.protocol) || providerUrl.username || providerUrl.password || providerUrl.search || providerUrl.hash) {
    throw new Error("AI_BASE_URL must be an HTTP(S) base URL without embedded credentials, query parameters, or fragments.");
  }
}
const repositoryRoot = path.resolve(process.cwd(), "../..");
const databaseFile = env.DATABASE_URL.startsWith("file:")
  ? env.DATABASE_URL.slice(5)
  : env.DATABASE_URL;
if (databaseFile.startsWith("postgres:") || databaseFile.startsWith("postgresql:")) {
  throw new Error("This build supports SQLite DATABASE_URL values only.");
}

export const config = {
  ...env,
  databasePath: path.resolve(repositoryRoot, databaseFile),
  storagePath: path.resolve(repositoryRoot, env.STORAGE_PATH),
  workspacePath: path.resolve(repositoryRoot, env.WORKSPACE_PATH),
  browserAllowedHosts: (env.BROWSER_ALLOWED_HOSTS ?? "")
    .split(",").map((host) => host.trim().toLowerCase()).filter(Boolean),
  models: {
    fable: env.AI_MODEL_FABLE,
    opus: env.AI_MODEL_OPUS,
    sonnet: env.AI_MODEL_SONNET,
    haiku: env.AI_MODEL_HAIKU
  },
  modelThinking: {
    fable: { mode: env.AI_THINKING_MODE_FABLE, budgetTokens: env.AI_THINKING_BUDGET_FABLE, effort: env.AI_REASONING_EFFORT_FABLE },
    opus: { mode: env.AI_THINKING_MODE_OPUS, budgetTokens: env.AI_THINKING_BUDGET_OPUS, effort: env.AI_REASONING_EFFORT_OPUS },
    sonnet: { mode: env.AI_THINKING_MODE_SONNET, budgetTokens: env.AI_THINKING_BUDGET_SONNET, effort: env.AI_REASONING_EFFORT_SONNET },
    haiku: { mode: env.AI_THINKING_MODE_HAIKU, budgetTokens: env.AI_THINKING_BUDGET_HAIKU, effort: env.AI_REASONING_EFFORT_HAIKU }
  }
} as const;

export type ModelAlias = keyof typeof config.models;

export function isProviderConfigured(): boolean {
  return Boolean(
    config.AI_PROVIDER &&
    config.AI_BASE_URL &&
    config.AI_API_KEY &&
    config.models.fable &&
    config.models.opus &&
    config.models.sonnet &&
    config.models.haiku
  );
}

export function publicModelConfiguration() {
  return (Object.keys(config.models) as ModelAlias[]).map((alias) => ({
    alias,
    configured: Boolean(config.models[alias]),
    isDefault: alias === config.AI_DEFAULT_MODEL
  }));
}
