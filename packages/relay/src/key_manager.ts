import type { ApiKeyEntry, LlmProvider, ApiKeyStatus } from "./types";
import { ApiKeyStatus as ApiKeyStatusEnum } from "./types";

export class ApiKeyManager {
  private keys: Map<string, ApiKeyEntry> = new Map();

  constructor(initialKeys: ApiKeyEntry[] = []) {
    for (const key of initialKeys) {
      this.keys.set(key.id, key);
    }
  }

  addKey(key: ApiKeyEntry): void {
    this.keys.set(key.id, key);
  }

  removeKey(keyId: string): boolean {
    return this.keys.delete(keyId);
  }

  getKey(keyId: string): ApiKeyEntry | undefined {
    return this.keys.get(keyId);
  }

  getAllKeys(): ApiKeyEntry[] {
    return Array.from(this.keys.values());
  }

  getActiveKeys(provider?: LlmProvider, model?: string): ApiKeyEntry[] {
    return this.getAllKeys().filter((k) => {
      if (!k.enabled) return false;
      if (k.status === "invalid" || k.status === "exhausted") return false;
      if (provider && k.provider !== provider) return false;
      if (model && k.models && !k.models.includes(model)) return false;
      return true;
    });
  }

  updateKeyStatus(keyId: string, status: ApiKeyStatus): void {
    const key = this.keys.get(keyId);
    if (key) {
      key.status = status;
    }
  }

  markUsed(keyId: string, tokensIn: number, tokensOut: number, costUsd: number): void {
    const key = this.keys.get(keyId);
    if (key) {
      key.lastUsedAt = Date.now();
      key.usedUsd += costUsd;
    }
  }

  getLeastUsedKey(provider?: LlmProvider): ApiKeyEntry | undefined {
    const active = this.getActiveKeys(provider);
    if (active.length === 0) return undefined;
    return active.sort((a, b) => (a.lastUsedAt || 0) - (b.lastUsedAt || 0))[0];
  }

  getHighestPriorityKey(provider?: LlmProvider): ApiKeyEntry | undefined {
    const active = this.getActiveKeys(provider);
    if (active.length === 0) return undefined;
    return active.sort((a, b) => b.priority - a.priority)[0];
  }

  getRoundRobinKey(provider?: LlmProvider): ApiKeyEntry | undefined {
    const active = this.getActiveKeys(provider);
    if (active.length === 0) return undefined;
    const index = Math.floor(Math.random() * active.length);
    return active[index];
  }

  validateKey(keyId: string): boolean {
    const key = this.keys.get(keyId);
    if (!key) return false;
    return key.status !== "invalid" && key.status !== "exhausted" && key.enabled;
  }

  getStats(): {
    totalKeys: number;
    activeKeys: number;
    totalCostUsd: number;
    byProvider: Record<string, number>;
  } {
    const all = this.getAllKeys();
    const byProvider: Record<string, number> = {};
    let totalCost = 0;
    let active = 0;

    for (const key of all) {
      if (key.status === "active" || key.status === "unknown" || key.status === "rate_limited") {
        active++;
      }
      totalCost += key.usedUsd;
      byProvider[key.provider] = (byProvider[key.provider] || 0) + 1;
    }

    return {
      totalKeys: all.length,
      activeKeys: active,
      totalCostUsd: totalCost,
      byProvider,
    };
  }
}
