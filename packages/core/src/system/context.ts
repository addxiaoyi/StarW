/**
 * StarCore System Context - 基于 Effect 的系统上下文管理
 * 参考 opencode 的 SystemContext 设计，实现可观测、可扩展的上下文架构
 *
 * 核心理念：
 * - ContextSource 提供数据源（文件、环境变量、API等）
 * - SystemContext 组合多个 ContextSource
 * - Context Snapshot 记录状态快照
 * - Context Epoch 保证状态一致性
 */

import * as Z from "zod"

// ============= ContextSource =============

/**
 * ContextSource 的稳定键值 - 类似 stable-keyed registry
 */
export type ContextSourceKey = string & { readonly __brand: "ContextSourceKey" }

/**
 * ContextSource 加载器 - 返回统一的 Promise
 */
export interface ContextSource<T> {
  readonly key: ContextSourceKey
  readonly load: () => Promise<T>
  readonly render?: {
    readonly baseline: (value: T) => string
    readonly update?: (prev: T, curr: T) => string
    readonly remove?: (value: T) => string
  }
}

/**
 * 创建 ContextSource
 */
export const makeContextSource = <T>(
  key: ContextSourceKey,
  load: () => Promise<T>,
  render?: {
    readonly baseline: (value: T) => string
    readonly update?: (prev: T, curr: T) => string
    readonly remove?: (value: T) => string
  }
): ContextSource<T> => ({
  key,
  load,
  render,
})

// ============= SystemContext =============

/**
 * Context 快照 - JSON编码存储状态
 */
export interface ContextSnapshot {
  readonly timestamp: number
  readonly values: Record<string, unknown>
}

/**
 * SystemContext - 可组合的上下文生产者集合
 */
export class SystemContext {
  private _sources: Map<ContextSourceKey, ContextSource<unknown>> = new Map()
  private codec: Z.ZodType

  constructor(
    sources: ReadonlyArray<ContextSource<unknown>> = [],
    codec: Z.ZodType = Z.any()
  ) {
    this.codec = codec
    for (const source of sources) {
      this._sources.set(source.key, source)
    }
  }

  /**
   * 获取所有源
   */
  get sources(): ReadonlyArray<ContextSource<unknown>> {
    return Array.from(this._sources.values())
  }

  /**
   * 添加 ContextSource
   */
  add<T>(source: ContextSource<T>): SystemContext {
    const newSources = new Map(this._sources)
    newSources.set(source.key, source as ContextSource<unknown>)
    return new SystemContext(Array.from(newSources.values()), this.codec)
  }

  /**
   * 移除 ContextSource
   */
  remove(key: ContextSourceKey): SystemContext {
    const newSources = new Map(this._sources)
    newSources.delete(key)
    return new SystemContext(Array.from(newSources.values()), this.codec)
  }

  /**
   * 渲染当前上下文为可观测字符串
   */
  async render(namespace?: string): Promise<string> {
    const sources = namespace
      ? this.sources.filter((s) => s.key.startsWith(namespace))
      : this.sources

    if (sources.length === 0) return "No context sources active"

    const baseline: string[] = []
    for (const source of sources) {
      try {
        const value = await source.load()
        if (source.render?.baseline) {
          baseline.push(source.render.baseline(value))
        }
      } catch (err) {
        console.error(`Context source ${source.key} failed:`, err)
      }
    }

    return baseline.join("\n\n")
  }

  /**
   * 创建快照
   */
  async snapshot(): Promise<ContextSnapshot> {
    const values: Record<string, unknown> = {}
    for (const source of this.sources) {
      try {
        values[source.key] = await source.load()
      } catch {
        values[source.key] = undefined
      }
    }
    return {
      timestamp: Date.now(),
      values,
    }
  }
}

// ============= 上下文时代管理 =============

/**
 * Context Epoch 标识
 */
export type ContextEpoch = number & { readonly __brand: "ContextEpoch" }

/**
 * 运行时上下文时代
 */
let currentEpoch: ContextEpoch = 0 as ContextEpoch

/**
 * 获取当前上下文时代
 */
export const getCurrentEpoch = (): ContextEpoch => currentEpoch

/**
 * 开始新的上下文时代（如compaction时）
 */
export const nextEpoch = (): ContextEpoch => {
  currentEpoch = (currentEpoch + 1) as ContextEpoch
  return currentEpoch
}

// ============= 辅助函数 =============

/**
 * 清理无效/远古时代的上下文（compaction）
 */
export const gcContextEpoch = (): void => {
  // 简单实现：重置时代
  currentEpoch = 0 as ContextEpoch
}

/**
 * Safe Provider-Turn Boundary！- 可以提交上下文变更的时机
 */
export const SafeBoundaryMarker = "safe-boundary"

/**
 * 确保在Safe边界执行
 */
export const withSafeBoundary = async <T>(fn: () => Promise<T>): Promise<T> => {
  const result = await fn()
  console.debug(`[safe-boundary] Completed at: ${new Date().toISOString()}`)
  return result
}
