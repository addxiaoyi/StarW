import { z } from "zod";

export const ToolParameter = z.object({
  type: z.string(),
  description: z.string(),
  required: z.boolean().default(true),
});
export type ToolParameter = z.infer<typeof ToolParameter>;

export const ToolDefinition = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.string(), ToolParameter).default(() => ({})).optional(),
});
export type ToolDefinition = z.infer<typeof ToolDefinition>;

export interface ToolContext {
  cwd: string;
  workdir?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface ToolResult<T = unknown> {
  success: boolean;
  output: T;
  error?: string;
  warnings?: string[];
}

export type ToolExecutor<TInput = Record<string, unknown>, TOutput = unknown> = (
  input: TInput,
  context: ToolContext,
) => Promise<ToolResult<TOutput>>;

export interface RegisteredTool {
  definition: ToolDefinition;
  execute: ToolExecutor;
}
