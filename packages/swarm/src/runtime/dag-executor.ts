/**
 * OpenStar DAG Executor
 *
 * Bridges the DAG workflow engine to the real Agent Runtime.
 * - When a provider is configured, each node runs as a real agent (LLM + tools).
 * - Offline (no provider), nodes run in a deterministic local mode so workflows
 *   remain demonstrable end-to-end without network access.
 */
import type { AgentDefinition } from "@openstar/core";
import { AgentRuntime, type AgentProvider } from "./agent";
import { loadConfig } from "@openstar/core";
import { createBuiltinToolExecutor } from "./tools";
import {
  DagEngine,
  type DagDefinition,
  type DagNodeDef,
  type DagNodeStatus,
} from "../dag/engine";

// ─── Types ───────────────────────────────────────────────────────────

export interface DagExecutorOptions {
  runtime?: AgentRuntime;
  workdir?: string;
  onEvent?: (event: DagExecutionEvent) => void;
}

export type DagExecutionEvent =
  | { type: "run:start"; patternId: string; message: string; timestamp: number }
  | { type: "node:start"; nodeId: string; label: string; timestamp: number }
  | { type: "node:complete"; nodeId: string; label: string; output: unknown; timestamp: number }
  | { type: "node:error"; nodeId: string; label: string; error: string; timestamp: number }
  | { type: "run:complete"; patternId: string; success: boolean; durationMs: number; timestamp: number }
  | { type: "run:error"; patternId: string; error: string; timestamp: number };

type DagExecutionEventInput<T> = T extends unknown ? Omit<T, "timestamp"> : never;

export interface DagNodeResult {
  success: boolean;
  output?: unknown;
  error?: string;
}

export interface DagRunResult {
  success: boolean;
  patternId: string;
  runId: string;
  mode: "real" | "local";
  nodeResults: Record<string, DagNodeResult>;
  outputs: Record<string, unknown>;
  durationMs: number;
}

// ─── DAG Executor ────────────────────────────────────────────────────

export class DagExecutor {
  private runtime: AgentRuntime;
  private workdir: string;
  private listeners: Array<(e: DagExecutionEvent) => void> = [];

  constructor(opts: DagExecutorOptions = {}) {
    this.runtime = opts.runtime ?? new AgentRuntime();
    this.workdir = opts.workdir ?? process.cwd();
    this.runtime.setToolExecutor(createBuiltinToolExecutor(this.workdir));
    if (opts.onEvent) this.listeners.push(opts.onEvent);
  }

  onEvent(fn: (e: DagExecutionEvent) => void): this {
    this.listeners.push(fn);
    return this;
  }

  private emit(event: DagExecutionEventInput<DagExecutionEvent>): void {
    const full = { ...event, timestamp: Date.now() } as DagExecutionEvent;
    for (const l of this.listeners) l(full);
  }

  private buildAgentDefinition(node: DagNodeDef): AgentDefinition {
    const agentId = node.agentId ?? "coordinator";
    const type =
      agentId === "worker"
        ? "worker"
        : agentId === "specialist"
        ? "specialist"
        : agentId === "subagent"
        ? "subagent"
        : "primary";
    return {
      id: agentId,
      name: node.label,
      type,
      description: node.description ?? node.label,
      systemPrompt:
        node.systemPrompt ??
        `You are ${node.label}, a node in a multi-agent workflow. Use the available tools to accomplish the task based on the provided inputs.`,
      model: node.model ?? "gpt-4o-mini",
      capabilities: [
        { name: "run_command", description: "Execute shell commands", version: "1.0.0", tags: ["shell"] },
        { name: "read_file", description: "Read a file", version: "1.0.0", tags: ["fs"] },
        { name: "write_file", description: "Write a file", version: "1.0.0", tags: ["fs"] },
      ],
      skills: [],
      mcpServers: [],
      maxConcurrentTasks: 1,
      timeoutMs: 300000,
    };
  }

  private realNodeExecutor() {
    return async (
      node: DagNodeDef,
      inputs: Record<string, unknown>,
      _ctx: { runId: string; workspace: string }
    ) => {
      const def = this.buildAgentDefinition(node);
      const task =
        `${node.description ?? node.label}\n\n` +
        `Available upstream evidence/inputs:\n${JSON.stringify(inputs, null, 2)}`;
      const result = await this.runtime.run({ agentDefinition: def, task, context: { inputs } });
      if (!result.success) {
        throw new Error(result.error ?? "Agent run failed");
      }
      return {
        outputs: { result: result.output, toolCalls: result.toolCalls, iterations: result.iterations },
        evidence: [{ type: "agent_run", payload: { nodeId: node.id, iterations: result.iterations } }],
      };
    };
  }

