import type { ToolDefinition, ToolContext, ToolResult, RegisteredTool, ToolExecutor } from "./types";

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register<TInput = Record<string, unknown>, TOutput = unknown>(
    definition: ToolDefinition,
    execute: ToolExecutor<TInput, TOutput>,
  ): void {
    this.tools.set(definition.name, { definition, execute: execute as ToolExecutor });
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  async execute(
    name: string,
    input: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, output: null, error: `Tool ${name} not found` };
    }

    try {
      return await tool.execute(input, context);
    } catch (err) {
      return {
        success: false,
        output: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

let defaultRegistry: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new ToolRegistry();
  }
  return defaultRegistry;
}

export function resetToolRegistry(): ToolRegistry {
  defaultRegistry = new ToolRegistry();
  return defaultRegistry;
}
