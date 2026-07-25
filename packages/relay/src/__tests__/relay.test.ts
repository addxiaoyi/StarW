import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRelay, MessageRelay, createRelay } from "../index";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MessageRelay", () => {
  it("should publish and subscribe to messages", async () => {
    const relay = new MessageRelay();
    const received: string[] = [];

    relay.subscribe("task", async (message) => {
      received.push(message.payload.taskId as string);
    });

    await relay.publish({
      type: "task",
      from: "a",
      to: "b",
      payload: { taskId: "123" },
      timestamp: Date.now(),
    });

    expect(received).toContain("123");
  });

  it("should log recent messages", async () => {
    const relay = new MessageRelay();
    await relay.publish({
      type: "status",
      from: "a",
      to: "b",
      payload: {},
      timestamp: Date.now(),
    });
    expect(relay.getRecentMessages()).toHaveLength(1);
  });

  it("should unsubscribe", async () => {
    const relay = new MessageRelay();
    let count = 0;
    const unsubscribe = relay.subscribe("task", async () => {
      count += 1;
    });
    unsubscribe();
    await relay.publish({
      type: "task",
      from: "a",
      to: "b",
      payload: {},
      timestamp: Date.now(),
    });
    expect(count).toBe(0);
  });
});

describe("ApiRelay", () => {
  it("should configure providers", () => {
    const relay = new ApiRelay();
    relay.configure([{ id: "p1", type: "openai", apiKey: "key" }]);
    expect(relay.getProvider("p1")).toMatchObject({ id: "p1", apiKey: "key" });
  });

  it("should reject invalid provider credentials and URLs", () => {
    const relay = new ApiRelay();
    expect(() =>
      relay.configure([{ id: "p1", type: "openai", apiKey: "   " }]),
    ).toThrow("API key");
    expect(() =>
      relay.configure([
        {
          id: "p2",
          type: "custom",
          apiKey: "key",
          baseUrl: "https://user:password@example.test/v1",
        },
      ]),
    ).toThrow("credentials");
    expect(() =>
      relay.configure([
        {
          id: "p3",
          type: "custom",
          apiKey: "key",
          baseUrl: "file:///tmp/provider",
        },
      ]),
    ).toThrow("HTTP or HTTPS");
  });

  it("should throw for chat without provider", async () => {
    const relay = new ApiRelay();
    await expect(
      relay.chatCompletion({ model: "gpt-4o", messages: [] }),
    ).rejects.toThrow("No provider configured");
  });

  it("should throw for unknown provider", async () => {
    const relay = new ApiRelay();
    relay.configure([{ id: "p1", type: "openai", apiKey: "key" }]);
    await expect(
      relay.chatCompletion({ model: "gpt-4o", messages: [] }, "nonexistent"),
    ).rejects.toThrow("No provider configured");
  });

  it("should use the configured OpenAI-compatible base URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "response-1",
          model: "custom-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "done" },
              finish_reason: "stop",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const relay = new ApiRelay();
    relay.configure([
      {
        id: "custom",
        type: "custom",
        apiKey: "key",
        baseUrl: "https://provider.example.test/proxy/v1/",
      },
    ]);
    await relay.chatCompletion({
      model: "custom-model",
      messages: [{ role: "user", content: "hello" }],
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://provider.example.test/proxy/v1/chat/completions");
    expect(init.headers).toMatchObject({ Authorization: "Bearer key" });
  });

  it("should redact API keys from upstream errors", async () => {
    const apiKey = "sk-sensitive-provider-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(`Authorization: Bearer ${apiKey}; api_key=${apiKey}`, {
          status: 401,
          headers: { "x-request-id": "req-provider-1" },
        }),
      ),
    );

    const relay = new ApiRelay();
    relay.configure([{ id: "p1", type: "openai", apiKey }]);

    let message = "";
    try {
      await relay.chatCompletion({ model: "gpt-4o", messages: [] });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("401");
    expect(message).toContain("req-provider-1");
    expect(message).toContain("[REDACTED]");
    expect(message).not.toContain(apiKey);
  });

  it("should convert Anthropic tool messages and map tool-use responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "anthropic-response-1",
          model: "claude-test",
          stop_reason: "tool_use",
          content: [
            { type: "text", text: "checking" },
            {
              type: "tool_use",
              id: "call-2",
              name: "lookup",
              input: { id: 7 },
            },
          ],
          usage: { input_tokens: 4, output_tokens: 3 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const relay = new ApiRelay();
    relay.configure([
      {
        id: "anthropic",
        type: "anthropic",
        apiKey: "anthropic-key",
        baseUrl: "https://anthropic-gateway.example.test/api/v1/",
      },
    ]);

    const result = await relay.chatCompletion({
      model: "claude-test",
      messages: [
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
      tools: [
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
    });

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
    expect(result.choices[0].message).toMatchObject({
      content: "checking",
      tool_calls: [
        {
          id: "call-2",
          type: "function",
          function: { name: "lookup", arguments: JSON.stringify({ id: 7 }) },
        },
      ],
    });
    expect(result.usage).toEqual({
      prompt_tokens: 4,
      completion_tokens: 3,
      total_tokens: 7,
    });
  });

  it("should reconstruct OpenAI-compatible SSE content and tool calls", async () => {
    const chunks = [
      {
        id: "stream-1",
        model: "test",
        choices: [{ index: 0, delta: { content: "Hel" } }],
      },
      {
        id: "stream-1",
        model: "test",
        choices: [
          {
            index: 0,
            delta: {
              content: "lo",
              tool_calls: [
                {
                  index: 0,
                  id: "call-1",
                  function: { name: "read", arguments: '{"path":' },
                },
              ],
            },
          },
        ],
      },
      {
        id: "stream-1",
        model: "test",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '"a.txt"}' } }],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
      {
        id: "stream-1",
        model: "test",
        choices: [],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
            { status: 200, headers: { "content-type": "text/event-stream" } },
          ),
        ),
    );
    const relay = new ApiRelay();
    relay.configure([{ id: "p1", type: "openai", apiKey: "key" }]);
    const deltas: string[] = [];
    const result = await relay.chatCompletionStream(
      { model: "test", messages: [{ role: "user", content: "hi" }], tools: [] },
      "p1",
      (delta) => {
        if (delta.content) deltas.push(delta.content);
      },
    );
    expect(deltas.join("")).toBe("Hello");
    expect(result.choices[0].message).toMatchObject({
      content: "Hello",
      tool_calls: [
        {
          id: "call-1",
          function: {
            name: "read",
            arguments: JSON.stringify({ path: "a.txt" }),
          },
        },
      ],
    });
    expect(result.usage?.total_tokens).toBe(5);
  });

  it("should reconstruct Anthropic SSE text and tool input", async () => {
    const events = [
      {
        type: "message_start",
        message: {
          id: "msg-1",
          model: "claude-test",
          usage: { input_tokens: 4 },
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "done" },
      },
      {
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_use",
          id: "tool-1",
          name: "lookup",
          input: {},
        },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"id":7}' },
      },
      {
        type: "message_delta",
        delta: { stop_reason: "tool_use" },
        usage: { output_tokens: 3 },
      },
      { type: "message_stop" },
    ];
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            events
              .map(
                (event) =>
                  `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
              )
              .join(""),
            { status: 200, headers: { "content-type": "text/event-stream" } },
          ),
        ),
    );
    const relay = new ApiRelay();
    relay.configure([{ id: "anthropic", type: "anthropic", apiKey: "key" }]);
    const deltas: string[] = [];
    const result = await relay.chatCompletionStream(
      { model: "claude-test", messages: [{ role: "user", content: "hi" }] },
      "anthropic",
      (delta) => {
        if (delta.content) deltas.push(delta.content);
      },
    );
    expect(deltas.join("")).toBe("done");
    expect(result.choices[0].message).toMatchObject({
      content: "done",
      tool_calls: [
        {
          id: "tool-1",
          function: { name: "lookup", arguments: JSON.stringify({ id: 7 }) },
        },
      ],
    });
    expect(result.usage).toEqual({
      prompt_tokens: 4,
      completion_tokens: 3,
      total_tokens: 7,
    });
  });

  it("should reject empty or invalid upstream responses", async () => {
    const relay = new ApiRelay();
    relay.configure([{ id: "p1", type: "openai", apiKey: "key" }]);

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
      relay.chatCompletion({ model: "gpt-4o", messages: [] }),
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
      relay.chatCompletion({ model: "gpt-4o", messages: [] }),
    ).rejects.toThrow("invalid JSON");
  });
});

describe("createRelay", () => {
  it("should create a relay instance", () => {
    const relay = createRelay();
    expect(relay.messageRelay).toBeDefined();
    expect(relay.apiRelay).toBeDefined();
    expect(typeof relay.chatCompletion).toBe("function");
  });
});
