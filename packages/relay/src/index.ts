/**
 * OpenStar Relay Package
 *
 * Message relay and API proxy service for multi-provider communication.
 * Handles routing between agents, load balancing, and API gateway functions.
 */
import type { AgentMessage } from "@openstar/protocol";
import {
  buildProviderEndpoint,
  createProviderHttpError,
  normalizeProviderBaseUrl,
  readProviderJson,
  requireProviderApiKey,
} from "./provider-utils";

export * from "./provider-utils";

// ─── Types ───────────────────────────────────────────────────────────

export interface RelayConfig {
  port?: number;
  host?: string;
  maxConnections?: number;
  authToken?: string;
  providers?: ProviderConfig[];
}

export interface ProviderConfig {
  id: string;
  type: "openai" | "anthropic" | "kimi" | "custom";
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  timeoutMs?: number;
}

export interface ChatCompletionRequest {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    tool_calls?: unknown[];
    tool_call_id?: string;
  }>;
  temperature?: number;
  maxTokens?: number;
  tools?: Array<Record<string, unknown>>;
  signal?: AbortSignal;
}

export interface ChatCompletionDelta {
  type: "content" | "tool_call" | "finish" | "usage";
  content?: string;
  toolCall?: {
    index: number;
    id?: string;
    name?: string;
    arguments?: string;
  };
  finishReason?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ChatCompletionResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: unknown[];
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

type AnthropicContent =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== "string") {
    throw new Error(
      "Provider tool arguments must be a JSON object or JSON string",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Provider tool arguments contain invalid JSON");
  }
  if (!isRecord(parsed)) {
    throw new Error("Provider tool arguments must decode to a JSON object");
  }
  return parsed;
}

function toAnthropicToolUse(value: unknown): AnthropicContent {
  if (!isRecord(value) || !isRecord(value.function)) {
    throw new Error("Provider tool call has an invalid shape");
  }
  const id = typeof value.id === "string" ? value.id : "";
  const name =
    typeof value.function.name === "string" ? value.function.name : "";
  if (!id || !name) {
    throw new Error("Provider tool call must include id and function name");
  }
  return {
    type: "tool_use",
    id,
    name,
    input: parseToolArguments(value.function.arguments),
  };
}

function providerSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  const anySignal = (
    AbortSignal as typeof AbortSignal & {
      any?: (signals: AbortSignal[]) => AbortSignal;
    }
  ).any;
  return anySignal ? anySignal([signal, timeout]) : signal;
}

