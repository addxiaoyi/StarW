import type { RelayMetrics } from "./types";
import { RelayMetrics as RelayMetricsSchema } from "./types";

export class MetricsCollector {
  private metrics: RelayMetrics;

  constructor() {
    this.metrics = RelayMetricsSchema.parse({});
  }

  recordRequest(success: boolean, provider: string, model: string, latencyMs: number): void {
    this.metrics.totalRequests++;
    if (success) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
    }

    this.metrics.requestsByProvider[provider] = (this.metrics.requestsByProvider[provider] || 0) + 1;
    this.metrics.requestsByModel[model] = (this.metrics.requestsByModel[model] || 0) + 1;

    this.updateLatency(latencyMs);
  }

  recordTokens(promptTokens: number, completionTokens: number): void {
    this.metrics.totalTokensIn += promptTokens;
    this.metrics.totalTokensOut += completionTokens;
  }

  recordCost(costUsd: number): void {
    this.metrics.totalCostUsd += costUsd;
  }

  recordCacheHit(): void {
    this.metrics.cacheHits++;
  }

  recordCacheMiss(): void {
    this.metrics.cacheMisses++;
  }

  private updateLatency(latencyMs: number): void {
    const total = this.metrics.successfulRequests;
    if (total <= 1) {
      this.metrics.avgLatencyMs = latencyMs;
      this.metrics.p50LatencyMs = latencyMs;
      this.metrics.p95LatencyMs = latencyMs;
      this.metrics.p99LatencyMs = latencyMs;
      return;
    }

    this.metrics.avgLatencyMs =
      (this.metrics.avgLatencyMs * (total - 1) + latencyMs) / total;

    if (latencyMs > this.metrics.p99LatencyMs) {
      this.metrics.p99LatencyMs = latencyMs;
    }
    if (latencyMs > this.metrics.p95LatencyMs && Math.random() < 0.05) {
      this.metrics.p95LatencyMs = latencyMs;
    }
    if (latencyMs > this.metrics.p50LatencyMs && Math.random() < 0.5) {
      this.metrics.p50LatencyMs = latencyMs;
    }
  }

  getMetrics(): RelayMetrics {
    return { ...this.metrics };
  }

  reset(): void {
    this.metrics = RelayMetricsSchema.parse({});
  }

  getSummary(): {
    totalRequests: number;
    successRate: number;
    avgLatencyMs: number;
    totalCostUsd: number;
    cacheHitRate: number;
  } {
    const total = this.metrics.totalRequests;
    const cacheTotal = this.metrics.cacheHits + this.metrics.cacheMisses;

    return {
      totalRequests: total,
      successRate: total > 0 ? this.metrics.successfulRequests / total : 0,
      avgLatencyMs: this.metrics.avgLatencyMs,
      totalCostUsd: this.metrics.totalCostUsd,
      cacheHitRate: cacheTotal > 0 ? this.metrics.cacheHits / cacheTotal : 0,
    };
  }
}
