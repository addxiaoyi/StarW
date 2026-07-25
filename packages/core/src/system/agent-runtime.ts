export type AgentMessageRole = "system" | "user" | "assistant" | "tool";

export interface AgentToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string | Record<string, unknown>;
  };
}

export interface AgentRuntimeMessage {
  role: AgentMessageRole;
  content: string;
  tool_calls?: AgentToolCall[];
  tool_call_id?: string;
}

export interface AgentModelResponse {
  id?: string;
  model?: string;
  content: string;
  toolCalls?: AgentToolCall[];
  finishReason?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface AgentModelDelta {
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
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface AgentToolExecutionResult {
  success: boolean;
  output: unknown;
  error?: string;
  durationMs?: number;
}

export type AgentRuntimeEventType =
  | "agent_start"
  | "turn_start"
  | "message_start"
  | "message_end"
  | "model_delta"
  | "context_compacted"
  | "tool_execution_start"
  | "tool_execution_end"
  | "turn_end"
  | "agent_end"
  | "agent_error";

export interface AgentContextStats {
  originalMessages: number;
  compactedMessages: number;
  originalChars: number;
  compactedChars: number;
  droppedMessages: number;
  estimatedTokens: number;
}

export interface AgentRuntimeEvent {
  type: AgentRuntimeEventType;
  sessionId: string;
  agent: string;
  timestamp: number;
  iteration?: number;
  message?: AgentRuntimeMessage;
  toolCall?: AgentToolCall;
  toolResult?: AgentToolExecutionResult;
  context?: AgentContextStats;
  delta?: AgentModelDelta;
  error?: string;
  finishReason?: string;
}

export interface AgentRuntimeOptions {
  sessionId: string;
  agent: string;
  systemPrompt: string;
  tools: Array<Record<string, unknown>>;
  maxIterations?: number;
  maxContextChars?: number;
  maxToolResultChars?: number;
  initialMessages?: AgentRuntimeMessage[];
  signal?: AbortSignal;
  callModel: (request: {
    messages: AgentRuntimeMessage[];
    tools: Array<Record<string, unknown>>;
    signal?: AbortSignal;
    onDelta?: (delta: AgentModelDelta) => void;
  }) => Promise<AgentModelResponse>;
  executeTool: (
    name: string,
    input: Record<string, unknown>,
    toolCall: AgentToolCall,
  ) => Promise<AgentToolExecutionResult>;
  onEvent?: (event: AgentRuntimeEvent) => void;
}

export interface AgentRunResult {
  sessionId: string;
  agent: string;
  content: string;
  messages: AgentRuntimeMessage[];
  iterations: number;
  toolExecutions: number;
  contextCompactions: number;
  finishReason: "stop" | "max_iterations";
  durationMs: number;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export class AgentRunAbortedError extends Error {
  constructor() {
    super("Agent run was cancelled");
    this.name = "AgentRunAbortedError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArguments(
  value: string | Record<string, unknown>,
): Record<string, unknown> {
  if (isRecord(value)) return value;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value || "{}");
  } catch {
    throw new Error("Tool arguments contain invalid JSON");
  }
  if (!isRecord(parsed))
    throw new Error("Tool arguments must decode to a JSON object");
  return parsed;
}

function truncateText(value: string, limit: number, label: string): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n[${label} truncated; ${value.length - limit} characters omitted]`;
}

function renderToolResult(
  result: AgentToolExecutionResult,
  maxChars: number,
): string {
  const rendered = result.error
    ? result.error
    : typeof result.output === "string"
      ? result.output
      : (() => {
          try {
            return JSON.stringify(result.output, null, 2);
          } catch {
            return String(result.output);
          }
        })();
  return truncateText(rendered, maxChars, "tool result");
}

function messageChars(message: AgentRuntimeMessage): number {
  return (
    message.content.length +
    (message.tool_call_id?.length ?? 0) +
    (message.tool_calls ? JSON.stringify(message.tool_calls).length : 0) +
    16
  );
}

interface MessageChunk {
  messages: AgentRuntimeMessage[];
  chars: number;
}

function conversationChunks(messages: AgentRuntimeMessage[]): MessageChunk[] {
  const chunks: MessageChunk[] = [];
  for (const message of messages) {
    if (message.role === "tool" && chunks.length > 0) {
      const previous = chunks[chunks.length - 1];
      const assistant = previous.messages.at(-1);
      if (assistant?.role === "assistant" && assistant.tool_calls?.length) {
        previous.messages.push(message);
        previous.chars += messageChars(message);
        continue;
      }
    }
    chunks.push({ messages: [message], chars: messageChars(message) });
  }
  return chunks;
}

function summaryMessage(
  messages: AgentRuntimeMessage[],
  maxChars: number,
): AgentRuntimeMessage {
  const lines: string[] = [
    "Earlier conversation was compacted to fit the model context. Preserve these facts and decisions:",
  ];
  for (const message of messages) {
    const content = message.content.replace(/\s+/g, " ").trim();
    const toolNames = message.tool_calls
      ?.map((call) => call.function.name)
      .join(", ");
    const detail = [
      content ? truncateText(content, 360, "summary item") : "",
      toolNames ? `tool calls: ${toolNames}` : "",
      message.tool_call_id ? `tool result for: ${message.tool_call_id}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    if (detail) lines.push(`- ${message.role}: ${detail}`);
    if (lines.join("\n").length >= maxChars) break;
  }
  return {
    role: "system",
    content: truncateText(lines.join("\n"), maxChars, "history summary"),
  };
}

