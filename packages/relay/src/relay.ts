import type {
  RelayConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  RouteDecision,
} from "./types";
import { RelayConfig as RelayConfigSchema } from "./types";
import { ApiKeyManager } from "./key_manager";
import { RequestRouter } from "./router";
import { MetricsCollector } from "./metrics";
import crypto from "node:crypto";

interface OpenAiCompletionResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface AnthropicCompletionResponse {
  id?: string;
  model?: string;
  stop_reason?: string;
  content?: Array<
    | { type: "text"; text?: string }
    | { type: "tool_use"; id: string; name: string; input?: Record<string, unknown> }
  >;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export class Relay {
  private config: RelayConfig;
  private keyManager: ApiKeyManager;
  private router: RequestRouter;
  private metrics: MetricsCollector;
  private cache: Map<string, { response: ChatCompletionResponse; timestamp: number }> = new Map();

  constructor(config?: Partial<RelayConfig>) {
    this.config = RelayConfigSchema.parse(config || {});
    this.keyManager = new ApiKeyManager(this.config.apiKeys);
    this.router = new RequestRouter(this.keyManager, this.config.strategy);
    this.metrics = new MetricsCollector();
  }

  getConfig(): RelayConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<RelayConfig>): void {
    this.config = RelayConfigSchema.parse({ ...this.config, ...config });
    if (config.strategy) {
      this.router.setStrategy(config.strategy);
    }
    if (config.apiKeys) {
      this.keyManager = new ApiKeyManager(config.apiKeys);
      this.router = new RequestRouter(this.keyManager, this.config.strategy);
    }
  }

  getKeyManager(): ApiKeyManager {
    return this.keyManager;
  }

  getRouter(): RequestRouter {
    return this.router;
  }

  getMetrics(): MetricsCollector {
    return this.metrics;
  }

  private getCacheKey(request: ChatCompletionRequest): string {
    const keyData = JSON.stringify({
      model: request.model,
      messages: request.messages,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
    });
    return crypto.createHash("sha256").update(keyData).digest("hex");
  }

  async chatCompletion(
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse> {
    const startTime = Date.now();

    if (this.config.enableCache && !request.stream && !request.tools) {
      const cacheKey = this.getCacheKey(request);
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.config.cacheTtlMs) {
        this.metrics.recordCacheHit();
        return {
          ...cached.response,
          cached: true,
          latencyMs: Date.now() - startTime,
        };
      }
      this.metrics.recordCacheMiss();
    }

    const route = this.router.route(request);
    if (!route) {
      this.metrics.recordRequest(false, "none", request.model, Date.now() - startTime);
      throw new Error("No available API key for this request");
    }

    let lastError: Error | null = null;
    let currentRoute: RouteDecision | null = route;
    let retries = 0;

    while (currentRoute && retries <= this.config.maxRetries) {
      try {
        const response = await this.executeRequest(request, currentRoute);
        const latencyMs = Date.now() - startTime;

        this.metrics.recordRequest(true, response.provider, response.model, latencyMs);
        this.metrics.recordTokens(
          response.usage.promptTokens,
          response.usage.completionTokens,
        );

        const costUsd = this.estimateCost(response.model, response.usage.promptTokens, response.usage.completionTokens);
        this.metrics.recordCost(costUsd);
        this.keyManager.markUsed(response.apiKeyId, response.usage.promptTokens, response.usage.completionTokens, costUsd);

        if (this.config.enableCache && !request.stream && !request.tools) {
          const cacheKey = this.getCacheKey(request);
          this.cache.set(cacheKey, { response, timestamp: Date.now() });
          if (this.cache.size > 1000) {
            const oldest = this.cache.keys().next().value;
            if (oldest) this.cache.delete(oldest);
          }
        }

        return { ...response, latencyMs };
      } catch (err) {
        lastError = err as Error;
        retries++;

        if (this.config.fallbackEnabled && currentRoute) {
          this.keyManager.updateKeyStatus(currentRoute.apiKeyId, "rate_limited");
          const fallback = this.router.getFailover(currentRoute.apiKeyId, request);
          currentRoute = fallback;
        } else {
          currentRoute = null;
        }

        if (retries <= this.config.maxRetries) {
          await new Promise((r) => setTimeout(r, this.config.retryDelayMs * retries));
        }
      }
    }

    const latencyMs = Date.now() - startTime;
    this.metrics.recordRequest(false, route.provider, request.model, latencyMs);

    throw lastError || new Error("Request failed after all retries");
  }

  private async executeRequest(
    request: ChatCompletionRequest,
    route: RouteDecision,
  ): Promise<ChatCompletionResponse> {
    const key = this.keyManager.getKey(route.apiKeyId);
    if (!key) {
      throw new Error(`API key ${route.apiKeyId} not found`);
    }

    if (route.provider === "anthropic") {
      return this.executeAnthropicRequest(request, route, key.key);
    }

    return this.executeOpenAiCompatibleRequest(request, route, key.key);
  }

