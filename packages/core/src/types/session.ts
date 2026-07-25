import { z } from "zod";

export const SessionStatus = z.enum(["active", "paused", "completed", "archived"]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const SessionConfig = z.object({
  id: z.string(),
  projectId: z.string().optional(),
  title: z.string().default("New Session"),
  status: SessionStatus.default("active"),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  metadata: z.record(z.string(), z.unknown()).default(() => ({})),
});
export type SessionConfig = z.infer<typeof SessionConfig>;

export const SessionSummary = z.object({
  id: z.string(),
  title: z.string(),
  status: SessionStatus,
  messageCount: z.number(),
  lastMessageAt: z.number().optional(),
  createdAt: z.number(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;
