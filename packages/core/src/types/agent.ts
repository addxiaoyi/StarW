import { z } from "zod";

export const AgentType = z.enum(["primary", "subagent", "worker", "specialist"]);
export type AgentType = z.infer<typeof AgentType>;

export const AgentStatus = z.enum(["idle", "running", "paused", "completed", "failed", "cancelled"]);
export type AgentStatus = z.infer<typeof AgentStatus>;

export const AgentCapability = z.object({
  name: z.string(),
  description: z.string(),
  version: z.string(),
  tags: z.array(z.string()).default(() => []),
});
export type AgentCapability = z.infer<typeof AgentCapability>;

export const AgentDefinition = z.object({
  id: z.string(),
  name: z.string(),
  type: AgentType,
  description: z.string(),
  systemPrompt: z.string().optional(),
  model: z.string().optional(),
  capabilities: z.array(AgentCapability).default(() => []),
  skills: z.array(z.string()).default(() => []),
  mcpServers: z.array(z.string()).default(() => []),
  maxConcurrentTasks: z.number().default(1),
  timeoutMs: z.number().default(300000),
});
export type AgentDefinition = z.infer<typeof AgentDefinition>;

export const AgentInstance = z.object({
  instanceId: z.string(),
  definitionId: z.string(),
  status: AgentStatus,
  currentTaskId: z.string().optional(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  error: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default(() => ({})),
});
export type AgentInstance = z.infer<typeof AgentInstance>;
