/**
 * OpenStar Agent Runtime
 *
 * Real agent execution harness with multi-provider support.
 * Inspired by HomeRail's Claude/Codex/Kimi adapters and Grok Build's agent runtime.
 */
import type { AgentDefinition, AgentInstance } from "@openstar/core";
import { getPersistence, type Persistence } from "@openstar/core";
import {
  buildProviderEndpoint,
  createProviderHttpError,
  normalizeProviderBaseUrl,
  readProviderJson,
  requireProviderApiKey,
} from "@openstar/relay";

// ─── Types ───────────────────────────────────────────────────────────

export type AgentProvider = "openai" | "anthropic" | "kimi" | "custom";

export interface AgentRuntimeConfig {
  provider: AgentProvider;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface AgentRunRequest {
  agentDefinition: AgentDefinition;
  task: string;
  context?: Record<string, unknown>;
  tools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  maxIterations?: number;
}

export interface AgentRunResult {
  success: boolean;
  output: string;
  toolCalls: Array<{
    tool: string;
    input: Record<string, unknown>;
    output: unknown;
    error?: string;
    durationMs: number;
  }>;
  iterations: number;
  durationMs: number;
  error?: string;
}

export interface AgentStreamEvent {
  type: "thinking" | "tool_call" | "tool_result" | "output" | "error";
  content: string;
  data?: unknown;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

// ─── Provider Implementations ────────────────────────────────────────

abstract class BaseProvider {
  protected config: AgentRuntimeConfig;

  constructor(config: AgentRuntimeConfig) {
    this.config = {
      maxTokens: 4096,
      temperature: 0.2,
      timeoutMs: 120000,
      ...config,
      apiKey: requireProviderApiKey(config.apiKey),
      baseUrl: config.baseUrl
        ? normalizeProviderBaseUrl(config.baseUrl)
        : undefined,
    };
  }

  abstract chat(
    messages: ChatMessage[],
    tools?: Array<{
      type: string;
      function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      };
    }>,
  ): Promise<{
    content: string | null;
    toolCalls: ToolCall[];
    finishReason: string;
  }>;

  getToolSchemas(
    tools: Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }>,
  ) {
    return tools.map((t) => {
      const isJsonSchema =
        typeof t.parameters.type === "string" &&
        (t.parameters.type === "object" || "properties" in t.parameters);
      return {
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: isJsonSchema
            ? t.parameters
            : { type: "object", properties: t.parameters },
        },
      };
    });
  }
}

// ── OpenAI Provider ──────────────────────────────────────────────────

export class OpenAIProvider extends BaseProvider {
  async chat(
    messages: ChatMessage[],
    tools?: Array<{
      type: string;
      function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      };
    }>,
  ) {
    const url = buildProviderEndpoint(
      this.config.baseUrl,
      "https://api.openai.com/v1",
      "chat/completions",
    );

    const body: Record<string, unknown> = {
      model: this.config.model || "gpt-4o-mini",
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      })),
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs!),
    });

    if (!response.ok) {
      throw await createProviderHttpError(
        "OpenAI-compatible",
        response,
        this.config.apiKey,
      );
    }

    const data = await readProviderJson<{
      choices?: Array<{
        message?: {
          content: string | null;
          tool_calls?: ToolCall[];
        };
        finish_reason?: string;
      }>;
    }>("OpenAI-compatible", response);

    const choice = data.choices?.[0];
    if (!choice?.message) {
      throw new Error("OpenAI-compatible API returned no choices");
    }
    return {
      content: choice.message.content,
      toolCalls: choice.message.tool_calls ?? [],
      finishReason: choice.finish_reason ?? "stop",
    };
  }
}

// ── Anthropic Provider ───────────────────────────────────────────────

