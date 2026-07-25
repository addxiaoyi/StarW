import { describe, expect, it, vi } from "vitest";
import {
  AgentRunAbortedError,
  EmbeddedAgentRuntime,
  compactAgentMessages,
  type AgentRuntimeEvent,
} from "../system/agent-runtime.js";

const toolCall = {
  id: "call-1",
  type: "function" as const,
  function: { name: "read", arguments: JSON.stringify({ path: "README.md" }) },
};

describe("EmbeddedAgentRuntime", () => {
  it("feeds tool results back into the model until a final answer", async () => {
    const events: AgentRuntimeEvent[] = [];
    const callModel = vi
      .fn()
      .mockResolvedValueOnce({
        content: "",
        toolCalls: [toolCall],
        finishReason: "tool_calls",
      })
      .mockResolvedValueOnce({
        content: "README inspected",
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
      });
    const executeTool = vi.fn().mockResolvedValue({
      success: true,
      output: "# OpenStar",
      durationMs: 2,
    });
    const runtime = new EmbeddedAgentRuntime({
      sessionId: "session-1",
      agent: "build",
      systemPrompt: "You are a coding agent.",
      tools: [{ type: "function", function: { name: "read" } }],
      callModel,
      executeTool,
      onEvent: (event) => events.push(event),
    });

    const result = await runtime.prompt("Inspect the README");

    expect(result.content).toBe("README inspected");
    expect(result.iterations).toBe(2);
    expect(result.toolExecutions).toBe(1);
    expect(result.usage.totalTokens).toBe(14);
    expect(executeTool).toHaveBeenCalledWith(
      "read",
      { path: "README.md" },
      toolCall,
    );
    expect(callModel.mock.calls[1][0].messages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "call-1",
      content: "# OpenStar",
    });
    expect(events.map((event) => event.type)).toContain("tool_execution_end");
    expect(events.at(-1)?.type).toBe("agent_end");
  });

  it("returns malformed tool arguments to the model as a tool error", async () => {
    const callModel = vi
      .fn()
      .mockResolvedValueOnce({
        content: "",
        toolCalls: [
          {
            ...toolCall,
            function: { name: "read", arguments: "{" },
          },
        ],
      })
      .mockResolvedValueOnce({ content: "Recovered" });
    const executeTool = vi.fn();
    const runtime = new EmbeddedAgentRuntime({
      sessionId: "session-2",
      agent: "general",
      systemPrompt: "",
      tools: [],
      callModel,
      executeTool,
    });

    const result = await runtime.prompt("Continue");

    expect(result.content).toBe("Recovered");
    expect(executeTool).not.toHaveBeenCalled();
    expect(callModel.mock.calls[1][0].messages.at(-1)?.content).toContain(
      "invalid JSON",
    );
  });

  it("stops at the configured iteration limit", async () => {
    const callModel = vi
      .fn()
      .mockResolvedValue({ content: "", toolCalls: [toolCall] });
    const runtime = new EmbeddedAgentRuntime({
      sessionId: "session-3",
      agent: "build",
      systemPrompt: "",
      tools: [],
      maxIterations: 2,
      callModel,
      executeTool: async () => ({ success: true, output: "ok" }),
    });

    const result = await runtime.prompt("Loop");

    expect(result.finishReason).toBe("max_iterations");
    expect(result.iterations).toBe(2);
    expect(result.toolExecutions).toBe(2);
  });

  it("compacts old turns while retaining complete recent tool-call chunks", () => {
    const messages = [
      { role: "system" as const, content: "system" },
      ...Array.from({ length: 20 }, (_, index) => ({
        role: "user" as const,
        content: `old-${index}-${"x".repeat(900)}`,
      })),
      {
        role: "assistant" as const,
        content: "",
        tool_calls: [toolCall],
      },
      {
        role: "tool" as const,
        tool_call_id: toolCall.id,
        content: "latest tool result",
      },
    ];

    const compacted = compactAgentMessages(messages, 8_000);

    expect(compacted.stats?.droppedMessages).toBeGreaterThan(0);
    expect(
      compacted.messages.some((message) =>
        message.content.includes("Earlier conversation"),
      ),
    ).toBe(true);
    expect(compacted.messages.at(-2)?.tool_calls?.[0]?.id).toBe(toolCall.id);
    expect(compacted.messages.at(-1)?.tool_call_id).toBe(toolCall.id);
  });

  it("bounds large tool results before returning them to the model", async () => {
    const callModel = vi
      .fn()
      .mockResolvedValueOnce({ content: "", toolCalls: [toolCall] })
      .mockResolvedValueOnce({ content: "done" });
    const runtime = new EmbeddedAgentRuntime({
      sessionId: "session-large-tool",
      agent: "build",
      systemPrompt: "",
      tools: [],
      maxToolResultChars: 1_000,
      callModel,
      executeTool: async () => ({ success: true, output: "x".repeat(8_000) }),
    });

    await runtime.prompt("read");

    const toolMessage = callModel.mock.calls[1][0].messages.at(-1);
    expect(toolMessage?.content.length).toBeLessThan(1_200);
    expect(toolMessage?.content).toContain("tool result truncated");
  });

  it("emits context compaction events when the request exceeds its budget", async () => {
    const events: AgentRuntimeEvent[] = [];
    const runtime = new EmbeddedAgentRuntime({
      sessionId: "session-context",
      agent: "general",
      systemPrompt: "system",
      initialMessages: Array.from({ length: 20 }, (_, index) => ({
        role: "user" as const,
        content: `history-${index}-${"z".repeat(900)}`,
      })),
      tools: [],
      maxContextChars: 8_000,
      callModel: async () => ({ content: "done" }),
      executeTool: vi.fn(),
      onEvent: (event) => events.push(event),
    });

    const result = await runtime.prompt("continue");

    expect(result.contextCompactions).toBe(1);
    expect(
      events.find((event) => event.type === "context_compacted")?.context
        ?.droppedMessages,
    ).toBeGreaterThan(0);
  });

  it("emits model deltas without waiting for the final response", async () => {
    const events: AgentRuntimeEvent[] = [];
    const runtime = new EmbeddedAgentRuntime({
      sessionId: "session-stream",
      agent: "general",
      systemPrompt: "",
      tools: [],
      callModel: async ({ onDelta }) => {
        onDelta?.({ type: "content", content: "Hel" });
        onDelta?.({ type: "content", content: "lo" });
        return { content: "Hello" };
      },
      executeTool: vi.fn(),
      onEvent: (event) => events.push(event),
    });

    const result = await runtime.prompt("stream");

    expect(result.content).toBe("Hello");
    expect(
      events
        .filter((event) => event.type === "model_delta")
        .map((event) => event.delta?.content),
    ).toEqual(["Hel", "lo"]);
  });

  it("honors an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const runtime = new EmbeddedAgentRuntime({
      sessionId: "session-4",
      agent: "build",
      systemPrompt: "",
      tools: [],
      signal: controller.signal,
      callModel: vi.fn(),
      executeTool: vi.fn(),
    });

    await expect(runtime.prompt("Cancelled")).rejects.toBeInstanceOf(
      AgentRunAbortedError,
    );
  });
});
