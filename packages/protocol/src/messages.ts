/**
 * Protocol: Message types and event contracts.
 */

import { z } from "zod";
import type { ProtocolError } from "./errors.js";

export interface BaseRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface BaseResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: ProtocolError;
}

export interface BaseEvent {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
}

const PromptContent = z.object({
  type: z.enum(["text", "image", "tool_use", "tool_result"]).optional(),
  text: z.string().optional(),
}).passthrough();

const PromptMessage = z.object({
  id: z.string().optional(),
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.array(PromptContent),
  created_at: z.number().optional(),
}).passthrough();

export const SessionCreateParams = z.object({
  name: z.string().default("New Session"),
});
export type SessionCreateParams = z.infer<typeof SessionCreateParams>;

export const PromptParams = z.object({
  session_id: z.string(),
  messages: z.array(PromptMessage),
  model: z.string().optional(),
  system_prompt: z.string().optional(),
  stream: z.boolean().default(false),
});
export type PromptParams = z.infer<typeof PromptParams>;

export const SkillExecuteParams = z.object({
  skill_name: z.string().optional(),
  skill_id: z.string().optional(),
  args: z.record(z.string(), z.unknown()).default({}),
  input: z.record(z.string(), z.unknown()).optional(),
}).refine((value) => Boolean(value.skill_name || value.skill_id), {
  message: "skill_name or skill_id is required",
});
export type SkillExecuteParams = z.infer<typeof SkillExecuteParams>;

export interface AgentMessage {
  type: "task" | "status" | "result" | "error" | "heartbeat";
  from: string;
  to: string;
  payload: Record<string, unknown>;
  timestamp: number;
  correlationId?: string;
}

export interface SwarmMessage extends AgentMessage {
  type: "task" | "status" | "result" | "error";
  swarmId: string;
  nodeId?: string;
}

export interface ControlCommand {
  id: string;
  actorId: string;
  command: "pause" | "resume" | "cancel" | "retry" | "escalate";
  targetTaskId?: string;
  reason?: string;
  timestamp: number;
}

export interface ActivityEvent {
  id: string;
  sessionId: string;
  actorId: string;
  eventType: "node_started" | "node_completed" | "node_failed" | "evidence_submitted" | "tool_called";
  payload: Record<string, unknown>;
  timestamp: number;
  sequence: number;
}

export interface SurfaceUpdate {
  type: "patch" | "full";
  surfaceId: string;
  components: Array<{
    id: string;
    type: string;
    props: Record<string, unknown>;
  }>;
  timestamp: number;
}

export function createMessage(
  type: AgentMessage["type"],
  from: string,
  to: string,
  payload: Record<string, unknown> = {},
  correlationId?: string
): AgentMessage {
  return { type, from, to, payload, timestamp: Date.now(), correlationId };
}

export function createActivityEvent(
  sessionId: string,
  actorId: string,
  eventType: ActivityEvent["eventType"],
  payload: Record<string, unknown> = {},
  sequence = 0
): ActivityEvent {
  return {
    id: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    sessionId,
    actorId,
    eventType,
    payload,
    timestamp: Date.now(),
    sequence,
  };
}
