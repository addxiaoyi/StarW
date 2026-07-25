import { acpRequest } from "./acp";
import type { AcpMessage, AcpMessageContent, AcpSession } from "./acp";

export interface ChatSession {
  acpSessionId: string;
  uiSessionId: string;
  name: string;
}

export interface ChatMessageDelta {
  text: string;
  done: boolean;
  messageId?: string;
}

export async function createChatSession(name = "New Session"): Promise<AcpSession> {
  const result = (await acpRequest("sessions/create", { name })) as { session: AcpSession };
  return result.session;
}

export async function sendChatMessage(
  acpSessionId: string,
  content: string,
  options: { model?: string; systemPrompt?: string } = {}
): Promise<void> {
  await acpRequest("sessions/prompt", {
    session_id: acpSessionId,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: content }],
      },
    ],
    model: options.model,
    system_prompt: options.systemPrompt,
    stream: false,
  });
}

export async function listChatMessages(
  acpSessionId: string,
  limit?: number,
  before?: string
): Promise<AcpMessage[]> {
  const result = (await acpRequest("sessions/list_messages", {
    session_id: acpSessionId,
    limit,
    before,
  })) as { messages: AcpMessage[] };
  return result.messages;
}

export async function pollForAssistantMessage(
  acpSessionId: string,
  afterMessageId?: string,
  options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<ChatMessageDelta | null> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 500;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const messages = await listChatMessages(acpSessionId);
    const latest = messages[messages.length - 1];

    if (latest && latest.id !== afterMessageId && latest.role === "assistant") {
      const text = latest.content
        .map((c: AcpMessageContent) => c.text)
        .filter(Boolean)
        .join("\n");
      return { text, done: true, messageId: latest.id };
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return null;
}
