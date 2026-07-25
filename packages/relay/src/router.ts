import type {
  RouteDecision,
  RouteStrategy,
  LlmProvider,
  ChatCompletionRequest,
} from "./types";
import { ApiKeyManager } from "./key_manager";

export class RequestRouter {
  private keyManager: ApiKeyManager;
  private strategy: RouteStrategy;
  private roundRobinCounters: Map<string, number> = new Map();

  constructor(keyManager: ApiKeyManager, strategy: RouteStrategy = "priority") {
    this.keyManager = keyManager;
    this.strategy = strategy;
  }

  setStrategy(strategy: RouteStrategy): void {
    this.strategy = strategy;
  }

  getStrategy(): RouteStrategy {
    return this.strategy;
  }

  route(request: ChatCompletionRequest): RouteDecision | null {
    const provider = request.provider;
    const model = request.model;

    const keys = this.keyManager.getActiveKeys(provider, model);
    if (keys.length === 0) {
      return null;
    }

    const strategy = request.metadata?.strategy as RouteStrategy | undefined || this.strategy;

    let selectedKey;
    let reason = "";

    switch (strategy) {
      case "priority":
        selectedKey = keys.sort((a, b) => b.priority - a.priority)[0];
        reason = "highest priority";
        break;

      case "round_robin":
        const counterKey = provider || "all";
        const counter = this.roundRobinCounters.get(counterKey) || 0;
        selectedKey = keys[counter % keys.length];
        this.roundRobinCounters.set(counterKey, counter + 1);
        reason = "round robin";
        break;

      case "least_used":
        selectedKey = keys.sort((a, b) => (a.lastUsedAt || 0) - (b.lastUsedAt || 0))[0];
        reason = "least recently used";
        break;

      case "failover":
        selectedKey = keys.sort((a, b) => b.priority - a.priority)[0];
        reason = "failover primary";
        break;

      case "random":
        selectedKey = keys[Math.floor(Math.random() * keys.length)];
        reason = "random selection";
        break;

      default:
        selectedKey = keys[0];
        reason = "default";
    }

    return {
      provider: selectedKey.provider,
      apiKeyId: selectedKey.id,
      baseUrl: selectedKey.baseUrl,
      model: model,
      strategy,
      reason,
    };
  }

  getFailover(
    failedKeyId: string,
    request: ChatCompletionRequest,
  ): RouteDecision | null {
    const provider = request.provider;
    const model = request.model;

    const keys = this.keyManager
      .getActiveKeys(provider, model)
      .filter((k) => k.id !== failedKeyId);

    if (keys.length === 0) {
      return null;
    }

    const fallback = keys[0];
    return {
      provider: fallback.provider,
      apiKeyId: fallback.id,
      baseUrl: fallback.baseUrl,
      model: model,
      strategy: "failover",
      reason: `failover from ${failedKeyId}`,
    };
  }

  canFailover(keyId: string, provider?: LlmProvider): boolean {
    const keys = this.keyManager.getActiveKeys(provider);
    return keys.filter((k) => k.id !== keyId).length > 0;
  }
}
