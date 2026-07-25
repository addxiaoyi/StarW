import * as Z from "zod";
import { zodToJsonSchema } from "./schema.js";
import {
  createBashTool,
  createEditTool,
  createGrepTool,
  createReadTool,
  createWriteTool,
} from "./secure-tools.js";

export interface ToolAuthorization {
  readonly granted: boolean;
  readonly reason?: string;
  readonly expiresAt?: number;
}

export interface McpToolSchema {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: object;
}

export type ToolRisk = "low" | "medium" | "high" | "critical";

export interface ToolApprovalRequest {
  readonly tool: string;
  readonly action: string;
  readonly risk: ToolRisk;
  readonly summary: string;
  readonly command?: string;
  readonly paths?: string[];
}

export interface ToolCommandRequest {
  readonly command: string;
  readonly cwd: string;
  readonly environment: Record<string, string>;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly signal?: AbortSignal;
  readonly sandbox?: "auto" | "docker" | "process" | "off";
  readonly networkDisabled?: boolean;
}

export interface ToolCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly backend: string;
  readonly truncated?: boolean;
}

export interface ToolMutationRecord {
  readonly tool: "write" | "edit";
  readonly path: string;
  readonly before: string | null;
  readonly after: string;
}

export interface ToolContext {
  readonly agentId: string;
  readonly agentType: string;
  readonly sessionId: string;
  readonly workingDirectory: string;
  readonly environment: Record<string, string>;
  readonly signal?: AbortSignal;
  readonly outputLimitBytes?: number;
  readonly sandbox?: "auto" | "docker" | "process" | "off";
  readonly networkDisabled?: boolean;
  readonly requestApproval?: (request: ToolApprovalRequest) => Promise<boolean>;
  readonly executeCommand?: (
    request: ToolCommandRequest,
  ) => Promise<ToolCommandResult>;
  readonly recordMutation?: (
    mutation: ToolMutationRecord,
  ) => Promise<{ changeId?: string } | void>;
}

export interface ToolResult {
  readonly content: ToolContent[];
  readonly isError?: boolean;
  readonly toolUseId?: string;
}

export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource"; resource: { uri: string; mimeType?: string } };

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Z.ZodType<unknown>;
  readonly execute: (
    input: unknown,
    context: ToolContext,
  ) => Promise<ToolResult>;
  readonly authorize?: (
    input: unknown,
    context: ToolContext,
  ) => Promise<ToolAuthorization>;
}

interface ToolEntry {
  tool: Tool;
  enabled: boolean;
  tags: string[];
}

function errorResult(message: string): ToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function truncateUtf8(value: string, maxBytes: number): string {
  const limit = Math.max(1024, Math.min(maxBytes, 4 * 1024 * 1024));
  const bytes = Buffer.from(value);
  if (bytes.byteLength <= limit) return value;
  return `${bytes.subarray(0, limit).toString("utf8")}\n[output truncated at ${limit} bytes]`;
}

function limitResult(result: ToolResult, context: ToolContext): ToolResult {
  const limit = context.outputLimitBytes ?? 128 * 1024;
  return {
    ...result,
    content: result.content.map((item) =>
      item.type === "text"
        ? { ...item, text: truncateUtf8(item.text, limit) }
        : item,
    ),
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("Tool execution was cancelled");
  error.name = "AbortError";
  throw error;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolEntry>();

  register(tool: Tool, options?: { tags?: string[]; enabled?: boolean }): void {
    this.tools.set(tool.name, {
      tool,
      enabled: options?.enabled ?? true,
      tags: options?.tags ?? [],
    });
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)?.tool;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(includeDisabled = false): Tool[] {
    return [...this.tools.values()]
      .filter((entry) => includeDisabled || entry.enabled)
      .map((entry) => entry.tool);
  }

  listByTag(tag: string): Tool[] {
    return [...this.tools.values()]
      .filter((entry) => entry.enabled && entry.tags.includes(tag))
      .map((entry) => entry.tool);
  }

  setEnabled(name: string, enabled: boolean): boolean {
    const entry = this.tools.get(name);
    if (!entry) return false;
    entry.enabled = enabled;
    return true;
  }

  remove(name: string): boolean {
    return this.tools.delete(name);
  }

  async execute(
    name: string,
    input: unknown,
    context: ToolContext,
  ): Promise<ToolResult> {
    const entry = this.tools.get(name);
    if (!entry) return errorResult(`Tool not found: ${name}`);
    if (!entry.enabled) return errorResult(`Tool disabled: ${name}`);

    try {
      throwIfAborted(context.signal);
      const parsed = await entry.tool.inputSchema.parseAsync(input);
      if (entry.tool.authorize) {
        const authorization = await entry.tool.authorize(parsed, context);
        if (!authorization.granted) {
          return errorResult(authorization.reason || "Unauthorized");
        }
      }
      const result = await entry.tool.execute(parsed, context);
      throwIfAborted(context.signal);
      return limitResult(result, context);
    } catch (error) {
      return errorResult(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  getMcpSchema(name: string): McpToolSchema | undefined {
    const tool = this.get(name);
    if (!tool) return undefined;
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.inputSchema),
    };
  }

  getOpenAiSchemas(): object[] {
    return this.list().map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.inputSchema),
      },
    }));
  }
}

export const initializeDefaultTools = (registry: ToolRegistry): void => {
  registry.register(createReadTool(), {
    tags: ["filesystem", "readonly"],
  });
  registry.register(createWriteTool(), {
    tags: ["filesystem", "mutation"],
  });
  registry.register(createEditTool(), {
    tags: ["filesystem", "mutation"],
  });
  registry.register(createBashTool(), {
    tags: ["system", "sandbox"],
  });
  registry.register(createGrepTool(), {
    tags: ["search", "readonly"],
  });
};

export {
  classifyCommandRisk,
  createBashTool,
  createEditTool,
  createGrepTool,
  createReadTool,
  createWriteTool,
  resolveWorkspacePath,
} from "./secure-tools.js";
