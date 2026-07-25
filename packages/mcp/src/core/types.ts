/**
 * 工具定义简化版
 * 与 MCP SDK 类型兼容
 */

import { z } from 'zod'

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>

export type ToolDefinition = {
  name: string
  description: string
  inputSchema: z.ZodType<Record<string, unknown>>
  handler: ToolHandler
}

// 文件系统工具接口
export type FileSystemTool = {
  path: string
  encoding?: string
}

export type FileSystemWriteArgs = {
  path: string
  content: string
  encoding?: string
}

export type ListDirectoryArgs = {
  path?: string
  recursive?: boolean
}

// Git 工具接口
export type GitStatusArgs = {
  cwd?: string
}

export type GitLogArgs = {
  cwd?: string
  limit?: number
  format?: string
}

// Web 工具接口
export type HttpGetArgs = {
  url: string
  headers?: Record<string, string>
  timeout?: number
}

// 系统工具接口
export type ExecCommandArgs = {
  command: string
  cwd?: string
  timeout?: number
  shell?: string
}

export type KillProcessArgs = {
  pid: number
  force?: boolean
}

// AI 工具接口
export type SummarizeTextArgs = {
  text: string
  maxLength?: number
  format?: 'short' | 'bullet' | 'paragraph'
}

export type CodeReviewArgs = {
  code: string
  language?: string
}

// Skills 工具接口
export type ListSkillsArgs = {
  category?: string
  enabled?: boolean
}

export type ExecuteSkillArgs = {
  name: string
  command: string
  args?: Record<string, unknown>
}

// Agents 工具接口
export type ListAgentsArgs = {
  status?: 'idle' | 'running' | 'stopped'
}

export type CreateTaskArgs = {
  description: string
  priority?: 'low' | 'normal' | 'high' | 'critical'
  agentId?: string
  tags?: string[]
}

export type AssignTaskArgs = {
  taskId: string
  agentId: string
}
