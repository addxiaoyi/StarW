/**
 * StarCore - Ultra-high performance terminal management agent
 * Skill + MCP + Agent Swarm Platform
 *
 * 基于 opencode 架构优化，重构自 StarCore
 */

import { ulid } from "ulid";
import * as Z from "zod";
import { ToolRegistry, initializeDefaultTools } from "./tool-registry.js";
import type { ToolContext, ToolResult } from "./tool-registry.js";
import { AgentRegistry, createAgentRegistry } from "./agent.js";
import { SessionManager, createSessionManager } from "./session.js";
import type { Session, SessionConfig, MessageContent } from "./session.js";

// ============= StarCore Core =============

export interface StarCoreConfig {
  readonly workingDirectory?: string;
  readonly model?: string;
  readonly temperature?: number;
  readonly enableSwarm?: boolean;
  readonly mcpServers?: string[];
}

export interface StarCoreStatus {
  core: "ready" | "initializing" | "error";
  version: string;
  swarm?: {
    enabled: boolean;
    stats?: {
      activeWorkers: number;
      totalTasks: number;
      completedTasks: number;
    };
  };
  mcp?: {
    servers: string[];
    totalTools: number;
  };
  agents?: {
    name: string;
    type: string;
  }[];
}

export class StarCore {
  private toolRegistry: ToolRegistry;
  private agentRegistry: AgentRegistry;
  private sessionManager: SessionManager;
  private config: StarCoreConfig;
  private initialized: boolean = false;

  constructor(config: StarCoreConfig = {}) {
    this.config = config;
    this.toolRegistry = new ToolRegistry();
    this.agentRegistry = createAgentRegistry();
    this.sessionManager = createSessionManager();
  }

  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // 初始化默认工具
    initializeDefaultTools(this.toolRegistry);

    this.initialized = true;
    console.log("[StarCore] Initialized successfully");
  }

  /**
   * 创建会话
   */
  createSession(config?: SessionConfig): Session {
    return this.sessionManager.create({
      ...config,
      workingDirectory:
        config?.workingDirectory || this.config.workingDirectory,
      model: config?.model || this.config.model,
      temperature: config?.temperature || this.config.temperature,
    });
  }

  /**
   * 获取工具列表
   */
  listTools() {
    return this.toolRegistry.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: this.toolRegistry.getMcpSchema(tool.name)?.inputSchema,
    }));
  }

  /**
   * Get OpenAI-compatible schemas for the embedded agent harness.
   */
  getToolSchemas(names?: string[]): object[] {
    const allowed = names ? new Set(names) : undefined;
    return this.toolRegistry.getOpenAiSchemas().filter((schema) => {
      if (!allowed) return true;
      const value = schema as { function?: { name?: string } };
      return value.function?.name ? allowed.has(value.function.name) : false;
    });
  }

  /**
   * 获取 Agent 列表
   */
  listAgents() {
    return this.agentRegistry.list().map((a) => ({
      name: a.name,
      type: a.type,
      description: a.description,
      instructions: a.instructions,
      permission: a.permission,
    }));
  }

  getAgent(name: string) {
    return this.agentRegistry.get(name);
  }

  /**
   * 获取状态
   */
  getStatus(): StarCoreStatus {
    return {
      core: this.initialized ? "ready" : "initializing",
      version: "0.1.0",
      swarm: {
        enabled: this.config.enableSwarm ?? true,
      },
      mcp: {
        servers: [],
        totalTools: this.toolRegistry.list().length,
      },
      agents: this.agentRegistry.list().map((a) => ({
        name: a.name,
        type: a.type,
      })),
    };
  }

  /**
   * 执行工具
   */
  async executeTool(
    name: string,
    input: unknown,
    context?: Partial<ToolContext>,
  ): Promise<ToolResult> {
    const defaultContext: ToolContext = {
      agentId: "system",
      agentType: "build",
      sessionId: this.sessionManager.create().id,
      workingDirectory: this.config.workingDirectory || process.cwd(),
      environment: {},
      ...context,
    };

    return this.toolRegistry.execute(name, input, defaultContext);
  }

  /**
   * 关闭
   */
  async close(): Promise<void> {
    console.log("[StarCore] Shutting down...");
    this.initialized = false;
  }
}

// ============= 工厂函数 =============

/**
 * 创建 StarCore 实例
 */
export const createStarCore = (config?: StarCoreConfig): StarCore => {
  return new StarCore(config);
};

// ============= 导出 =============

export { ToolRegistry };
export type { ToolContext, ToolResult };
export { AgentRegistry };
export { SessionManager };
export type { Session, SessionConfig, MessageContent };
