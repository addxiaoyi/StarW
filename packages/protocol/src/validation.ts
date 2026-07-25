/**
 * Protocol: Zod-based validation schemas.
 */
import { z } from "zod";

export const AgentMessageSchema = z.object({
  type: z.enum(["task", "status", "result", "error", "heartbeat"]),
  from: z.string(),
  to: z.string(),
  payload: z.record(z.string(), z.unknown()),
  timestamp: z.number(),
  correlationId: z.string().optional(),
});

export const TaskPayloadSchema = z.object({
  taskId: z.string(),
  title: z.string(),
  description: z.string(),
  priority: z.enum(["urgent", "high", "normal", "low"]).default("normal"),
  input: z.record(z.string(), z.unknown()).default({}),
});

export const StatusPayloadSchema = z.object({
  agentId: z.string(),
  status: z.enum(["idle", "running", "paused", "completed", "failed", "cancelled"]),
  message: z.string().optional(),
});

export const ResultPayloadSchema = z.object({
  taskId: z.string(),
  success: z.boolean(),
  output: z.unknown(),
  error: z.string().optional(),
  durationMs: z.number(),
});

export const ErrorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

export const DagRunConfigSchema = z.object({
  dagId: z.string(),
  inputs: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  workspace: z.string().optional(),
  timeoutSeconds: z.number().optional(),
  parallel: z.boolean().default(true),
});

export function validate<T>(schema: z.ZodSchema<T>, data: unknown): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (result.success) return { success: true, data: result.data };
  return { success: false, error: result.error.message };
}