  private async executeOpenAiCompatibleRequest(
    request: ChatCompletionRequest,
    route: RouteDecision,
    apiKey: string,
  ): Promise<ChatCompletionResponse> {
    const baseUrl = route.baseUrl || this.getProviderBaseUrl(route.provider);
    const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.toolCalls ? { tool_calls: m.toolCalls } : {}),
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
      })),
      stream: false,
    };
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
    if (request.tools && request.tools.length > 0) body.tools = request.tools;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM request failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as OpenAiCompletionResponse;
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error("LLM response did not contain any choices");
    }

    const toolCalls = choice.message?.tool_calls
      ? choice.message.tool_calls.map((tc) => ({
          id: tc.id,
          type: tc.type,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }))
      : undefined;

    const responseId = data.id || `chatcmpl-${crypto.randomUUID().slice(0, 24)}`;

    return {
      id: responseId,
      model: data.model || request.model,
      provider: route.provider,
      apiKeyId: route.apiKeyId,
      choices: [
        {
          message: {
            role: (choice.message?.role as "assistant") || "assistant",
            content: choice.message?.content || "",
            ...(toolCalls ? { toolCalls } : {}),
          },
          finishReason: choice.finish_reason || "stop",
        },
      ],
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
      latencyMs: 0,
      cached: false,
    };
  }

  private async executeAnthropicRequest(
    request: ChatCompletionRequest,
    route: RouteDecision,
    apiKey: string,
  ): Promise<ChatCompletionResponse> {
    const baseUrl = route.baseUrl || "https://api.anthropic.com/v1";
    const url = `${baseUrl.replace(/\/$/, "")}/messages`;

    const systemMessage = request.messages.find((m) => m.role === "system");
    const conversationMessages = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxTokens ?? 4096,
      messages: conversationMessages,
    };
    if (systemMessage) body.system = systemMessage.content;
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => {
        const tool = t as { function?: { name: string; description: string; parameters?: Record<string, unknown> } };
        return {
          name: tool.function?.name || "unknown",
          description: tool.function?.description || "",
          input_schema: tool.function?.parameters || { type: "object", properties: {} },
        };
      });
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic request failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as AnthropicCompletionResponse;
    const textParts: string[] = [];
    const toolCalls: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }> = [];

    for (const block of data.content || []) {
      if (block.type === "text") {
        textParts.push(block.text || "");
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          type: "function",
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          },
        });
      }
    }

    return {
      id: data.id || `msg_${crypto.randomUUID().slice(0, 24)}`,
      model: data.model || request.model,
      provider: route.provider,
      apiKeyId: route.apiKeyId,
      choices: [
        {
          message: {
            role: "assistant",
            content: textParts.join("\n"),
            ...(toolCalls.length > 0 ? { toolCalls } : {}),
          },
          finishReason: data.stop_reason || "stop",
        },
      ],
      usage: {
        promptTokens: data.usage?.input_tokens || 0,
        completionTokens: data.usage?.output_tokens || 0,
        totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      },
      latencyMs: 0,
      cached: false,
    };
  }

  private getProviderBaseUrl(provider: string): string {
    const baseUrls: Record<string, string> = {
      openai: "https://api.openai.com/v1",
      anthropic: "https://api.anthropic.com/v1",
      kimi: "https://api.moonshot.cn/v1",
      grok: "https://api.x.ai/v1",
      gemini: "https://generativelanguage.googleapis.com/v1",
      deepseek: "https://api.deepseek.com/v1",
      qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      ollama: "http://localhost:11434/v1",
    };
    return baseUrls[provider] || baseUrls.openai;
  }

  private estimateCost(model: string, promptTokens: number, completionTokens: number): number {
    const costTable: Record<string, { prompt: number; completion: number }> = {
      "gpt-4": { prompt: 0.03, completion: 0.06 },
      "gpt-4o": { prompt: 0.005, completion: 0.015 },
      "claude-3-opus": { prompt: 0.015, completion: 0.075 },
      "claude-3-sonnet": { prompt: 0.003, completion: 0.015 },
      "grok-2": { prompt: 0.002, completion: 0.01 },
      "gemini-pro": { prompt: 0.0005, completion: 0.0015 },
    };

    const rates = costTable[model] || { prompt: 0.001, completion: 0.002 };
    return (promptTokens / 1000) * rates.prompt + (completionTokens / 1000) * rates.completion;
  }

  clearCache(): void {
    this.cache.clear();
  }

  getCacheStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: 1000,
    };
  }
}
