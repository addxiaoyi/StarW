import { describe, expect, it } from "vitest";
import { parseAgentOrchestrationPlan } from "./agent-runtime-utils";
import {
  createDefaultAgentOrchestrationPlan,
  summarizeAgentOrchestrationResults,
  type AgentOrchestrationResult,
} from "./agent-orchestration-model";

describe("Agent orchestration model", () => {
  it("creates a valid default DAG plan", () => {
    const steps = parseAgentOrchestrationPlan(
      createDefaultAgentOrchestrationPlan(),
    );

    expect(steps).toEqual([
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
    ]);
  });

  it("summarizes completed, failed, running, and pending results", () => {
    const results: AgentOrchestrationResult[] = [
      { stepId: "a", taskId: "1", status: "completed" },
      { stepId: "b", taskId: "2", status: "failed" },
      { stepId: "c", taskId: "3", status: "running" },
      { stepId: "d", taskId: "4", status: "queued" },
    ];

    expect(summarizeAgentOrchestrationResults(results)).toEqual({
      total: 4,
      completed: 1,
      failed: 1,
      running: 1,
      pending: 1,
    });
  });

  it("normalizes status aliases and casing", () => {
    const results: AgentOrchestrationResult[] = [
      { stepId: "a", taskId: "1", status: " Success " },
      { stepId: "b", taskId: "2", status: "CANCELLED" },
      { stepId: "c", taskId: "3", status: "in_progress" },
      { stepId: "d", taskId: "4", status: "unknown" },
    ];

    expect(summarizeAgentOrchestrationResults(results)).toEqual({
      total: 4,
      completed: 1,
      failed: 1,
      running: 1,
      pending: 1,
    });
  });

  it("returns zero counts for an empty result set", () => {
    expect(summarizeAgentOrchestrationResults([])).toEqual({
      total: 0,
      completed: 0,
      failed: 0,
      running: 0,
      pending: 0,
    });
  });
});
