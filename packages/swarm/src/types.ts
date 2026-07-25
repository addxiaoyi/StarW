import { z } from "zod";
import type { AgentDefinition, AgentInstance, ChatMessage } from "@openstar/core";

export const TaskPriority = z.enum(["low", "normal", "high", "urgent"]);
export type TaskPriority = z.infer<typeof TaskPriority>;

export const TaskStatus = z.enum([
  "pending",
  "queued",
  "assigned",
  "running",
  "blocked",
  "completed",
  "failed",
  "cancelled",
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const Task = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  priority: TaskPriority.default("normal"),
  status: TaskStatus.default("pending"),
  parentTaskId: z.string().optional(),
  subtaskIds: z.array(z.string()).default(() => []),
  assignedAgentId: z.string().optional(),
  requiredCapabilities: z.array(z.string()).default(() => []),
  input: z.record(z.string(), z.unknown()).default(() => ({})),
  output: z.record(z.string(), z.unknown()).default(() => ({})),
  createdAt: z.number(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  error: z.string().optional(),
  dependencies: z.array(z.string()).default(() => []),
  progress: z.number().default(0),
  metadata: z.record(z.string(), z.unknown()).default(() => ({})),
});
export type Task = z.infer<typeof Task>;

export const DecompositionPlan = z.object({
  originalTask: z.string(),
  subtasks: z.array(Task),
  strategy: z.string(),
  estimatedComplexity: z.number(),
});
export type DecompositionPlan = z.infer<typeof DecompositionPlan>;

export const SwarmConfig = z.object({
  maxConcurrentAgents: z.number().default(4),
  maxTaskRetries: z.number().default(2),
  taskTimeoutMs: z.number().default(600000),
  enableParallelExecution: z.boolean().default(true),
  defaultAgentId: z.string().default("primary"),
});
export type SwarmConfig = z.infer<typeof SwarmConfig>;

export const ClusterNode = z.object({
  id: z.string(),
  address: z.string(),
  status: z.enum(["online", "offline", "busy", "maintenance"]),
  capacity: z.number(),
  currentLoad: z.number(),
  agentTypes: z.array(z.string()).default(() => []),
  lastHeartbeat: z.number(),
  metadata: z.record(z.string(), z.unknown()).default(() => ({})),
});
export type ClusterNode = z.infer<typeof ClusterNode>;

export interface SubAgentSpawnOptions {
  definition: AgentDefinition;
  taskId: string;
  sessionId: string;
  initialContext?: ChatMessage[];
  onStatusChange?: (status: AgentInstance["status"]) => void;
  onMessage?: (message: ChatMessage) => void;
}

export interface TaskAssignment {
  taskId: string;
  agentId: string;
  assignedAt: number;
}

export interface OrchestrationResult {
  taskId: string;
  success: boolean;
  output: Record<string, unknown>;
  error?: string;
  agentId: string;
  durationMs: number;
}
