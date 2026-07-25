import { z } from "zod";

export const MessageRole = z.enum(["user", "assistant", "system", "tool"]);
export type MessageRole = z.infer<typeof MessageRole>;

export const MessageContent = z.object({
  type: z.enum(["text", "image", "tool_use", "tool_result"]),
  text: z.string().optional(),
  data: z.string().optional(),
  toolName: z.string().optional(),
  toolInput: z.record(z.string(), z.unknown()).optional(),
  toolResult: z.unknown().optional(),
});
export type MessageContent = z.infer<typeof MessageContent>;

export const ChatMessage = z.object({
  id: z.string(),
  role: MessageRole,
  content: z.array(MessageContent),
  timestamp: z.number(),
  sessionId: z.string(),
  parentId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default(() => ({})),
});
export type ChatMessage = z.infer<typeof ChatMessage>;