export class AnthropicProvider extends BaseProvider {
  async chat(
    messages: ChatMessage[],
    tools?: Array<{
      type: string;
      function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      };
    }>,
  ) {
    const systemMessages = messages.filter((m) => m.role === "system");
    const userAssistantMessages = messages.filter((m) => m.role !== "system");

    const body: Record<string, unknown> = {
      model: this.config.model || "claude-3-5-sonnet-latest",
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      system: systemMessages.map((m) => m.content).join("\n\n") || undefined,
      messages: userAssistantMessages.map((m) => {
        if (m.role === "tool") {
          if (!m.tool_call_id) {
            throw new Error("Anthropic tool result is missing tool_call_id");
          }
          return {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: m.tool_call_id,
                content: m.content ?? "",
              },
            ],
          };
        }

        if (m.role === "assistant" && m.tool_calls?.length) {
          return {
            role: "assistant",
            content: [
              ...(m.content ? [{ type: "text", text: m.content }] : []),
              ...m.tool_calls.map((toolCall) => {
                let input: unknown;
                try {
                  input = JSON.parse(toolCall.function.arguments);
                } catch {
                  throw new Error(
                    "Anthropic tool arguments contain invalid JSON",
                  );
                }
                if (
                  !input ||
                  typeof input !== "object" ||
                  Array.isArray(input)
                ) {
                  throw new Error(
                    "Anthropic tool arguments must decode to a JSON object",
                  );
                }
                return {
                  type: "tool_use",
                  id: toolCall.id,
                  name: toolCall.function.name,
                  input,
                };
              }),
            ],
          };
        }

        return {
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content ?? "",
        };
      }),
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

    const response = await fetch(
      buildProviderEndpoint(
        this.config.baseUrl,
        "https://api.anthropic.com/v1",
        "messages",
      ),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs!),
      },
    );

    if (!response.ok) {
      throw await createProviderHttpError(
        "Anthropic",
        response,
        this.config.apiKey,
      );
    }

    const data = await readProviderJson<{
      content?: Array<
        | { type: "text"; text: string }
        | {
            type: "tool_use";
            id: string;
            name: string;
            input: Record<string, unknown>;
          }
      >;
      stop_reason?: string;
    }>("Anthropic", response);
    if (!Array.isArray(data.content)) {
      throw new Error("Anthropic API returned invalid content");
    }

    const textContent = data.content
      .filter(
        (content): content is { type: "text"; text: string } =>
          content.type === "text",
      )
      .map((content) => content.text)
      .join("");
    const toolUses = data.content.filter(
      (c) => c.type === "tool_use",
    ) as Array<{
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }>;

    return {
      content: textContent || null,
      toolCalls: toolUses.map((tu) => ({
        id: tu.id,
        type: "function" as const,
        function: { name: tu.name, arguments: JSON.stringify(tu.input) },
      })),
      finishReason:
        data.stop_reason ?? (toolUses.length > 0 ? "tool_use" : "stop"),
    };
  }
}

// ─── Agent Runtime ───────────────────────────────────────────────────

export type ToolExecutor = (
  toolName: string,
  input: Record<string, unknown>,
) => Promise<{
  success: boolean;
  output: unknown;
  error?: string;
}>;

export class AgentRuntime {
  private providers = new Map<AgentProvider, BaseProvider>();
  private toolExecutor: ToolExecutor | null = null;
  private persistence: Persistence | null = null;
  private persistenceLoaded = false;

  private ensurePersistence(): Persistence | null {
    if (!this.persistenceLoaded) {
      this.persistenceLoaded = true;
      try {
        this.persistence = getPersistence();
      } catch {
        // Persistence is optional for agent execution
        this.persistence = null;
      }
    }
    return this.persistence;
  }

  configureProvider(provider: AgentProvider, config: AgentRuntimeConfig): void {
    switch (provider) {
      case "openai":
        this.providers.set(provider, new OpenAIProvider(config));
        break;
      case "anthropic":
        this.providers.set(provider, new AnthropicProvider(config));
        break;
      case "kimi":
        // Kimi uses OpenAI-compatible API
        this.providers.set(
          provider,
          new OpenAIProvider({
            ...config,
            baseUrl: config.baseUrl || "https://api.moonshot.cn/v1",
          }),
        );
        break;
      case "custom":
        this.providers.set(provider, new OpenAIProvider(config));
        break;
    }
  }

  setToolExecutor(executor: ToolExecutor): void {
    this.toolExecutor = executor;
  }

  /** Whether at least one provider has been configured. */
  isConfigured(): boolean {
    return this.providers.size > 0;
  }

