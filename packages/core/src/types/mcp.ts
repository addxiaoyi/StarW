import { z } from "zod";

export const McpServerConfig = z.object({
  id: z.string(),
  name: z.string(),
  command: z.string(),
  args: z.array(z.string()).default(() => []),
  env: z.record(z.string(), z.string()).default(() => ({})),
  cwd: z.string().optional(),
  transport: z.enum(["stdio", "sse", "streamable-http"]).default("stdio"),
  url: z.string().optional(),
  timeoutMs: z.number().default(30000),
  enabled: z.boolean().default(true),
});
export type McpServerConfig = z.infer<typeof McpServerConfig>;

export const McpTool = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
});
export type McpTool = z.infer<typeof McpTool>;

export const McpResource = z.object({
  uri: z.string(),
  name: z.string(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
});
export type McpResource = z.infer<typeof McpResource>;

export const McpServerStatus = z.enum(["stopped", "starting", "running", "error"]);
export type McpServerStatus = z.infer<typeof McpServerStatus>;

export const McpServerState = z.object({
  config: McpServerConfig,
  status: McpServerStatus,
  tools: z.array(McpTool).default(() => []),
  resources: z.array(McpResource).default(() => []),
  error: z.string().optional(),
  connectedAt: z.number().optional(),
});
export type McpServerState = z.infer<typeof McpServerState>;
