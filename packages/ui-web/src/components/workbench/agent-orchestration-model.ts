import type { AgentOrchestrationStep } from "./agent-runtime-utils";

export interface AgentOrchestrationResult {
  stepId: string;
  taskId: string;
  sessionId?: string;
  status: string;
  result?: unknown;
  error?: string;
}

export interface AgentOrchestrationSummary {
  total: number;
  completed: number;
  failed: number;
  running: number;
  pending: number;
}

const DEFAULT_AGENT_ORCHESTRATION_STEPS: AgentOrchestrationStep[] = [
  {
    id: "research",
    agent: "general",
    prompt: "分析任务并给出实施要点",
    dependsOn: [],
  },
  {
    id: "review",
    agent: "general",
    prompt: "审查前一步结果并指出风险",
    dependsOn: ["research"],
  },
];

const COMPLETED_STATUSES = new Set(["completed", "succeeded", "success"]);
const FAILED_STATUSES = new Set(["failed", "error", "cancelled"]);
const RUNNING_STATUSES = new Set(["running", "in_progress", "started"]);

export function createDefaultAgentOrchestrationPlan(): string {
  return JSON.stringify(DEFAULT_AGENT_ORCHESTRATION_STEPS, null, 2);
}

export function summarizeAgentOrchestrationResults(
  results: AgentOrchestrationResult[],
): AgentOrchestrationSummary {
  const summary: AgentOrchestrationSummary = {
    total: results.length,
    completed: 0,
    failed: 0,
    running: 0,
    pending: 0,
  };

  for (const result of results) {
    const status = result.status.trim().toLowerCase();
    if (COMPLETED_STATUSES.has(status)) summary.completed += 1;
    else if (FAILED_STATUSES.has(status)) summary.failed += 1;
    else if (RUNNING_STATUSES.has(status)) summary.running += 1;
    else summary.pending += 1;
  }

  return summary;
}