export function compactAgentMessages(
  messages: AgentRuntimeMessage[],
  maxContextChars: number,
): { messages: AgentRuntimeMessage[]; stats?: AgentContextStats } {
  const maximum = Math.max(8_000, maxContextChars);
  const originalChars = messages.reduce(
    (sum, message) => sum + messageChars(message),
    0,
  );
  if (originalChars <= maximum) return { messages };

  const system = messages.filter((message) => message.role === "system");
  const conversation = messages.filter((message) => message.role !== "system");
  const systemChars = system.reduce(
    (sum, message) => sum + messageChars(message),
    0,
  );
  const summaryBudget = Math.max(
    1_000,
    Math.min(8_000, Math.floor(maximum * 0.18)),
  );
  let remaining = Math.max(2_000, maximum - systemChars - summaryBudget);
  const chunks = conversationChunks(conversation);
  const kept: MessageChunk[] = [];
  const dropped: MessageChunk[] = [];

  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    const chunk = chunks[index];
    if (chunk.chars <= remaining || kept.length === 0) {
      kept.unshift(chunk);
      remaining -= Math.min(chunk.chars, remaining);
    } else {
      dropped.unshift(chunk);
    }
  }
  const droppedMessages = dropped.flatMap((chunk) => chunk.messages);
  const summary = summaryMessage(droppedMessages, summaryBudget);
  const compacted = [
    ...system,
    ...(droppedMessages.length ? [summary] : []),
    ...kept.flatMap((chunk) => chunk.messages),
  ];
  const compactedChars = compacted.reduce(
    (sum, message) => sum + messageChars(message),
    0,
  );
  const stats: AgentContextStats = {
    originalMessages: messages.length,
    compactedMessages: compacted.length,
    originalChars,
    compactedChars,
    droppedMessages: droppedMessages.length,
    estimatedTokens: Math.ceil(compactedChars / 4),
  };
  return { messages: compacted, stats };
}

export class EmbeddedAgentRuntime {
  private readonly options: AgentRuntimeOptions;
  private readonly messages: AgentRuntimeMessage[];

  constructor(options: AgentRuntimeOptions) {
    this.options = options;
    this.messages = [
      ...(options.systemPrompt.trim()
        ? [{ role: "system" as const, content: options.systemPrompt.trim() }]
        : []),
      ...(options.initialMessages ?? []),
    ];
  }

  getMessages(): AgentRuntimeMessage[] {
    return this.messages.map((message) => ({
      ...message,
      tool_calls: message.tool_calls?.map((call) => ({
        ...call,
        function: { ...call.function },
      })),
    }));
  }

  private emit(
    event: Omit<AgentRuntimeEvent, "sessionId" | "agent" | "timestamp">,
  ): void {
    this.options.onEvent?.({
      ...event,
      sessionId: this.options.sessionId,
      agent: this.options.agent,
      timestamp: Date.now(),
    });
  }