  async run(
    request: AgentRunRequest,
    emitEvent: (event: AgentStreamEvent) => void = () => {},
  ): Promise<AgentRunResult> {
    const startTime = Date.now();
    const model = request.agentDefinition.model?.toLowerCase() ?? "";
    const preferred: AgentProvider = model.startsWith("claude")
      ? "anthropic"
      : model.includes("kimi") || model.includes("moonshot")
        ? "kimi"
        : "openai";
    const selected = this.providers.has(preferred)
      ? ([preferred, this.providers.get(preferred)!] as const)
      : this.providers.entries().next().value;

    if (!selected) {
      const result: AgentRunResult = {
        success: false,
        output: "",
        toolCalls: [],
        iterations: 0,
        durationMs: Date.now() - startTime,
        error: "No provider configured. Call configureProvider() first.",
      };
      emitEvent({ type: "error", content: result.error!, data: result });
      return result;
    }

    const [providerKey, provider] = selected;
    const maxIterations = Math.max(
      1,
      Math.min(request.maxIterations ?? 10, 100),
    );
    const tools = request.agentDefinition.capabilities
      .filter((c) => c.name !== "chat")
      .map((c) => ({
        name: c.name,
        description: c.description,
        parameters: {},
      }));

    const allTools = [...tools, ...(request.tools ?? [])];
    const toolSchemas =
      allTools.length > 0 ? provider.getToolSchemas(allTools) : undefined;

    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          request.agentDefinition.systemPrompt ||
          `You are ${request.agentDefinition.name}. ${request.agentDefinition.description}`,
      },
      {
        role: "user",
        content: request.task,
      },
    ];

    const toolCalls: AgentRunResult["toolCalls"] = [];
    let completedIterations = 0;

    try {
      for (let iteration = 0; iteration < maxIterations; iteration++) {
        completedIterations = iteration + 1;
        emitEvent({
          type: "thinking",
          content: `Running agent iteration ${iteration + 1} of ${maxIterations}`,
          data: { iteration: iteration + 1, provider: providerKey },
        });
        const response = await provider.chat(messages, toolSchemas);

        if (response.toolCalls.length === 0) {
          const result: AgentRunResult = {
            success: true,
            output: response.content ?? "",
            toolCalls,
            iterations: iteration + 1,
            durationMs: Date.now() - startTime,
          };
          emitEvent({ type: "output", content: result.output, data: result });
          return result;
        }
        // Process tool calls
        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: response.content,
          tool_calls: response.toolCalls,
        };
        messages.push(assistantMsg);

        for (const toolCall of response.toolCalls) {
          const toolStart = Date.now();
          let input: Record<string, unknown> = {};
          let parseError: string | undefined;

          try {
            const parsed = JSON.parse(toolCall.function.arguments);
            if (
              parsed &&
              typeof parsed === "object" &&
              !Array.isArray(parsed)
            ) {
              input = parsed as Record<string, unknown>;
            } else {
              parseError = "Tool arguments must be a JSON object";
            }
          } catch (error) {
            parseError = `Invalid tool arguments: ${error instanceof Error ? error.message : String(error)}`;
          }

          emitEvent({
            type: "tool_call",
            content: `Calling tool ${toolCall.function.name}`,
            data: { id: toolCall.id, tool: toolCall.function.name, input },
          });

          let toolResult: { success: boolean; output: unknown; error?: string };
          if (parseError) {
            toolResult = { success: false, output: null, error: parseError };
          } else if (this.toolExecutor) {
            try {
              toolResult = await this.toolExecutor(
                toolCall.function.name,
                input,
              );
            } catch (error) {
              toolResult = {
                success: false,
                output: null,
                error: error instanceof Error ? error.message : String(error),
              };
            }
          } else {
            toolResult = {
              success: false,
              output: null,
              error: "No tool executor configured",
            };
          }

          const recordedCall = {
            tool: toolCall.function.name,
            input,
            output: toolResult.output,
            error: toolResult.error,
            durationMs: Date.now() - toolStart,
          };
          toolCalls.push(recordedCall);
          emitEvent({
            type: "tool_result",
            content: toolResult.success
              ? `Tool ${toolCall.function.name} completed`
              : `Tool ${toolCall.function.name} failed: ${toolResult.error ?? "unknown error"}`,
            data: recordedCall,
          });

          messages.push({
            role: "tool",
            content: JSON.stringify(toolResult.output ?? toolResult.error),
            tool_call_id: toolCall.id,
          });
        }
      }

      const result: AgentRunResult = {
        success: false,
        output: "Max iterations reached",
        toolCalls,
        iterations: maxIterations,
        durationMs: Date.now() - startTime,
        error: "Exceeded maximum iterations",
      };
      emitEvent({ type: "error", content: result.error!, data: result });
      return result;
    } catch (error) {
      const result: AgentRunResult = {
        success: false,
        output: "",
        toolCalls,
        iterations: completedIterations,
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
      emitEvent({ type: "error", content: result.error!, data: result });
      return result;
    }
  }

  /**
   * Streams lifecycle events as provider iterations and tool calls complete.
   * Provider token streaming can be added independently without changing this contract.
   */
  async *runStreaming(
    request: AgentRunRequest,
  ): AsyncGenerator<AgentStreamEvent> {
    const queue: AgentStreamEvent[] = [];
    let finished = false;
    let wake: (() => void) | undefined;

    const execution = this.run(request, (event) => {
      queue.push(event);
      wake?.();
      wake = undefined;
    }).finally(() => {
      finished = true;
      wake?.();
      wake = undefined;
    });

    while (!finished || queue.length > 0) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
          if (finished || queue.length > 0) {
            wake = undefined;
            resolve();
          }
        });
      }

      while (queue.length > 0) {
        yield queue.shift()!;
      }
    }

    await execution;
  }
}

// ─── Singleton ───────────────────────────────────────────────────────

let defaultRuntime: AgentRuntime | null = null;

export function getAgentRuntime(): AgentRuntime {
  if (!defaultRuntime) {
    defaultRuntime = new AgentRuntime();
  }
  return defaultRuntime;
}

export function initAgentRuntime(
  configs?: Array<{ provider: AgentProvider; config: AgentRuntimeConfig }>,
): AgentRuntime {
  defaultRuntime = new AgentRuntime();
  if (configs) {
    for (const { provider, config } of configs) {
      defaultRuntime.configureProvider(provider, config);
    }
  }
  return defaultRuntime;
}
