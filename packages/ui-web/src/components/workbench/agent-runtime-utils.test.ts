import { describe, expect, it } from "vitest";
import {
  approvalRemainingSeconds,
  buildAgentTools,
  classifyAgentDesktopEvent,
  filterAgentEvents,
  parseAgentList,
  parseAgentOrchestrationPlan,
  summarizeAgentEvent,
  validateAgentName,
  visibleAgentEvents,
  type AgentRuntimeEvent,
} from "./agent-runtime-utils";

const runtimeEvent = (
  type: string,
  overrides: Partial<AgentRuntimeEvent> = {},
): AgentRuntimeEvent => ({ type, timestamp: 1, ...overrides });

describe("agent runtime utilities", () => {
  it("validates normalized custom Agent names", () => {
    expect(validateAgentName(" Review-Agent ")).toBe("");
    expect(validateAgentName("")).toBe("名称不能为空");
    expect(validateAgentName("1-review")).toMatch(/以字母开头/);
    expect(validateAgentName("a")).toMatch(/2–32/);
  });

  it("parses line and comma separated permission lists", () => {
    expect(parseAgentList("src, tests\n docs \n\n")).toEqual([
      "src",
      "tests",
      "docs",
    ]);
  });

  it("derives tools from capability flags", () => {
    expect(buildAgentTools({})).toEqual(["read", "grep", "skill:*"]);
    expect(
      buildAgentTools({ canEdit: true, canExecute: true, canUseMcp: true }),
    ).toEqual(["read", "grep", "skill:*", "write", "edit", "bash", "mcp:*"]);
  });

  it("rounds approval time upward and clamps expired requests", () => {
    expect(approvalRemainingSeconds(2501, 1000)).toBe(2);
    expect(approvalRemainingSeconds(999, 1000)).toBe(0);
  });

  it("filters runtime events and limits results from the end", () => {
    const events = [
      runtimeEvent("turn_start"),
      runtimeEvent("tool_execution_start"),
      runtimeEvent("tool_execution_end", { toolResult: { success: false } }),
      runtimeEvent("context_compacted"),
      runtimeEvent("agent_error"),
    ];
    expect(
      filterAgentEvents(events, "tool").map((event) => event.type),
    ).toEqual(["tool_execution_start", "tool_execution_end"]);
    expect(
      filterAgentEvents(events, "error").map((event) => event.type),
    ).toEqual(["tool_execution_end", "agent_error"]);
    expect(filterAgentEvents(events, "context")).toEqual([events[3]]);
    expect(visibleAgentEvents(events, "all", 2)).toEqual(events.slice(-2));
  });

  it("parses and validates orchestration plans", () => {
    expect(
      parseAgentOrchestrationPlan(
        JSON.stringify([
          {
            id: " research ",
            agent: " general ",
            prompt: " inspect ",
            dependsOn: [],
          },
          {
            id: "review",
            agent: "general",
            prompt: "review",
            dependsOn: ["research"],
          },
        ]),
      ),
    ).toEqual([
      { id: "research", agent: "general", prompt: "inspect", dependsOn: [] },
      {
        id: "review",
        agent: "general",
        prompt: "review",
        dependsOn: ["research"],
      },
    ]);
    expect(() => parseAgentOrchestrationPlan("[]")).toThrow(/非空 JSON 数组/);
    expect(() =>
      parseAgentOrchestrationPlan(
        JSON.stringify([
          { id: "same", agent: "general", prompt: "a" },
          { id: "same", agent: "general", prompt: "b" },
        ]),
      ),
    ).toThrow(/不能重复/);
    expect(() =>
      parseAgentOrchestrationPlan(
        JSON.stringify([
          {
            id: "review",
            agent: "general",
            prompt: "a",
            dependsOn: ["missing"],
          },
        ]),
      ),
    ).toThrow(/依赖不存在/);
  });

  it("summarizes common runtime event types", () => {
    expect(
      summarizeAgentEvent(
        runtimeEvent("tool_execution_end", {
          iteration: 2,
          toolCall: { id: "1", function: { name: "read", arguments: {} } },
          toolResult: { success: true },
        }),
      ),
    ).toBe("第 2 轮 · read 完成");
    expect(
      summarizeAgentEvent(
        runtimeEvent("context_compacted", {
          context: { droppedMessages: 3, estimatedTokens: 1200 },
        }),
      ),
    ).toContain("丢弃 3 条");
    expect(
      summarizeAgentEvent(runtimeEvent("agent_error", { error: "failed" })),
    ).toBe("Agent 错误 · failed");
  });

  it("classifies desktop events into state actions", () => {
    expect(
      classifyAgentDesktopEvent("agent.event", {
        type: "model_delta",
        sessionId: "session-1",
        delta: { content: "hello" },
      }),
    ).toEqual({
      kind: "append-output",
      sessionId: "session-1",
      content: "hello",
    });
    expect(
      classifyAgentDesktopEvent("agent.event", {
        type: "tool_execution_end",
      }),
    ).toEqual({ kind: "refresh", delay: 120 });
    expect(
      classifyAgentDesktopEvent("agent.completed", { sessionId: "session-1" }),
    ).toEqual({
      kind: "clear-output",
      sessionId: "session-1",
      refreshDelay: 0,
    });
    expect(classifyAgentDesktopEvent("approval.requested", {})).toEqual({
      kind: "refresh",
      delay: 120,
    });
    expect(classifyAgentDesktopEvent("unrelated", {})).toEqual({
      kind: "none",
    });
  });
});