  private throwIfAborted(): void {
    if (this.options.signal?.aborted) throw new AgentRunAbortedError();
  }

  async prompt(prompt: string): Promise<AgentRunResult> {
    const text = prompt.trim();
    if (!text) throw new Error("Agent prompt is required");
    const startedAt = Date.now();
    const maxIterations = Math.max(
      1,
      Math.min(this.options.maxIterations ?? 12, 64),
    );
    const maxContextChars = Math.max(
      8_000,
      this.options.maxContextChars ?? 180_000,
    );
    const maxToolResultChars = Math.max(
      1_000,
      this.options.maxToolResultChars ?? 48_000,
    );
    let iterations = 0;
    let toolExecutions = 0;
    let contextCompactions = 0;
    let finalContent = "";
    const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    this.throwIfAborted();
    this.messages.push({ role: "user", content: text });
    this.emit({ type: "agent_start" });

    try {
      for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
        this.throwIfAborted();
        iterations = iteration;
        this.emit({ type: "turn_start", iteration });
        this.emit({
          type: "message_start",
          iteration,
          message: this.messages[this.messages.length - 1],
        });

        const context = compactAgentMessages(
          this.getMessages(),
          maxContextChars,
        );
        if (context.stats) {
          contextCompactions += 1;
          this.emit({
            type: "context_compacted",
            iteration,
            context: context.stats,
          });
        }
        const response = await this.options.callModel({
          messages: context.messages,
          tools: this.options.tools,
          signal: this.options.signal,
          onDelta: (delta) =>
            this.emit({ type: "model_delta", iteration, delta }),
        });
        this.throwIfAborted();

        usage.promptTokens += response.usage?.promptTokens ?? 0;
        usage.completionTokens += response.usage?.completionTokens ?? 0;
        usage.totalTokens +=
          response.usage?.totalTokens ??
          (response.usage?.promptTokens ?? 0) +
            (response.usage?.completionTokens ?? 0);

        const toolCalls = response.toolCalls ?? [];
        const assistantMessage: AgentRuntimeMessage = {
          role: "assistant",
          content: response.content ?? "",
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        };
        this.messages.push(assistantMessage);
        this.emit({
          type: "message_end",
          iteration,
          message: assistantMessage,
        });

        if (toolCalls.length === 0) {
          finalContent = assistantMessage.content;
          this.emit({
            type: "turn_end",
            iteration,
            finishReason: response.finishReason ?? "stop",
          });
          this.emit({ type: "agent_end", iteration, finishReason: "stop" });
          return {
            sessionId: this.options.sessionId,
            agent: this.options.agent,
            content: finalContent,
            messages: this.getMessages(),
            iterations,
            toolExecutions,
            contextCompactions,
            finishReason: "stop",
            durationMs: Date.now() - startedAt,
            usage,
          };
        }

        for (const toolCall of toolCalls) {
          this.throwIfAborted();
          this.emit({ type: "tool_execution_start", iteration, toolCall });
          let result: AgentToolExecutionResult;
          try {
            result = await this.options.executeTool(
              toolCall.function.name,
              parseArguments(toolCall.function.arguments),
              toolCall,
            );
          } catch (error) {
            result = {
              success: false,
              output: null,
              error: error instanceof Error ? error.message : String(error),
            };
          }
          toolExecutions += 1;
          this.emit({
            type: "tool_execution_end",
            iteration,
            toolCall,
            toolResult: result,
          });
          this.messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: renderToolResult(result, maxToolResultChars),
          });
        }
        this.emit({ type: "turn_end", iteration, finishReason: "tool_calls" });
      }

      this.emit({
        type: "agent_end",
        iteration: iterations,
        finishReason: "max_iterations",
      });
      return {
        sessionId: this.options.sessionId,
        agent: this.options.agent,
        content: finalContent,
        messages: this.getMessages(),
        iterations,
        toolExecutions,
        contextCompactions,
        finishReason: "max_iterations",
        durationMs: Date.now() - startedAt,
        usage,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit({
        type: "agent_error",
        iteration: iterations || undefined,
        error: message,
      });
      throw error;
    }
  }
}
