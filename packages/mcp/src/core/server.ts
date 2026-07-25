/**
 * OpenStar MCP 核心服务器
 * 基于官方 SDK 的服务器封装
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
  ReadResourceRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

// 简化的工具定义
type ToolDefinition = {
  name: string
  description: string
  inputSchema: any
  handler: (args: Record<string, unknown>) => Promise<unknown>
}

export class MCPServer {
  private server: Server
  private tools: Map<string, ToolDefinition> = new Map()

  constructor() {
    this.server = new Server(
      {
        name: 'openstar-mcp',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      }
    )

    this.setupHandlers()
  }

  private setupHandlers() {
    // 列出所有工具
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: Array.from(this.tools.values()).map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: {
            type: 'object',
            properties: this.extractSchemaProperties(tool.inputSchema),
            required: this.extractSchemaRequired(tool.inputSchema),
          },
        })),
      }
    })

    // 调用工具
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params

      const tool = this.tools.get(name)
      if (!tool) {
        return {
          content: [
            {
              type: 'text',
              text: `Tool "${name}" not found`,
            },
          ],
          isError: true,
        }
      }

      try {
        const result = await tool.handler(args || {})
        return {
          content: [
            {
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            },
          ],
        }
      } catch (error: unknown) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        }
      }
    })

    // 列出资源
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return { resources: [] }
    })

    // 读取资源
    this.server.setRequestHandler(ReadResourceRequestSchema, async () => {
      return { contents: [] }
    })

    // 列出提示词
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      return { prompts: [] }
    })

    // 获取提示词
    this.server.setRequestHandler(GetPromptRequestSchema, async () => {
      return { messages: [] }
    })
  }

  // 从 Zod schema 提取属性
  private extractSchemaProperties(schema: any): Record<string, { type: string; description?: string }> {
    const props: Record<string, { type: string; description?: string }> = {}
    if (schema && schema._def && schema._def.shape) {
      const shape = schema._def.shape()
      for (const [key, value] of Object.entries(shape)) {
        if (value && (value as any).description) {
          props[key] = {
            type: (value as any)._def?.typeName === 'ZodString' ? 'string' : 'unknown',
            description: (value as any).description,
          }
        } else {
          props[key] = { type: 'string' }
        }
      }
    }
    return props
  }

  // 从 Zod schema 提取必需字段
  private extractSchemaRequired(schema: any): string[] {
    if (schema && schema._def && schema._def.shape) {
      const shape = schema._def.shape()
      return Object.keys(shape).filter((key) => {
        const field = shape[key]
        // ZodOptional doesn't have _def?.innerType?.required
        return !(field && (field as any)._def?.typeName === 'ZodOptional')
      })
    }
    return []
  }

  registerTool(tool: ToolDefinition) {
    this.tools.set(tool.name, tool)
  }

  registerToolSet(toolSet: { name: string; description?: string; tools: ToolDefinition[] }) {
    for (const tool of toolSet.tools) {
      this.tools.set(tool.name, tool)
    }
    console.log(`  [${toolSet.name}] ${toolSet.tools.length} 工具已注册`)
  }

  async start() {
    const transport = new StdioServerTransport()
    await this.server.connect(transport)
    console.log('✅ MCP 服务器已连接到 stdio')
  }
}