  private localNodeExecutor() {
    return async (
      node: DagNodeDef,
      inputs: Record<string, unknown>,
      _ctx: { runId: string; workspace: string }
    ) => {
      const keys = Object.keys(inputs);
      const summary =
        `[${node.label}] received ${keys.length} upstream input(s): ` +
        `${keys.length ? keys.join(", ") : "none"}. ` +
        `Task: ${node.description ?? node.label}.`;
      return {
        outputs: { result: summary, simulated: true },
        evidence: [{ type: "local_exec", payload: { nodeId: node.id, label: node.label } }],
      };
    };
  }

  private onNodeProgress(
    nodeId: string,
    dag: DagDefinition,
    status: DagNodeStatus,
    outputs?: Record<string, unknown>
  ): void {
    const node = dag.nodes.find((n) => n.id === nodeId);
    const label = node?.label ?? nodeId;
    if (status === "running") this.emit({ type: "node:start", nodeId, label });
    else if (status === "completed") this.emit({ type: "node:complete", nodeId, label, output: outputs });
    else if (status === "failed") this.emit({ type: "node:error", nodeId, label, error: "node failed" });
  }

  /** Run a built-in DAG pattern by id. */
  async runPattern(patternId: string, input?: Record<string, unknown>): Promise<DagRunResult> {
    const engine = new DagEngine();
    const dag = engine.fromPattern(patternId);
    if (!dag) throw new Error(`Unknown DAG pattern: ${patternId}`);

    const mode: "real" | "local" = this.runtime.isConfigured() ? "real" : "local";
    engine.setNodeExecutor(mode === "real" ? this.realNodeExecutor() : this.localNodeExecutor());

    const roots = dag.nodes.filter((n) => !dag.edges.some((e) => e.target === n.id));
    const initialInputs: Record<string, Record<string, unknown>> = {};
    for (const r of roots) initialInputs[r.id] = input ?? {};

    const start = Date.now();
    this.emit({ type: "run:start", patternId, message: `Running DAG pattern ${patternId} (${mode} mode)` });

    try {
      const runState = await engine.execute(dag, initialInputs, {
        workspace: this.workdir,
        onNodeProgress: (id, status, out) => this.onNodeProgress(id, dag, status, out),
      });

      const nodeResults: Record<string, DagNodeResult> = {};
      const outputs: Record<string, unknown> = {};
      for (const [id, st] of runState.nodes) {
        nodeResults[id] = { success: st.status === "completed", output: st.outputs, error: st.error ?? undefined };
        outputs[id] = st.outputs;
      }

      const success = runState.status === "completed";
      this.emit({ type: "run:complete", patternId, success, durationMs: Date.now() - start });

      return {
        success,
        patternId,
        runId: runState.runId,
        mode,
        nodeResults,
        outputs,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.emit({ type: "run:error", patternId, error });
      throw err;
    }
  }
}

// ─── Provider factory ────────────────────────────────────────────────

/**
 * Build an Agent Runtime configured from OpenStar core config.
 * Any provider with a real apiKey is wired up; otherwise the runtime stays in
 * local mode and DAGs run offline.
 */
export function createRuntimeFromConfig(configPath?: string): AgentRuntime {
  const runtime = new AgentRuntime();
  runtime.setToolExecutor(createBuiltinToolExecutor(process.cwd()));

  try {
    const config = loadConfig(configPath);
    const providers = (config.providers ?? {}) as Record<
      string,
      { apiKey?: string; baseUrl?: string; model?: string }
    >;
    const mapping: Record<string, AgentProvider> = {
      openai: "openai",
      anthropic: "anthropic",
      kimi: "kimi",
    };
    for (const [key, provider] of Object.entries(mapping)) {
      const pc = providers[key];
      if (pc?.apiKey) {
        runtime.configureProvider(provider, {
          provider,
          apiKey: pc.apiKey,
          baseUrl: pc.baseUrl,
          model: pc.model,
        });
      }
    }
  } catch {
    // No config / no providers — runtime remains in local mode.
  }

  return runtime;
}
