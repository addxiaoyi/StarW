/**
 * StarCore Agent - 智能体核心定义
 * 基于 opencode 的 Agent 理念设计
 */

import { ContextSource, makeContextSource, ContextSourceKey } from "./context.js"
import * as Z from "zod"

// ============= Agent 类型定义 =============

/**
 * Agent 类型 - build/plan/general
 */
export const AgentTypeSchema = Z.enum(["build", "plan", "general", "custom"])
export type AgentType = Z.infer<typeof AgentTypeSchema>

/**
 * Agent 权限级别
 */
export interface AgentPermission {
  canEdit: boolean
  canExecute: boolean
  canAccessNetwork: boolean
  canUseMcp: boolean
  allowedDirectories: string[]
  deniedPatterns: string[]
}

/**
 * Agent 配置
 */
export interface AgentConfig {
  name: string
  description: string
  type: AgentType
  permission: AgentPermission
  instructions?: string
}

/**
 * Agent 上下文guidance
 */
export interface AgentGuidance {
  readonly name: string
  readonly description: string
  readonly type: AgentType
  readonly permission: AgentPermission
  readonly instructions?: string
}

/**
 * Agent 实例
 */
export interface Agent {
  readonly id: string
  readonly name: string
  readonly type: AgentType
  readonly permission: AgentPermission
  readonly status: "idle" | "running" | "waiting" | "completed" | "failed"
  readonly metadata: Record<string, unknown>
  readonly createdAt: number
  readonly updatedAt: number
}

// ============= Agent 工厂 =============

/**
 * 创建 build agent（默认，拥有全部权限）
 */
export const buildAgentGuidance: AgentGuidance = {
  name: "build",
  description: "Default full-access agent for development work",
  type: "build",
  permission: {
    canEdit: true,
    canExecute: true,
    canAccessNetwork: true,
    canUseMcp: true,
    allowedDirectories: [],
    deniedPatterns: [],
  },
}

/**
 * 创建 plan agent（只读，分析用）
 */
export const planAgentGuidance: AgentGuidance = {
  name: "plan",
  description: "Read-only agent for analysis and code exploration",
  type: "plan",
  permission: {
    canEdit: false,
    canExecute: false,
    canAccessNetwork: true,
    canUseMcp: false,
    allowedDirectories: [],
    deniedPatterns: [],
  },
}

/**
 * 创建 general agent（通用子agent）
 */
export const generalAgentGuidance: AgentGuidance = {
  name: "general",
  description: "General-purpose subagent for complex searches and multistep tasks",
  type: "general",
  permission: {
    canEdit: true,
    canExecute: true,
    canAccessNetwork: true,
    canUseMcp: true,
    allowedDirectories: [],
    deniedPatterns: [],
  },
}

// ============= Agent 注册表 =============

/**
 * Agent 注册表
 */
export class AgentRegistry {
  private agents: Map<string, AgentGuidance> = new Map()
  private instances: Map<string, Agent> = new Map()

  constructor() {
    this.register(buildAgentGuidance)
    this.register(planAgentGuidance)
    this.register(generalAgentGuidance)
  }

  /**
   * 注册 agent guidance
   */
  register(guidance: AgentGuidance): void {
    this.agents.set(guidance.name, guidance)
  }

  /**
   * 获取 agent guidance
   */
  get(name: string): AgentGuidance | undefined {
    return this.agents.get(name)
  }

  /**
   * 列出所有 agent guidance
   */
  list(): AgentGuidance[] {
    return Array.from(this.agents.values())
  }

  /**
   * 创建 agent 实例
   */
  create(name: string, id: string): Agent | undefined {
    const guidance = this.agents.get(name)
    if (!guidance) return undefined

    const agent: Agent = {
      id,
      name: guidance.name,
      type: guidance.type,
      permission: guidance.permission,
      status: "idle",
      metadata: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    this.instances.set(id, agent)
    return agent
  }

  /**
   * 获取 agent 实例
   */
  getInstance(id: string): Agent | undefined {
    return this.instances.get(id)
  }

  /**
   * 更新 agent 状态
   */
  updateStatus(id: string, status: Agent["status"]): boolean {
    const agent = this.instances.get(id)
    if (!agent) return false

    this.instances.set(id, {
      ...agent,
      status,
      updatedAt: Date.now(),
    })
    return true
  }

  /**
   * 获取可用的 agent guidance（用于上下文注入）
   */
  getAvailableGuidance(): { name: string; description: string }[] {
    return this.list().map((a) => ({
      name: a.name,
      description: a.description,
    }))
  }
}

// ============= Agent ContextSource =============

/**
 * 获取当前 agent 的上下文（用于 SystemContext）
 */
export const currentAgentContextSource = (
  registry: AgentRegistry
): ContextSource<{ name: string; description: string }[]> =>
  makeContextSource(
    "agent-available" as ContextSourceKey,
    async () => registry.getAvailableGuidance(),
    {
      baseline: (agents) =>
        `## Available Agents\n\n${agents.map((a) => `- **${a.name}**: ${a.description}`).join("\n")}`,
    }
  )

// ============= 工厂函数 =============

/**
 * 创建 Agent 注册表
 */
export const createAgentRegistry = (): AgentRegistry => {
  return new AgentRegistry()
}
