import { z } from "zod";

export const ACP_PROTOCOL_VERSION = "2025-06-18";

export const AcpRequestType = z.enum([
  "initialize",
  "ping",
  "sessions/list",
  "sessions/create",
  "sessions/delete",
  "sessions/rename",
  "sessions/load",
  "sessions/prompt",
  "sessions/stop",
  "sessions/cancel",
  "sessions/list_messages",
  "roots/list",
  "roots/add",
  "roots/remove",
  "models/list",
  "tools/list",
  "tools/call",
  "resources/list",
  "resources/read",
  "mcp_servers/list",
  "mcp_servers/add",
  "mcp_servers/remove",
]);
export type AcpRequestType = z.infer<typeof AcpRequestType>;

export const AcpResponseType = z.enum([
  "result",
  "error",
  "event",
]);
export type AcpResponseType = z.infer<typeof AcpResponseType>;

export const AcpEventType = z.enum([
  "sessions/message",
  "sessions/updated",
  "sessions/deleted",
  "sessions/error",
  "tools/updated",
  "roots/updated",
]);
export type AcpEventType = z.infer<typeof AcpEventType>;

export const AcpRequest = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});
export type AcpRequest = z.infer<typeof AcpRequest>;

export const AcpResponse = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: z.unknown().optional(),
    })
    .optional(),
});
export type AcpResponse = z.infer<typeof AcpResponse>;

export const AcpEvent = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string(),
  params: z.record(z.string(), z.unknown()),
});
export type AcpEvent = z.infer<typeof AcpEvent>;

export const AcpSession = z.object({
  id: z.string(),
  name: z.string(),
  created_at: z.number(),
  updated_at: z.number(),
  message_count: z.number(),
});
export type AcpSession = z.infer<typeof AcpSession>;

export const AcpMessage = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.array(
    z.object({
      type: z.enum(["text", "image", "tool_use", "tool_result"]),
      text: z.string().optional(),
    })
  ),
  created_at: z.number(),
});
export type AcpMessage = z.infer<typeof AcpMessage>;

export const AcpModel = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  max_context: z.number().optional(),
  capabilities: z.array(z.string()).default(() => []),
});
export type AcpModel = z.infer<typeof AcpModel>;

export const AcpTool = z.object({
  name: z.string(),
  description: z.string(),
  input_schema: z.record(z.string(), z.unknown()),
});
export type AcpTool = z.infer<typeof AcpTool>;

export const AcpRoot = z.object({
  uri: z.string(),
  name: z.string(),
});
export type AcpRoot = z.infer<typeof AcpRoot>;

export const AcpServerConfig = z.object({
  serverName: z.string().default("openstar-acp"),
  serverVersion: z.string().default("0.1.0"),
  protocolVersion: z.string().default(ACP_PROTOCOL_VERSION),
  capabilities: z
    .object({
      sessions: z.boolean().default(true),
      tools: z.boolean().default(true),
      models: z.boolean().default(true),
      resources: z.boolean().default(false),
      roots: z.boolean().default(true),
      mcpServers: z.boolean().default(true),
      skills: z.boolean().default(true),
    })
    .default(() => ({
      sessions: true,
      tools: true,
      models: true,
      resources: false,
      roots: true,
      mcpServers: true,
      skills: true,
    })),
});
export type AcpServerConfig = z.infer<typeof AcpServerConfig>;

export const AcpInitializeParams = z.object({
  protocol_version: z.string(),
  capabilities: z.record(z.string(), z.unknown()).default(() => ({})),
  client_info: z
    .object({
      name: z.string(),
      version: z.string(),
    })
    .optional(),
});
export type AcpInitializeParams = z.infer<typeof AcpInitializeParams>;

export const AcpPromptParams = z.object({
  session_id: z.string(),
  messages: z.array(AcpMessage),
  model: z.string().optional(),
  system_prompt: z.string().optional(),
  stream: z.boolean().default(false),
});
export type AcpPromptParams = z.infer<typeof AcpPromptParams>;

export interface AcpConnection {
  id: string;
  connectedAt: number;
  clientInfo?: { name: string; version: string };
  initialized: boolean;
}

export enum AcpErrorCode {
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
  SessionNotFound = -32001,
  ModelNotFound = -32002,
  ToolNotFound = -32003,
  OperationCancelled = -32004,
  RateLimited = -32005,
}
