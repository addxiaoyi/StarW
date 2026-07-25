import type { AgentToolCall } from "../../core/src/system/agent-runtime.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeAgentToolCalls(value: unknown): AgentToolCall[] {
  if (!Array.isArray(value)) return [];
  const calls: AgentToolCall[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isRecord(item.function)) continue;
    const id = typeof item.id === "string" ? item.id : "";
    const name =
      typeof item.function.name === "string" ? item.function.name : "";
    const args = item.function.arguments;
    if (!id || !name || (typeof args !== "string" && !isRecord(args))) continue;
    calls.push({
      id,
      type: "function",
      function: { name, arguments: args },
    });
  }
  return calls;
}

export function stringParam(
  params: Record<string, unknown>,
  name: string,
  fallback = "",
): string {
  const value = params[name];
  return typeof value === "string" ? value : fallback;
}

export function booleanParam(
  params: Record<string, unknown>,
  name: string,
  fallback = false,
): boolean {
  const value = params[name];
  return typeof value === "boolean" ? value : fallback;
}

export function numberParam(
  params: Record<string, unknown>,
  name: string,
  fallback: number,
): number {
  const value = params[name];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export interface NormalizedToolResult {
  success: boolean;
  output: Record<string, unknown>;
  error?: string;
  duration_ms: number;
}

export function normalizeToolResult(result: unknown): NormalizedToolResult {
  const value = isRecord(result) ? result : {};
  const content = Array.isArray(value.content) ? value.content : [];
  const text = content
    .filter(isRecord)
    .map((item) => (typeof item.text === "string" ? item.text : ""))
    .filter(Boolean)
    .join("\n");
  const success = value.isError !== true;
  return {
    success,
    output: { content: text, result: text, raw: result },
    error: success ? undefined : text || "Tool execution failed",
    duration_ms: 0,
  };
}
