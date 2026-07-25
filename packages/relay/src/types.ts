import { z } from "zod";

export const LlmProvider = z.enum([
  "openai",
  "anthropic",
  "kimi",
  "grok",
  "gemini",
  "deepseek",
  "qwen",
  "ollama",
  "custom",
]);
export type LlmProvider = z.infer<typeof LlmProvider>;

export const ApiKeyStatus = z.enum(["active", "rate_limited", "exhausted", "invalid", "unknown"]);
export type ApiKeyStatus = z.infer<typeof ApiKeyStatus>;

export const ApiKeyEntry = z.object({
  id: z.string(),
  provider: LlmProvider,
  label: z.string().optional(),
  key: z.string(),
  status: ApiKeyStatus.default("unknown"),
  priority: z.number().default(50),
  rateLimitRpm: z.number().optional(),
  rateLimitTpm: z.number().optional(),
  monthlyBudgetUsd: z.number().optional(),
  usedUsd: z.number().default(0),
  lastUsedAt: z.number().optional(),
  enabled: z.boolean().default(true),
  models: z.array(z.string()).optional(),
  baseUrl: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default(() => ({})),
});
export type ApiKeyEntry = z.infer<typeof ApiKeyEntry>;

export const RouteStrategy = z.enum([
  "round_robin",
  "priority",
  "least_used",
  "latency",
  "failover",
  "random",
]);
export type RouteStrategy = z.infer<typeof RouteStrategy>;

export const RelayConfig = z.object({
  enabled: z.boolean().default(true),
  strategy: RouteStrategy.default("priority"),
  defaultProvider: LlmProvider.default("openai"),
  apiKeys: z.array(ApiKeyEntry).default(() => []),
  fallbackEnabled: z.boolean().default(true),
  maxRetries: z.number().default(2),
  retryDelayMs: z.number().default(1000),
  requestTimeoutMs: z.number().default(120000),
  enableCache: z.boolean().default(true),
  cacheTtlMs: z.number().default(3600000),
  enableMetrics: z.boolean().default(true),
  logRequests: z.boolean().default(false),
});
export type RelayConfig = z.infer<typeof RelayConfig>;

export const RelayMetrics = z.object({
  totalRequests: z.number().default(0),
  successfulRequests: z.number().default(0),
  failedRequests: z.number().default(0),
  totalTokensIn: z.number().default(0),
  totalTokensOut: z.number().default(0),
  totalCostUsd: z.number().default(0),
  avgLatencyMs: z.number().default(0),
  p50LatencyMs: z.number().default(0),
  p95LatencyMs: z.number().default(0),
  p99LatencyMs: z.number().default(0),
  requestsByProvider: z.record(z.string(), z.number()).default(() => ({})),
  requestsByModel: z.record(z.string(), z.number()).default(() => ({})),
  cacheHits: z.number().default(0),
  cacheMisses: z.number().default(0),
  startedAt: z.number().default(() => Date.now()),
});
export type RelayMetrics = z.infer<typeof RelayMetrics>;

export const ChatMessage = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
  toolCalls: z.array(z.unknown()).optional(),
  toolCallId: z.string().optional(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const ChatCompletionRequest = z.object({
  model: z.string(),
  messages: z.array(ChatMessage),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
  stream: z.boolean().optional(),
  tools: z.array(z.unknown()).optional(),
  provider: LlmProvider.optional(),
  apiKeyId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequest>;

export const ChatCompletionResponse = z.object({
  id: z.string(),
  model: z.string(),
  provider: LlmProvider,
  apiKeyId: z.string(),
  choices: z.array(z.object({
    message: ChatMessage,
    finishReason: z.string().optional(),
  })),
  usage: z.object({
    promptTokens: z.number().default(0),
    completionTokens: z.number().default(0),
    totalTokens: z.number().default(0),
  }).default(() => ({ promptTokens: 0, completionTokens: 0, totalTokens: 0 })),
  latencyMs: z.number(),
  cached: z.boolean().default(false),
});
export type ChatCompletionResponse = z.infer<typeof ChatCompletionResponse>;

export const RouteDecision = z.object({
  provider: LlmProvider,
  apiKeyId: z.string(),
  baseUrl: z.string().optional(),
  model: z.string(),
  strategy: RouteStrategy,
  reason: z.string(),
});
export type RouteDecision = z.infer<typeof RouteDecision>;
