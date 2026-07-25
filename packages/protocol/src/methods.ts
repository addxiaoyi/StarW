/**
 * OpenStar 方法注册表
 * 所有支持的方法及参数 schema，作为服务端的路由表和客户端的类型提示
 */

import { z } from "zod"
import { SessionCreateParams, PromptParams, SkillExecuteParams } from "./messages.js"

// ============= 会话类方法 =============

export const SessionMethods = {
  "sessions/list": {
    description: "列出所有会话",
    params: z.object({}),
    result: z.array(z.object({ id: z.string(), name: z.string() })),
  },

  "sessions/create": {
    description: "创建新会话",
    params: SessionCreateParams,
    result: z.object({
      id: z.string(),
      name: z.string(),
      createdAt: z.number(),
    }),
  },

  "sessions/delete": {
    description: "删除会话",
    params: z.object({ session_id: z.string() }),
    result: z.object({ success: z.boolean() }),
  },

  "sessions/rename": {
    description: "重命名会话",
    params: z.object({ session_id: z.string(), name: z.string() }),
    result: z.object({ success: z.boolean() }),
  },

  "sessions/load": {
    description: "加载会话历史",
    params: z.object({ session_id: z.string() }),
    result: z.object({ messages: z.array(z.unknown()) }),
  },

  "sessions/prompt": {
    description: "发送提示词到会话",
    params: PromptParams,
    result: z.object({ message: z.unknown() }),
  },

  "sessions/stop": {
    description: "停止会话中的长时间运行操作",
    params: z.object({ session_id: z.string() }),
    result: z.object({ success: z.boolean() }),
  },

  "sessions/cancel": {
    description: "取消会话中的操作",
    params: z.object({ session_id: z.string() }),
    result: z.object({ success: z.boolean() }),
  },
} as const

// ============= 工具类方法 =============

export const ToolMethods = {
  "tools/list": {
    description: "列出所有可用工具",
    params: z.object({}),
    result: z.array(
      z.object({
        name: z.string(),
        description: z.string(),
        input_schema: z.record(z.string(), z.unknown()),
      })
    ),
  },

  "tools/call": {
    description: "调用工具",
    params: z.object({
      name: z.string(),
      arguments: z.record(z.string(), z.unknown()).optional(),
    }),
    result: z.unknown(),
  },
} as const

// ============= 模型类方法 =============

export const ModelMethods = {
  "models/list": {
    description: "列出所有可用模型",
    params: z.object({}),
    result: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        provider: z.string(),
        capabilities: z.array(z.string()),
      })
    ),
  },
} as const

// ============= 根目录类方法 =============

export const RootMethods = {
  "roots/list": {
    description: "列出所有根目录",
    params: z.object({}),
    result: z.array(z.object({ uri: z.string(), name: z.string() })),
  },

  "roots/add": {
    description: "添加根目录",
    params: z.object({ uri: z.string(), name: z.string() }),
    result: z.object({ success: z.boolean() }),
  },

  "roots/remove": {
    description: "移除根目录",
    params: z.object({ uri: z.string() }),
    result: z.object({ success: z.boolean() }),
  },
} as const

// ============= Skill 类方法 =============

export const SkillMethods = {
  "skills/list": {
    description: "列出所有技能",
    params: z.object({ category: z.string().optional() }),
    result: z.array(
      z.object({
        name: z.string(),
        description: z.string(),
        category: z.string(),
        enabled: z.boolean(),
      })
    ),
  },

  "skills/enable": {
    description: "启用技能",
    params: z.object({ name: z.string() }),
    result: z.object({ success: z.boolean() }),
  },

  "skills/disable": {
    description: "禁用技能",
    params: z.object({ name: z.string() }),
    result: z.object({ success: z.boolean() }),
  },

  "skills/execute": {
    description: "执行技能",
    params: SkillExecuteParams,
    result: z.unknown(),
  },
} as const

// ============= Agent 类方法 =============

export const AgentMethods = {
  "agents/list": {
    description: "列出所有 Agent",
    params: z.object({ status: z.enum(["idle", "running", "waiting"]).optional() }),
    result: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.string(),
        status: z.string(),
        createdAt: z.number(),
        updatedAt: z.number(),
      })
    ),
  },

  "agents/create": {
    description: "创建 Agent 实例",
    params: z.object({
      name: z.string(),
      type: z.enum(["build", "plan", "general", "custom"]),
    }),
    result: z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
    }),
  },

  "agents/task": {
    description: "向 Agent 发送任务",
    params: z.object({
      agent_id: z.string(),
      description: z.string(),
      priority: z.enum(["low", "normal", "high", "critical"]).optional(),
    }),
    result: z.object({ task_id: z.string() }),
  },
} as const

// ============= MCP 类方法 =============

export const McpMethods = {
  "mcp_servers/list": {
    description: "列出所有 MCP 服务器",
    params: z.object({}),
    result: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        status: z.string(),
        toolCount: z.number(),
      })
    ),
  },

  "mcp_servers/add": {
    description: "添加 MCP 服务器",
    params: z.object({ config: z.record(z.string(), z.unknown()) }),
    result: z.object({ id: z.string() }),
  },

  "mcp_servers/remove": {
    description: "移除 MCP 服务器",
    params: z.object({ id: z.string() }),
    result: z.object({ success: z.boolean() }),
  },
} as const

// ============= 系统类方法 =============

export const SystemMethods = {
  ping: {
    description: "心跳检测",
    params: z.object({}),
    result: z.object({ pong: z.string(), timestamp: z.number() }),
  },

  initialize: {
    description: "初始化连接",
    params: z.object({
      protocol_version: z.string(),
      capabilities: z.record(z.string(), z.unknown()).optional(),
      client_info: z
        .object({ name: z.string(), version: z.string() })
        .optional(),
    }),
    result: z.object({
      protocol_version: z.string(),
      capabilities: z.record(z.string(), z.unknown()),
      server_version: z.string(),
    }),
  },

  "system/status": {
    description: "获取系统状态",
    params: z.object({}),
    result: z.object({
      core: z.enum(["ready", "loading", "error"]),
      version: z.string(),
      swarm: z.object({
        enabled: z.boolean(),
        agents: z.number(),
      }),
      mcp: z.object({
        connected: z.boolean(),
        servers: z.number(),
      }),
      skills: z.number(),
    }),
  },
} as const

// ============= 合并导出 =============

export const AllMethods = {
  ...SystemMethods,
  ...SessionMethods,
  ...ToolMethods,
  ...ModelMethods,
  ...RootMethods,
  ...SkillMethods,
  ...AgentMethods,
  ...McpMethods,
} as const

export type MethodName = keyof typeof AllMethods

/**
 * 验证请求参数并返回类型化结果
 */
export function validateCall<N extends MethodName>(
  method: N,
  params: unknown
): { valid: true; params: z.infer<(typeof AllMethods)[N]["params"]> } | {
  valid: false
  error: string
} {
  const def = AllMethods[method]
  if (!def) return { valid: false, error: `Unknown method: ${method}` }

  const result = def.params.safeParse(params)
  if (!result.success) {
    return {
      valid: false,
      error: result.error.issues.map((issue: { message: string }) => issue.message).join("; "),
    }
  }
  return {
    valid: true,
    params: result.data as z.infer<(typeof AllMethods)[N]["params"]>,
  }
}