async function readSse(
  response: Response,
  onData: (data: string, eventName?: string) => void | Promise<void>,
): Promise<void> {
  if (!response.body)
    throw new Error("Provider stream did not include a response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consumeFrame = async (frame: string): Promise<void> => {
    let eventName: string | undefined;
    const data: string[] = [];
    for (const line of frame.replaceAll("\r\n", "\n").split("\n")) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (data.length) await onData(data.join("\n"), eventName);
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    buffer = buffer.replaceAll("\r\n", "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (frame.trim()) await consumeFrame(frame);
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
  if (buffer.trim()) await consumeFrame(buffer);
}

function toAnthropicTool(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const fn = value.function;
  if (!isRecord(fn) || typeof fn.name !== "string" || !fn.name) {
    throw new Error("Provider tool schema must include function.name");
  }
  return {
    name: fn.name,
    description: typeof fn.description === "string" ? fn.description : "",
    input_schema: isRecord(fn.parameters)
      ? fn.parameters
      : { type: "object", properties: {} },
  };
}

// ─── Message Relay ───────────────────────────────────────────────────

export type MessageHandler = (message: AgentMessage) => Promise<void>;

export class MessageRelay {
  private handlers = new Map<string, Set<MessageHandler>>();
  private messageLog: AgentMessage[] = [];

  subscribe(messageType: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(messageType)) {
      this.handlers.set(messageType, new Set());
    }
    this.handlers.get(messageType)!.add(handler);
    return () => this.handlers.get(messageType)?.delete(handler);
  }

  async publish(message: AgentMessage): Promise<void> {
    this.messageLog.push(message);
    const handlers = this.handlers.get(message.type);
    if (!handlers) return;
    await Promise.all(Array.from(handlers).map((handler) => handler(message)));
  }

  getRecentMessages(limit = 100): AgentMessage[] {
    return this.messageLog.slice(-limit);
  }
}

// ─── API Relay ───────────────────────────────────────────────────────

export class ApiRelay {
  private providers = new Map<string, ProviderConfig>();

  configure(configs: ProviderConfig[]): void {
    for (const config of configs) {
      const id = config.id.trim();
      if (!id) {
        throw new Error("Provider id must not be empty");
      }
      this.providers.set(id, {
        ...config,
        id,
        apiKey: requireProviderApiKey(config.apiKey),
        baseUrl: config.baseUrl
          ? normalizeProviderBaseUrl(config.baseUrl)
          : undefined,
      });
    }
  }

  getProvider(id: string): ProviderConfig | undefined {
    return this.providers.get(id);
  }

  private resolveProvider(providerId?: string): ProviderConfig {
    const provider = providerId
      ? this.providers.get(providerId)
      : (this.providers.values().next().value as ProviderConfig | undefined);
    if (!provider)
      throw new Error("No provider configured. Call configure() first.");
    return provider;
  }

  async chatCompletionStream(
    request: ChatCompletionRequest,
    providerId: string | undefined,
    onDelta: (delta: ChatCompletionDelta) => void | Promise<void>,
  ): Promise<ChatCompletionResponse> {
    const provider = this.resolveProvider(providerId);
    return provider.type === "anthropic"
      ? this.anthropicChatStream(request, provider, onDelta)
      : this.openAiChatStream(request, provider, onDelta);
  }

  private async openAiChatStream(
    request: ChatCompletionRequest,
    provider: ProviderConfig,
    onDelta: (delta: ChatCompletionDelta) => void | Promise<void>,
  ): Promise<ChatCompletionResponse> {
    const defaultBaseUrl =
      provider.type === "kimi"
        ? "https://api.moonshot.cn/v1"
        : "https://api.openai.com/v1";
    const endpoint = buildProviderEndpoint(
      provider.baseUrl,
      defaultBaseUrl,
      "chat/completions",
    );
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model || provider.defaultModel || "gpt-4o-mini",
        messages: request.messages,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 4096,
        stream: true,
        stream_options: { include_usage: true },
        ...(request.tools ? { tools: request.tools } : {}),
      }),
      signal: providerSignal(request.signal, provider.timeoutMs ?? 120000),
    });
    if (!response.ok)
      throw await createProviderHttpError(
        "OpenAI-compatible",
        response,
        provider.apiKey,
      );

    let id = "";
    let model = request.model || provider.defaultModel || "gpt-4o-mini";
    let content = "";
    let finishReason = "stop";
    let usage: ChatCompletionResponse["usage"];
    const calls = new Map<
      number,
      {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }
    >();

    await readSse(response, async (data) => {
      if (data === "[DONE]") return;
      let chunk: Record<string, unknown>;
      try {
        chunk = JSON.parse(data) as Record<string, unknown>;
      } catch {
        throw new Error("OpenAI-compatible stream returned invalid JSON");
      }
      if (typeof chunk.id === "string") id = chunk.id;
      if (typeof chunk.model === "string") model = chunk.model;
      if (isRecord(chunk.usage)) {
        usage = {
          prompt_tokens: Number(chunk.usage.prompt_tokens) || 0,
          completion_tokens: Number(chunk.usage.completion_tokens) || 0,
          total_tokens: Number(chunk.usage.total_tokens) || 0,
        };
        await onDelta({ type: "usage", usage });
      }
      const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
      const choice = isRecord(choices[0]) ? choices[0] : undefined;
      if (!choice) return;
      if (typeof choice.finish_reason === "string" && choice.finish_reason) {
        finishReason = choice.finish_reason;
        await onDelta({ type: "finish", finishReason });
      }
      const delta = isRecord(choice.delta) ? choice.delta : {};
      if (typeof delta.content === "string" && delta.content) {
        content += delta.content;
        await onDelta({ type: "content", content: delta.content });
      }
      const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
      for (const raw of toolCalls) {
        if (!isRecord(raw)) continue;
        const index = Number.isInteger(raw.index) ? Number(raw.index) : 0;
        const existing = calls.get(index) ?? {
          id: "",
          type: "function" as const,
          function: { name: "", arguments: "" },
        };
        if (typeof raw.id === "string") existing.id = raw.id;
        if (isRecord(raw.function)) {
          if (typeof raw.function.name === "string")
            existing.function.name += raw.function.name;
          if (typeof raw.function.arguments === "string")
            existing.function.arguments += raw.function.arguments;
        }
        calls.set(index, existing);
        await onDelta({
          type: "tool_call",
          toolCall: {
            index,
            id: typeof raw.id === "string" ? raw.id : undefined,
            name:
              isRecord(raw.function) && typeof raw.function.name === "string"
                ? raw.function.name
                : undefined,
            arguments:
              isRecord(raw.function) &&
              typeof raw.function.arguments === "string"
                ? raw.function.arguments
                : undefined,
          },
        });
      }
    });

    const toolCalls = [...calls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, call], index) => ({
        ...call,
        id: call.id || `call_${index + 1}`,
      }));
    return {
      id: id || `chatcmpl_${Date.now()}`,
      model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: content || null,
            ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
          },
          finish_reason:
            finishReason || (toolCalls.length ? "tool_calls" : "stop"),
        },
      ],
      usage,
    };
  }

  private async anthropicChatStream(
    request: ChatCompletionRequest,
    provider: ProviderConfig,
    onDelta: (delta: ChatCompletionDelta) => void | Promise<void>,
  ): Promise<ChatCompletionResponse> {
    const system = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const messages = request.messages
      .filter((message) => message.role !== "system")
      .map((message) => {
        if (message.role === "tool") {
          if (!message.tool_call_id)
            throw new Error("Anthropic tool result is missing tool_call_id");
          return {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: message.tool_call_id,
                content: message.content,
              },
            ],
          };
        }
        if (message.role === "assistant" && message.tool_calls?.length) {
          return {
            role: "assistant",
            content: [
              ...(message.content
                ? [{ type: "text", text: message.content }]
                : []),
              ...message.tool_calls.map(toAnthropicToolUse),
            ],
          };
        }
        return {
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.content,
        };
      });
    const endpoint = buildProviderEndpoint(
      provider.baseUrl,
      "https://api.anthropic.com/v1",
      "messages",
    );
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": provider.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:
          request.model || provider.defaultModel || "claude-3-5-sonnet-latest",
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature ?? 0.2,
        system: system || undefined,
        messages,
        stream: true,
        ...(request.tools ? { tools: request.tools.map(toAnthropicTool) } : {}),
      }),
      signal: providerSignal(request.signal, provider.timeoutMs ?? 120000),
    });
    if (!response.ok)
      throw await createProviderHttpError(
        "Anthropic",
        response,
        provider.apiKey,
      );

    let id = "";
    let model =
      request.model || provider.defaultModel || "claude-3-5-sonnet-latest";
    let finishReason = "stop";
    let promptTokens = 0;
    let completionTokens = 0;
    const blocks = new Map<
      number,
      {
        type: "text" | "tool_use";
        text: string;
        id: string;
        name: string;
        input: string;
      }
    >();

    await readSse(response, async (data) => {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(data) as Record<string, unknown>;
      } catch {
        throw new Error("Anthropic stream returned invalid JSON");
      }
      const type = typeof event.type === "string" ? event.type : "";
      if (type === "message_start" && isRecord(event.message)) {
        if (typeof event.message.id === "string") id = event.message.id;
        if (typeof event.message.model === "string")
          model = event.message.model;
        if (isRecord(event.message.usage))
          promptTokens = Number(event.message.usage.input_tokens) || 0;
      }
      if (type === "content_block_start") {
        const index = Number(event.index) || 0;
        const block = isRecord(event.content_block) ? event.content_block : {};
        if (block.type === "tool_use") {
          blocks.set(index, {
            type: "tool_use",
            text: "",
            id: typeof block.id === "string" ? block.id : "",
            name: typeof block.name === "string" ? block.name : "",
            input:
              isRecord(block.input) && Object.keys(block.input).length
                ? JSON.stringify(block.input)
                : "",
          });
        } else {
          const text = typeof block.text === "string" ? block.text : "";
          blocks.set(index, {
            type: "text",
            text,
            id: "",
            name: "",
            input: "",
          });
          if (text) await onDelta({ type: "content", content: text });
        }
      }
      if (type === "content_block_delta") {
        const index = Number(event.index) || 0;
        const block = blocks.get(index) ?? {
          type: "text" as const,
          text: "",
          id: "",
          name: "",
          input: "",
        };
        const delta = isRecord(event.delta) ? event.delta : {};
        if (delta.type === "text_delta" && typeof delta.text === "string") {
          block.text += delta.text;
          await onDelta({ type: "content", content: delta.text });
        }
        if (
          delta.type === "input_json_delta" &&
          typeof delta.partial_json === "string"
        ) {
          block.type = "tool_use";
          block.input += delta.partial_json;
          await onDelta({
            type: "tool_call",
            toolCall: { index, arguments: delta.partial_json },
          });
        }
        blocks.set(index, block);
      }
      if (type === "message_delta") {
        const delta = isRecord(event.delta) ? event.delta : {};
        if (typeof delta.stop_reason === "string" && delta.stop_reason) {
          finishReason =
            delta.stop_reason === "tool_use" ? "tool_calls" : delta.stop_reason;
          await onDelta({ type: "finish", finishReason });
        }
        if (isRecord(event.usage))
          completionTokens =
            Number(event.usage.output_tokens) || completionTokens;
      }
    });

    const content = [...blocks.entries()]
      .sort(([left], [right]) => left - right)
      .filter(([, block]) => block.type === "text")
      .map(([, block]) => block.text)
      .join("");
    const toolCalls = [...blocks.entries()]
      .sort(([left], [right]) => left - right)
      .filter(([, block]) => block.type === "tool_use")
      .map(([, block], index) => {
        let input: Record<string, unknown> = {};
        if (block.input) {
          try {
            input = JSON.parse(block.input) as Record<string, unknown>;
          } catch {
            throw new Error(
              `Anthropic tool input for ${block.name || index} is invalid JSON`,
            );
          }
        }
        return {
          id: block.id || `toolu_${index + 1}`,
          type: "function",
          function: { name: block.name, arguments: JSON.stringify(input) },
        };
      });
    const usage = {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    };
    await onDelta({ type: "usage", usage });
    return {
      id: id || `msg_${Date.now()}`,
      model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: content || null,
            ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
          },
          finish_reason:
            finishReason || (toolCalls.length ? "tool_calls" : "stop"),
        },
      ],
      usage,
    };
  }

  async chatCompletion(
    request: ChatCompletionRequest,
    providerId?: string,
  ): Promise<ChatCompletionResponse> {
    const provider = providerId
      ? this.providers.get(providerId)
      : (this.providers.values().next().value as ProviderConfig | undefined);

    if (!provider) {
      throw new Error("No provider configured. Call configure() first.");
    }

    if (provider.type === "anthropic") {
      return this.anthropicChat(request, provider);
    }

    const defaultBaseUrl =
      provider.type === "kimi"
        ? "https://api.moonshot.cn/v1"
        : "https://api.openai.com/v1";
    const endpoint = buildProviderEndpoint(
      provider.baseUrl,
      defaultBaseUrl,
      "chat/completions",
    );
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model || provider.defaultModel || "gpt-4o-mini",
        messages: request.messages,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 4096,
        ...(request.tools ? { tools: request.tools } : {}),
      }),
      signal: providerSignal(request.signal, provider.timeoutMs ?? 120000),
    });

    if (!response.ok) {
      throw await createProviderHttpError(
        "OpenAI-compatible",
        response,
        provider.apiKey,
      );
    }

    const data = await readProviderJson<ChatCompletionResponse>(
      "OpenAI-compatible",
      response,
    );
    if (!Array.isArray(data.choices) || data.choices.length === 0) {
      throw new Error("OpenAI-compatible API returned no choices");
    }
    return data;
  }

  private async anthropicChat(
    request: ChatCompletionRequest,
    provider: ProviderConfig,
  ): Promise<ChatCompletionResponse> {
    const system = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");

    const messages = request.messages
      .filter((message) => message.role !== "system")
      .map((message) => {
        if (message.role === "tool") {
          if (!message.tool_call_id) {
            throw new Error("Anthropic tool result is missing tool_call_id");
          }
          return {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: message.tool_call_id,
                content: message.content,
              },
            ],
          };
        }

        if (message.role === "assistant" && message.tool_calls?.length) {
          return {
            role: "assistant",
            content: [
              ...(message.content
                ? [{ type: "text", text: message.content }]
                : []),
              ...message.tool_calls.map(toAnthropicToolUse),
            ],
          };
        }

        return {
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.content,
        };
      });

    const endpoint = buildProviderEndpoint(
      provider.baseUrl,
      "https://api.anthropic.com/v1",
      "messages",
    );
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": provider.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:
          request.model || provider.defaultModel || "claude-3-5-sonnet-latest",
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature ?? 0.2,
        system: system || undefined,
        messages,
        ...(request.tools ? { tools: request.tools.map(toAnthropicTool) } : {}),
      }),
      signal: providerSignal(request.signal, provider.timeoutMs ?? 120000),
    });

    if (!response.ok) {
      throw await createProviderHttpError(
        "Anthropic",
        response,
        provider.apiKey,
      );
    }

    const data = await readProviderJson<{
      id: string;
      model: string;
      content: AnthropicContent[];
      stop_reason?: string;
      usage?: { input_tokens: number; output_tokens: number };
    }>("Anthropic", response);
    if (!Array.isArray(data.content)) {
      throw new Error("Anthropic API returned invalid content");
    }

    const text = data.content
      .filter(
        (item): item is Extract<AnthropicContent, { type: "text" }> =>
          item.type === "text",
      )
      .map((item) => item.text)
      .join("");
    const toolCalls = data.content
      .filter(
        (item): item is Extract<AnthropicContent, { type: "tool_use" }> =>
          item.type === "tool_use",
      )
      .map((item) => ({
        id: item.id,
        type: "function",
        function: { name: item.name, arguments: JSON.stringify(item.input) },
      }));

    return {
      id: data.id,
      model: data.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: text || null,
            ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
          },
          finish_reason:
            data.stop_reason ?? (toolCalls.length ? "tool_calls" : "stop"),
        },
      ],
      usage: data.usage
        ? {
            prompt_tokens: data.usage.input_tokens,
            completion_tokens: data.usage.output_tokens,
            total_tokens: data.usage.input_tokens + data.usage.output_tokens,
          }
        : undefined,
    };
  }
}

// ─── Exports ─────────────────────────────────────────────────────────

export interface Relay {
  messageRelay: MessageRelay;
  apiRelay: ApiRelay;
  chatCompletion: (
    request: ChatCompletionRequest,
    providerId?: string,
  ) => Promise<ChatCompletionResponse>;
  chatCompletionStream: (
    request: ChatCompletionRequest,
    providerId: string | undefined,
    onDelta: (delta: ChatCompletionDelta) => void | Promise<void>,
  ) => Promise<ChatCompletionResponse>;
}

export function createRelay(config?: RelayConfig): Relay {
  const messageRelay = new MessageRelay();
  const apiRelay = new ApiRelay();

  if (config?.providers) {
    apiRelay.configure(config.providers);
  }

  return {
    messageRelay,
    apiRelay,
    chatCompletion: (request, providerId) =>
      apiRelay.chatCompletion(request, providerId),
    chatCompletionStream: (request, providerId, onDelta) =>
      apiRelay.chatCompletionStream(request, providerId, onDelta),
  };
}
