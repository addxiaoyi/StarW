/**
 * StarCore MCP Integration - MCP 服务器与工具集成
 * 基于 @modelcontextprotocol/sdk
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { ulid } from "ulid"
import * as Z from "zod"

// ============= 工具类型定义 =============

export interface ToolAuthorization {
  readonly granted: boolean
  readonly reason?: string
}

export interface ToolContext {
  readonly agentId: string
  readonly agentType: string
  readonly sessionId: string
  readonly workingDirectory: string
  readonly environment: Record<string, string>
}

export interface ToolResult {
  readonly content: ToolContent[]
  readonly isError?: boolean
}

export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }

export interface Tool<Input = unknown> {
  readonly name: string
  readonly description: string
  readonly inputSchema: Z.ZodType<Input>
  readonly execute: (input: Input, context: ToolContext) => Promise<ToolResult>
}

export interface ToolEntry {
  tool: Tool
  enabled: boolean
  tags: string[]
}

export class ToolRegistry {
  private tools: Map<string, ToolEntry> = new Map()

  register(tool: Tool, options?: { tags?: string[]; enabled?: boolean }): void {
    this.tools.set(tool.name, {
      tool,
      enabled: options?.enabled ?? true,
      tags: options?.tags ?? [],
    })
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)?.tool
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  list(includeDisabled = false): Tool[] {
    return Array.from(this.tools.values())
      .filter((e) => includeDisabled || e.enabled)
      .map((e) => e.tool)
  }

  remove(name: string): boolean {
    return this.tools.delete(name)
  }

  async execute(name: string, input: unknown, context: ToolContext): Promise<ToolResult> {
    const entry = this.tools.get(name)
    if (!entry) {
      return { content: [{ type: "text", text: `Tool not found: ${name}` }], isError: true }
    }
    if (!entry.enabled) {
      return { content: [{ type: "text", text: `Tool disabled: ${name}` }], isError: true }
    }
    try {
      return await entry.tool.execute(input as any, context)
    } catch (err) {
      return { content: [{ type: "text", text: String(err) }], isError: true }
    }
  }
}

// ============= MCP Client =============

export interface McpServerConfig {
  readonly name: string
  readonly command: string
  readonly args?: string[]
  readonly env?: Record<string, string>
}

interface McpToolWrapper {
  readonly originalTool: Tool
  readonly serverName: string
}

export class McpClientManager {
  private clients: Map<string, Client> = new Map()
  private transports: Map<string, StdioClientTransport> = new Map()
  private toolWrappers: Map<string, McpToolWrapper> = new Map()
  private toolRegistry: ToolRegistry

  constructor(toolRegistry: ToolRegistry) {
    this.toolRegistry = toolRegistry
  }

  async connect(config: McpServerConfig): Promise<void> {
    if (this.clients.has(config.name)) {
      console.warn(`MCP server ${config.name} already connected`)
      return
    }

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args || [],
      env: config.env,
    })

    const client = new Client(
      {
        name: `starcore-${config.name}`,
        version: "0.1.0",
      },
      {
        capabilities: {},
      }
    )

    try {
      await client.connect(transport)
      this.clients.set(config.name, client)
      this.transports.set(config.name, transport)
      await this.registerTools(config.name, client)
      console.log(`MCP server ${config.name} connected`)
    } catch (err) {
      console.error(`Failed to connect MCP server ${config.name}:`, err)
      throw err
    }
  }

  async disconnect(name: string): Promise<void> {
    const client = this.clients.get(name)
    if (!client) return

    for (const [toolName, wrapper] of this.toolWrappers) {
      if (wrapper.serverName === name) {
        this.toolRegistry.remove(toolName)
        this.toolWrappers.delete(toolName)
      }
    }

    await client.close()
    this.clients.delete(name)
    this.transports.delete(name)
    console.log(`MCP server ${name} disconnected`)
  }

  private async registerTools(serverName: string, client: Client): Promise<void> {
    try {
      const response = await client.request(
        { method: "tools/list" } as any,
        { method: "tools/list", params: {} } as any
      )
      const tools = (response as any)?.tools || []

      for (const mcpTool of tools) {
        const wrappedTool = this.wrapMcpTool(serverName, client, mcpTool)
        this.toolRegistry.register(wrappedTool, {
          tags: ["mcp", serverName],
        })
        this.toolWrappers.set(mcpTool.name, {
          originalTool: wrappedTool,
          serverName,
        })
      }
    } catch (err) {
      console.warn(`Failed to list tools from ${serverName}:`, err)
    }
  }

  private wrapMcpTool(
    serverName: string,
    client: Client,
    mcpTool: { name: string; description: string; inputSchema: object }
  ): Tool {
    return {
      name: `${serverName}_${mcpTool.name}`,
      description: `[${serverName}] ${mcpTool.description}`,
      inputSchema: Z.any(),
      execute: async (input: unknown) => {
        try {
          const result = await client.request(
            { method: "tools/call" } as any,
            { method: "tools/call", params: { name: mcpTool.name, arguments: input } } as any
          ) as any

          const content = result.content?.map((c: any) => {
            if (c.type === "text") {
              return { type: "text" as const, text: c.text }
            }
            return { type: "text" as const, text: JSON.stringify(c) }
          }) || [{ type: "text" as const, text: "No content" }]

          return { content, isError: result.isError }
        } catch (err) {
          return { content: [{ type: "text", text: String(err) }], isError: true }
        }
      },
    }
  }

  listServers(): { name: string; status: "connected" | "disconnected" }[] {
    return Array.from(this.clients.keys()).map((name) => ({
      name,
      status: "connected" as const,
    }))
  }

  getToolCount(name: string): number {
    let count = 0
    for (const wrapper of this.toolWrappers.values()) {
      if (wrapper.serverName === name) count++
    }
    return count
  }

  getAllTools(): { server: string; tools: string[] }[] {
    const map = new Map<string, string[]>()
    for (const [toolName, wrapper] of this.toolWrappers) {
      const list = map.get(wrapper.serverName) || []
      list.push(toolName)
      map.set(wrapper.serverName, list)
    }
    return Array.from(map.entries()).map(([server, tools]) => ({ server, tools }))
  }
}

export const builtinMcpServers: Record<string, McpServerConfig> = {
  filesystem: {
    name: "filesystem",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", process.cwd()],
  },
  git: {
    name: "git",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-git"],
  },
}

export const createMcpClientManager = (toolRegistry: ToolRegistry): McpClientManager => {
  return new McpClientManager(toolRegistry)
}
