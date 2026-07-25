import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDefinition } from "@openstar/core";
import {
  AgentRuntime,
  AnthropicProvider,
  OpenAIProvider,
  initAgentRuntime,
  type AgentStreamEvent,
} from "../runtime/agent";

function makeAgent(): AgentDefinition {
  return {
    id: "test-agent",
    name: "Test Agent",
    type: "specialist",
    description: "A test agent",
    capabilities: [],
    skills: [],
    mcpServers: [],
    maxConcurrentTasks: 1,
    timeoutMs: 30000,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("AgentRuntime", () => {
  let runtime: AgentRuntime;

  beforeEach(() => {
    runtime = new AgentRuntime();
  });

  it("should configure a provider", () => {
    runtime.configureProvider("openai", {
      provider: "openai",
      apiKey: "test-key",
    });
    expect(runtime.isConfigured()).toBe(true);
  });

  it("should reject empty keys and unsafe provider URLs", () => {
    expect(() =>
      runtime.configureProvider("openai", {
        provider: "openai",
        apiKey: "   ",
      }),
    ).toThrow("API key");

    expect(() =>
      runtime.configureProvider("custom", {
        provider: "custom",
        apiKey: "key",
        baseUrl: "https://user:password@example.test/v1",
      }),
    ).toThrow("credentials");

    expect(() =>
      runtime.configureProvider("custom", {
        provider: "custom",
        apiKey: "key",
        baseUrl: "file:///tmp/provider",
      }),
    ).toThrow("HTTP or HTTPS");
  });

  it("should return error when no provider configured", async () => {
    const result = await runtime.run({
      agentDefinition: makeAgent(),
      task: "Do something",
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("No provider configured");
  });

  it("should have a tool executor setter", () => {
    runtime.setToolExecutor(async (name) => {
      return { success: true, output: `executed ${name}` };
    });
    expect(runtime.isConfigured()).toBe(false);
  });

  it("should support custom provider type", () => {
    runtime.configureProvider("custom", {
      provider: "custom",
      apiKey: "test",
      baseUrl: "https://example.com/v1",
    });
    expect(runtime.isConfigured()).toBe(true);
  });

  it("should report the real iteration when the provider fails", async () => {
    const apiKey = "sk-runtime-secret";
    runtime.configureProvider("openai", {
      provider: "openai",
      apiKey,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(`Authorization: Bearer ${apiKey}`, {
          status: 401,
          headers: { "x-request-id": "req-runtime-1" },
        }),
      ),
    );

    const result = await runtime.run({
      agentDefinition: makeAgent(),
      task: "fail once",
    });

    expect(result).toMatchObject({
      success: false,
      iterations: 1,
    });
    expect(result.error).toContain("401");
    expect(result.error).toContain("req-runtime-1");
    expect(result.error).toContain("[REDACTED]");
    expect(result.error).not.toContain(apiKey);
  });
});

describe("initAgentRuntime", () => {
  it("should initialize with multiple providers", () => {
    const runtime = initAgentRuntime([
      { provider: "openai", config: { provider: "openai", apiKey: "key1" } },
      {
        provider: "anthropic",
        config: { provider: "anthropic", apiKey: "key2" },
      },
    ]);
    expect(runtime.isConfigured()).toBe(true);
  });
});

describe("OpenAIProvider", () => {
  it("should build a property-map tool schema", () => {
    const provider = new OpenAIProvider({ provider: "openai", apiKey: "test" });
    const schema = provider.getToolSchemas([
      {
        name: "tool_a",
        description: "Does A",
        parameters: { param1: { type: "string" } },
      },
    ]);
    expect(schema).toHaveLength(1);
    expect(schema[0].function).toMatchObject({
      name: "tool_a",
      parameters: {
        type: "object",
        properties: { param1: { type: "string" } },
      },
    });
  });

  it("should preserve a complete JSON Schema", () => {
    const provider = new OpenAIProvider({ provider: "openai", apiKey: "test" });
    const parameters = {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
      additionalProperties: false,
    };
    const schema = provider.getToolSchemas([
      { name: "lookup", description: "Lookup a record", parameters },
    ]);
    expect(schema[0].function.parameters).toEqual(parameters);
  });

  it("should use the normalized custom provider endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: "done", tool_calls: [] },
              finish_reason: "stop",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAIProvider({
      provider: "custom",
      apiKey: "test-key",
      baseUrl: "https://provider.example.test/proxy/v1/",
    });
    await provider.chat([{ role: "user", content: "hello" }]);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://provider.example.test/proxy/v1/chat/completions");
    expect(init.headers).toMatchObject({ Authorization: "Bearer test-key" });
  });

  it("should reject empty and invalid upstream responses", async () => {
    const provider = new OpenAIProvider({
      provider: "openai",
      apiKey: "test-key",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await expect(
      provider.chat([{ role: "user", content: "hello" }]),
    ).rejects.toThrow("no choices");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await expect(
      provider.chat([{ role: "user", content: "hello" }]),
    ).rejects.toThrow("invalid JSON");
  });

  it("streams a lifecycle event before the provider response resolves", async () => {
    const runtime = new AgentRuntime();
    runtime.configureProvider("openai", {
      provider: "openai",
      apiKey: "test-key",
    });
    let releaseResponse!: (value: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => {
      releaseResponse = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => pendingResponse),
    );

    const iterator = runtime.runStreaming({
      agentDefinition: {
        ...makeAgent(),
        id: "stream-agent",
        name: "Stream Agent",
        description: "Streams lifecycle events",
      },
      task: "respond",
    });

    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({
      type: "thinking",
      data: { iteration: 1, provider: "openai" },
    });

    releaseResponse(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: "done", tool_calls: [] },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const second = await iterator.next();
    expect(second.value).toMatchObject({ type: "output", content: "done" });
    expect((await iterator.next()).done).toBe(true);
  });

  it("streams tool lifecycle events in execution order", async () => {
    const runtime = new AgentRuntime();
    runtime.configureProvider("openai", {
      provider: "openai",
      apiKey: "test-key",
    });
    runtime.setToolExecutor(async (tool, input) => ({
      success: true,
      output: { tool, input, ok: true },
    }));

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "call-1",
                      type: "function",
                      function: {
                        name: "echo",
                        arguments: JSON.stringify({ value: "hello" }),
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: { content: "complete", tool_calls: [] },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const events: AgentStreamEvent[] = [];
    for await (const event of runtime.runStreaming({
      agentDefinition: {
        ...makeAgent(),
        id: "tool-stream-agent",
        name: "Tool Stream Agent",
        description: "Streams tool execution",
      },
      task: "use a tool",
      tools: [
        {
          name: "echo",
          description: "Echo input",
          parameters: { type: "object" },
        },
      ],
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "thinking",
      "tool_call",
      "tool_result",
      "thinking",
      "output",
    ]);
    expect(events[1]).toMatchObject({
      type: "tool_call",
      data: { tool: "echo", input: { value: "hello" } },
    });
    expect(events[2]).toMatchObject({
      type: "tool_result",
      data: {
        tool: "echo",
        output: { tool: "echo", input: { value: "hello" }, ok: true },
      },
    });
    expect(events.at(-1)).toMatchObject({
      type: "output",
      content: "complete",
    });
  });
});

describe("AnthropicProvider", () => {
  it("should use the custom endpoint and convert tool messages", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [
            { type: "text", text: "checking" },
            { type: "text", text: " complete" },
            {
              type: "tool_use",
              id: "call-2",
              name: "lookup",
              input: { id: 7 },
            },
          ],
          stop_reason: "tool_use",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new AnthropicProvider({
      provider: "anthropic",
      apiKey: "anthropic-key",
      baseUrl: "https://anthropic-gateway.example.test/api/v1/",
    });
    const response = await provider.chat(
      [
        { role: "system", content: "system prompt" },
        {
          role: "assistant",
          content: "calling",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "lookup",
                arguments: JSON.stringify({ id: 3 }),
              },
            },
          ],
        },
        { role: "tool", content: "result", tool_call_id: "call-1" },
      ],
      [
        {
          type: "function",
          function: {
            name: "lookup",
            description: "Look up a record",
            parameters: {
              type: "object",
              properties: { id: { type: "number" } },
              required: ["id"],
            },
          },
        },
      ],
    );

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(init.body)) as {
      system: string;
      messages: Array<{ role: string; content: unknown }>;
      tools: Array<{ name: string; input_schema: Record<string, unknown> }>;
    };
    expect(url).toBe("https://anthropic-gateway.example.test/api/v1/messages");
    expect(body.system).toBe("system prompt");
    expect(body.messages).toEqual([
      {
        role: "assistant",
        content: [
          { type: "text", text: "calling" },
          { type: "tool_use", id: "call-1", name: "lookup", input: { id: 3 } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "call-1", content: "result" },
        ],
      },
    ]);
    expect(body.tools[0]).toMatchObject({
      name: "lookup",
      input_schema: { type: "object", required: ["id"] },
    });
    expect(response).toEqual({
      content: "checking complete",
      toolCalls: [
        {
          id: "call-2",
          type: "function",
          function: { name: "lookup", arguments: JSON.stringify({ id: 7 }) },
        },
      ],
      finishReason: "tool_use",
    });
  });

  it("should reject invalid tool arguments before sending", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new AnthropicProvider({
      provider: "anthropic",
      apiKey: "anthropic-key",
    });

    await expect(
      provider.chat([
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "lookup", arguments: "not-json" },
            },
          ],
        },
      ]),
    ).rejects.toThrow("invalid JSON");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
