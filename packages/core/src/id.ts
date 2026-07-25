export function generateId(prefix = "id"): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${timestamp}${random}`;
}

export function generateSessionId(): string {
  return generateId("sess");
}

export function generateAgentInstanceId(): string {
  return generateId("agent");
}

export function generateMessageId(): string {
  return generateId("msg");
}

export function generateTaskId(): string {
  return generateId("task");
}
