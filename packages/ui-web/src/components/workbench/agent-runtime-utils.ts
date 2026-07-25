import { isRecord } from "./runtime-view-utils";

export interface AgentToolCall {
  id: string;
  function: {
    name: string;
    arguments: string | Record<string, unknown>;
  };
}

export interface AgentRuntimeEvent {
  type: string;
  timestamp: number;
  iteration?: number;
  toolCall?: AgentToolCall;
  toolResult?: {
    success: boolean;
    error?: string;
    durationMs?: number;
  };
  delta?: {
    type?: string;
    content?: string;
  };
  context?: {
    droppedMessages?: number;
    compactedMessages?: number;
    estimatedTokens?: number;
  };
  error?: string;
  finishReason?: string;
}

export interface AgentOrchestrationStep {
  id: string;
  agent: string;
  prompt: string;
  dependsOn: string[];
}

export interface AgentCapabilities {
  canEdit?: boolean;
  canExecute?: boolean;
  canUseMcp?: boolean;
}

export type AgentDesktopEventAction =
  | { kind: "none" }
  | { kind: "append-output"; sessionId: string; content: string }
  | { kind: "clear-output"; sessionId: string; refreshDelay: 0 }
  | { kind: "refresh"; delay: number };

const AGENT_REFRESH_EVENT_TYPES = new Set([
  "tool_execution_end",
  "context_compacted",
  "turn_end",
  "agent_end",
  "agent_error",
]);

const AGENT_COMPLETION_EVENTS = new Set([
  "agent.completed",
  "agent.failed",
  "agent.cancelled",
]);

const AGENT_REFRESH_EVENTS = new Set([
  "agent.started",
  "agent.session.created",
  "agent.session.renamed",
  "agent.session.deleted",
]);

const AGENT_REFRESH_PREFIXES = [
  "swarm.",
  "approval.",
  "change.",
  "agent.definition.",
  "agent.delegation.",
  "agent.orchestration.",
];

export function validateAgentName(rawName: string): string {
  const name = rawName.trim().toLowerCase();
  if (!name) return "名称不能为空";
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(name)) {
    return "使用 2–32 位小写字母、数字和连字符，并以字母开头";
  }
  return "";
}

export function parseAgentList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildAgentTools(capabilities: AgentCapabilities): string[] {
  const tools = ["read", "grep", "skill:*"];
  if (capabilities.canEdit) tools.push("write", "edit");
  if (capabilities.canExecute) tools.push("bash");
  if (capabilities.canUseMcp) tools.push("mcp:*");
  return tools;
}

export function approvalRemainingSeconds(
  expiresAt: number,
  nowMs: number,
): number {
  return Math.max(0, Math.ceil((expiresAt - nowMs) / 1000));
}

export function filterAgentEvents(
  events: AgentRuntimeEvent[],
  filter: string,
): AgentRuntimeEvent[] {
  if (filter === "all") return events;
  if (filter === "tool") {
    return events.filter((event) => event.type.includes("tool"));
  }
  if (filter === "error") {
    return events.filter(
      (event) =>
        event.type === "agent_error" || event.toolResult?.success === false,
    );
  }
  return events.filter((event) => event.type === "context_compacted");
}

export function visibleAgentEvents(
  events: AgentRuntimeEvent[],
  filter: string,
  limit: number,
): AgentRuntimeEvent[] {
  return filterAgentEvents(events, filter).slice(-limit);
}

export function parseAgentOrchestrationPlan(
  source: string,
): AgentOrchestrationStep[] {
  const parsed = JSON.parse(source) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("DAG 计划必须是非空 JSON 数组");
  }
  const steps = parsed.map((value, index): AgentOrchestrationStep => {
    if (!isRecord(value)) {
      throw new Error(`DAG 第 ${index + 1} 步必须是对象`);
    }
    const id = typeof value.id === "string" ? value.id.trim() : "";
    const agent = typeof value.agent === "string" ? value.agent.trim() : "";
    const prompt = typeof value.prompt === "string" ? value.prompt.trim() : "";
    const dependsOn = Array.isArray(value.dependsOn)
      ? value.dependsOn.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
    if (!id || !agent || !prompt) {
      throw new Error(`DAG 第 ${index + 1} 步缺少 id、agent 或 prompt`);
    }
    return { id, agent, prompt, dependsOn };
  });
  const ids = new Set(steps.map((step) => step.id));
  if (ids.size !== steps.length) throw new Error("DAG 步骤 id 不能重复");
  for (const step of steps) {
    const missing = step.dependsOn.find((id) => !ids.has(id));
    if (missing) throw new Error(`${step.id} 依赖不存在的步骤 ${missing}`);
  }
  return steps;
}

export function summarizeAgentEvent(event: AgentRuntimeEvent): string {
  const iteration = event.iteration ? `第 ${event.iteration} 轮 · ` : "";
  if (event.type === "tool_execution_start") {
    return `${iteration}调用工具 ${event.toolCall?.function.name ?? "unknown"}`;
  }
  if (event.type === "tool_execution_end") {
    const name = event.toolCall?.function.name ?? "unknown";
    const state = event.toolResult?.success ? "完成" : "失败";
    return `${iteration}${name} ${state}`;
  }
  if (event.type === "context_compacted") {
    return `${iteration}压缩上下文 · 丢弃 ${event.context?.droppedMessages ?? 0} 条 · 约 ${event.context?.estimatedTokens ?? 0} tokens`;
  }
  if (event.type === "turn_start") return `${iteration}开始`;
  if (event.type === "turn_end") {
    return `${iteration}结束${event.finishReason ? ` · ${event.finishReason}` : ""}`;
  }
  if (event.type === "agent_end") {
    return `Agent 完成${event.finishReason ? ` · ${event.finishReason}` : ""}`;
  }
  if (event.type === "agent_error") {
    return `Agent 错误 · ${event.error ?? "unknown"}`;
  }
  return event.type;
}

export function classifyAgentDesktopEvent(
  event: string,
  payload: unknown,
): AgentDesktopEventAction {
  if (event === "agent.event") {
    if (!isRecord(payload)) return { kind: "none" };
    const type = typeof payload.type === "string" ? payload.type : "";
    const sessionId =
      typeof payload.sessionId === "string" ? payload.sessionId : "";
    const delta = isRecord(payload.delta) ? payload.delta : {};
    const content = typeof delta.content === "string" ? delta.content : "";
    if (type === "model_delta" && sessionId && content) {
      return { kind: "append-output", sessionId, content };
    }
    return AGENT_REFRESH_EVENT_TYPES.has(type)
      ? { kind: "refresh", delay: 120 }
      : { kind: "none" };
  }

  if (AGENT_COMPLETION_EVENTS.has(event) && isRecord(payload)) {
    const sessionId =
      typeof payload.sessionId === "string" ? payload.sessionId : "";
    if (sessionId) return { kind: "clear-output", sessionId, refreshDelay: 0 };
  }

  if (
    AGENT_REFRESH_EVENTS.has(event) ||
    AGENT_REFRESH_PREFIXES.some((prefix) => event.startsWith(prefix))
  ) {
    return { kind: "refresh", delay: 120 };
  }

  return { kind: "none" };
}
