/**
 * OpenStar DAG Workflow Engine
 *
 * Inspired by HomeRail's WorkflowSpec v1 and DAG runtime.
 * Provides a minimal but functional DAG-based workflow orchestration
 * with node isolation, evidence passing, and pattern library.
 */
import { z } from "zod";

// ─── Types ───────────────────────────────────────────────────────────

export const DagNodeStatus = z.enum([
  "pending", "queued", "running", "completed", "failed", "skipped", "cancelled",
]);
export type DagNodeStatus = z.infer<typeof DagNodeStatus>;

export const DagRunStatus = z.enum([
  "pending", "running", "completed", "failed", "cancelled",
]);
export type DagRunStatus = z.infer<typeof DagRunStatus>;

export const DagPort = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean", "object", "array", "file"]),
  description: z.string().optional(),
  required: z.boolean().default(false),
});
export type DagPort = z.infer<typeof DagPort>;

export const DagNodeDef = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  agentId: z.string().optional(),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  inputPorts: z.array(DagPort).default(() => []),
  outputPorts: z.array(DagPort).default(() => []),
  inputs: z.record(z.string(), z.unknown()).default(() => ({})),
  retryCount: z.number().default(1),
  timeoutMs: z.number().default(300000),
});
export type DagNodeDef = z.infer<typeof DagNodeDef>;
export type DagNodeInput = z.input<typeof DagNodeDef>;

export const DagEdge = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourcePort: z.string().optional(),
  targetPort: z.string().optional(),
  condition: z.string().optional(), // e.g., "success", "failure", "always"
});
export type DagEdge = z.infer<typeof DagEdge>;

export const DagDefinition = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  version: z.string().default("1.0"),
  nodes: z.array(DagNodeDef),
  edges: z.array(DagEdge),
  metadata: z.record(z.string(), z.unknown()).default(() => ({})),
});
export type DagDefinition = z.infer<typeof DagDefinition>;

export interface DagNodeState {
  nodeId: string;
  status: DagNodeStatus;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  error: string | null;
  retryCount: number;
  startedAt: number | null;
  completedAt: number | null;
  evidence: Array<{ type: string; payload: unknown; timestamp: number }>;
}

export interface DagRunState {
  runId: string;
  dagId: string;
  status: DagRunStatus;
  nodes: Map<string, DagNodeState>;
  startedAt: number;
  completedAt: number | null;
  workspace: string;
}

// ─── DAG Patterns ────────────────────────────────────────────────────

export interface DagPattern {
  id: string;
  name: string;
  description: string;
  category: "orchestration" | "review" | "pipeline" | "diagnosis" | "notification";
  nodes: Omit<DagNodeInput, "id">[];
  edges: Array<{ sourceLabel: string; targetLabel: string; condition?: string }>;
}

export const BUILTIN_PATTERNS: DagPattern[] = [
  {
    id: "orchestrator-workers",
    name: "Orchestrator-Workers",
    description: "A coordinator delegates to parallel workers and aggregates results.",
    category: "orchestration",
    nodes: [
      { label: "Orchestrator", description: "Plans and delegates work", agentId: "coordinator" },
      { label: "Worker-A", description: "Worker A", agentId: "worker" },
      { label: "Worker-B", description: "Worker B", agentId: "worker" },
      { label: "Aggregator", description: "Collects and summarizes results", agentId: "coordinator" },
    ],
    edges: [
      { sourceLabel: "Orchestrator", targetLabel: "Worker-A" },
      { sourceLabel: "Orchestrator", targetLabel: "Worker-B" },
      { sourceLabel: "Worker-A", targetLabel: "Aggregator" },
      { sourceLabel: "Worker-B", targetLabel: "Aggregator" },
    ],
  },
  {
    id: "double-check",
    name: "Double Check (Quorum)",
    description: "Two independent reviews produce a consensus, escalating on disagreement.",
    category: "review",
    nodes: [
      { label: "Reviewer-1", description: "First independent review", agentId: "reviewer" },
      { label: "Reviewer-2", description: "Second independent review", agentId: "reviewer" },
      { label: "Arbiter", description: "Resolves disagreements", agentId: "arbiter" },
    ],
    edges: [
      { sourceLabel: "Reviewer-1", targetLabel: "Arbiter" },
      { sourceLabel: "Reviewer-2", targetLabel: "Arbiter" },
    ],
  },
  {
    id: "pipeline",
    name: "Sequential Pipeline",
    description: "Nodes execute in strict sequence, each receiving the previous output.",
    category: "pipeline",
    nodes: [
      { label: "Stage-1", description: "First stage" },
      { label: "Stage-2", description: "Second stage" },
      { label: "Stage-3", description: "Third stage" },
    ],
    edges: [
      { sourceLabel: "Stage-1", targetLabel: "Stage-2" },
      { sourceLabel: "Stage-2", targetLabel: "Stage-3" },
    ],
  },
  {
    id: "issue-diagnosis",
    name: "Issue Diagnosis",
    description: "Investigate an issue through evidence gathering, hypothesis testing, and root cause analysis.",
    category: "diagnosis",
    nodes: [
      { label: "Evidence-Gatherer", description: "Collects logs, metrics, and context" },
      { label: "Hypothesis-Generator", description: "Forms diagnostic hypotheses" },
      { label: "Validator", description: "Tests hypotheses against evidence" },
      { label: "Reporter", description: "Produces diagnosis report" },
    ],
    edges: [
      { sourceLabel: "Evidence-Gatherer", targetLabel: "Hypothesis-Generator" },
      { sourceLabel: "Hypothesis-Generator", targetLabel: "Validator" },
      { sourceLabel: "Validator", targetLabel: "Reporter" },
    ],
  },
  {
    id: "heartbeat-monitor",
    name: "Heartbeat Monitor",
    description: "Periodic health checks that trigger escalation on failure.",
    category: "notification",
    nodes: [
      { label: "Health-Check", description: "Runs health checks" },
      { label: "Escalator", description: "Escalates on failure" },
      { label: "Notifier", description: "Sends notifications" },
    ],
    edges: [
      { sourceLabel: "Health-Check", targetLabel: "Escalator", condition: "failure" },
      { sourceLabel: "Escalator", targetLabel: "Notifier" },
    ],
  },
];

// ─── DAG Engine ──────────────────────────────────────────────────────

export type NodeExecutor = (
  node: DagNodeDef,
  inputs: Record<string, unknown>,
  context: { runId: string; workspace: string; signal?: AbortSignal }
) => Promise<{ outputs: Record<string, unknown>; evidence: Array<{ type: string; payload: unknown }> }>;

export class DagEngine {
  private patterns = new Map<string, DagPattern>(BUILTIN_PATTERNS.map((p) => [p.id, p]));
  private activeRuns = new Map<string, DagRunState>();
  private nodeExecutor: NodeExecutor | null = null;

  constructor(options?: { patterns?: DagPattern[]; executor?: NodeExecutor }) {
    if (options?.patterns) {
      for (const p of options.patterns) {
        this.patterns.set(p.id, p);
      }
    }
    this.nodeExecutor = options?.executor ?? null;
  }

  setNodeExecutor(executor: NodeExecutor): void {
    this.nodeExecutor = executor;
  }

  // ── Patterns ───────────────────────────────────────────────────────

  listPatterns(): DagPattern[] {
    return Array.from(this.patterns.values());
  }

  getPattern(id: string): DagPattern | null {
    return this.patterns.get(id) ?? null;
  }

  registerPattern(pattern: DagPattern): void {
    this.patterns.set(pattern.id, pattern);
  }

  // ── DAG Construction ───────────────────────────────────────────────

  createDag(
    name: string,
    nodes: DagNodeInput[],
    edges: DagEdge[],
    options?: { description?: string; metadata?: Record<string, unknown> }
  ): DagDefinition {
    return DagDefinition.parse({
      id: `dag_${Date.now().toString(36)}`,
      name,
      nodes,
      edges,
      description: options?.description,
      metadata: options?.metadata ?? {},
    });
  }

  fromPattern(patternId: string, overrides?: Partial<DagNodeDef>[]): DagDefinition | null {
    const pattern = this.patterns.get(patternId);
    if (!pattern) return null;

    const nodes: DagNodeDef[] = pattern.nodes.map((n, i) => {
      const override = overrides?.[i] ?? {};
      return DagNodeDef.parse({ ...n, id: `${patternId}_${n.label.toLowerCase().replace(/\s+/g, "-")}_${i}`, ...override });
    });

    const edges: DagEdge[] = pattern.edges.map((e, i) => {
      const sourceNode = nodes.find((n) => n.label === e.sourceLabel);
      const targetNode = nodes.find((n) => n.label === e.targetLabel);
      if (!sourceNode || !targetNode) throw new Error(`Pattern edge ${i} references unknown node`);
      const edge: DagEdge = {
        id: `edge_${i}`,
        source: sourceNode.id,
        target: targetNode.id,
        condition: e.condition,
      };
      return edge;
    });

    return {
      id: `dag_${Date.now().toString(36)}`,
      name: pattern.name,
      description: pattern.description,
      version: "1.0",
      nodes,
      edges,
      metadata: { patternId },
    };
  }

  // ── Validation ─────────────────────────────────────────────────────

  validate(dag: DagDefinition): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const nodeIds = new Set(dag.nodes.map((n) => n.id));

    // Check no isolated nodes (optional, but good practice)
    const referencedNodes = new Set<string>();
    for (const edge of dag.edges) {
      if (!nodeIds.has(edge.source)) {
        errors.push(`Edge ${edge.id}: source node "${edge.source}" not found`);
      }
      if (!nodeIds.has(edge.target)) {
        errors.push(`Edge ${edge.id}: target node "${edge.target}" not found`);
      }
      referencedNodes.add(edge.source);
      referencedNodes.add(edge.target);
    }

    // Simple cycle detection via DFS
    if (this.hasCycle(dag)) {
      errors.push("DAG contains a cycle");
    }

    return { valid: errors.length === 0, errors };
  }

  private hasCycle(dag: DagDefinition): boolean {
    const adjacency = new Map<string, string[]>();
    for (const node of dag.nodes) {
      adjacency.set(node.id, []);
    }
    for (const edge of dag.edges) {
      const neighbors = adjacency.get(edge.source) ?? [];
      neighbors.push(edge.target);
      adjacency.set(edge.source, neighbors);
    }

    const visited = new Set<string>();
    const stack = new Set<string>();

    const dfs = (nodeId: string): boolean => {
      visited.add(nodeId);
      stack.add(nodeId);
      for (const neighbor of adjacency.get(nodeId) ?? []) {
        if (stack.has(neighbor)) return true;
        if (!visited.has(neighbor) && dfs(neighbor)) return true;
      }
      stack.delete(nodeId);
      return false;
    };

    for (const node of dag.nodes) {
      if (!visited.has(node.id) && dfs(node.id)) return true;
    }
    return false;
  }

  // ── Execution ──────────────────────────────────────────────────────

  async execute(
    dag: DagDefinition,
    inputs: Record<string, Record<string, unknown>> = {},
    options?: { workspace?: string; signal?: AbortSignal; onNodeProgress?: (nodeId: string, status: DagNodeStatus, outputs?: Record<string, unknown>) => void }
  ): Promise<DagRunState> {
    if (!this.nodeExecutor) {
      throw new Error("Node executor not configured. Call setNodeExecutor() first.");
    }

    const runId = `run_${Date.now().toString(36)}`;
    const workspace = options?.workspace ?? process.cwd();

    // Initialize run state
    const nodeStates = new Map<string, DagNodeState>();
    for (const node of dag.nodes) {
      nodeStates.set(node.id, {
        nodeId: node.id,
        status: "pending",
        inputs: inputs[node.id] ?? {},
        outputs: {},
        error: null,
        retryCount: 0,
        startedAt: null,
        completedAt: null,
        evidence: [],
      });
    }

    const runState: DagRunState = {
      runId,
      dagId: dag.id,
      status: "running",
      nodes: nodeStates,
      startedAt: Date.now(),
      completedAt: null,
      workspace,
    };

    this.activeRuns.set(runId, runState);

    // Build adjacency and in-degree
    const adjacency = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    for (const node of dag.nodes) {
      adjacency.set(node.id, []);
      inDegree.set(node.id, 0);
    }
    for (const edge of dag.edges) {
      adjacency.get(edge.source)?.push(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    }

    // Input nodes for evidence passing
    const nodeInputs = new Map<string, Map<string, unknown>>();
    for (const node of dag.nodes) {
      nodeInputs.set(node.id, new Map(Object.entries(inputs[node.id] ?? {})));
    }

    // Topological levels for parallel execution
    const levels: string[][] = [];
    const currentInDegree = new Map(inDegree);
    const queue: string[] = [];

    for (const node of dag.nodes) {
      if (currentInDegree.get(node.id) === 0) {
        queue.push(node.id);
      }
    }

    while (queue.length > 0) {
      const level = [...queue];
      levels.push(level);
      queue.length = 0;

      for (const nodeId of level) {
        for (const target of adjacency.get(nodeId) ?? []) {
          currentInDegree.set(target, (currentInDegree.get(target) ?? 1) - 1);
          if (currentInDegree.get(target) === 0) {
            queue.push(target);
          }
        }
      }
    }

    // Execute level by level, parallel within level
    for (const level of levels) {
      if (options?.signal?.aborted) {
        runState.status = "cancelled";
        runState.completedAt = Date.now();
        return runState;
      }

      const levelNodes = level.map((id) => dag.nodes.find((n) => n.id === id)!).filter(Boolean);

      // Collect evidence from upstream nodes
      for (const nodeId of level) {
        const incomingEdges = dag.edges.filter((e) => e.target === nodeId);
        const upstreamInputs = nodeInputs.get(nodeId)!;
        for (const edge of incomingEdges) {
          const upstreamState = nodeStates.get(edge.source);
          if (upstreamState && upstreamState.status === "completed") {
            for (const [key, value] of Object.entries(upstreamState.outputs)) {
              upstreamInputs.set(key, value);
            }
          }
        }
      }

      // Execute all nodes in this level in parallel
      const levelPromises = levelNodes.map(async (node) => {
        const state = nodeStates.get(node.id)!;
        state.status = "running";
        state.startedAt = Date.now();
        options?.onNodeProgress?.(node.id, "running");

        for (let attempt = 0; attempt <= (node.retryCount || 1); attempt++) {
          try {
            state.retryCount = attempt;
            const combinedInputs = Object.fromEntries(nodeInputs.get(node.id)!.entries());
            const result = await this.nodeExecutor!(node, combinedInputs, {
              runId,
              workspace,
              signal: options?.signal,
            });

            state.outputs = result.outputs;
            state.evidence = result.evidence.map((e) => ({ ...e, timestamp: Date.now() }));
            state.status = "completed";
            state.completedAt = Date.now();
            options?.onNodeProgress?.(node.id, "completed", state.outputs);

            // Pass outputs to downstream nodes
            for (const target of adjacency.get(node.id) ?? []) {
              const targetInputs = nodeInputs.get(target);
              if (targetInputs) {
                for (const [key, value] of Object.entries(result.outputs)) {
                  targetInputs.set(`${node.id}.${key}`, value);
                  targetInputs.set(key, value); // also pass without prefix for convenience
                }
              }
            }
            break;
          } catch (err) {
            if (attempt >= (node.retryCount || 1)) {
              state.status = "failed";
              state.error = err instanceof Error ? err.message : String(err);
              state.completedAt = Date.now();
              options?.onNodeProgress?.(node.id, "failed");
            }
          }
        }
      });

      await Promise.all(levelPromises);

      // Check if any node failed
      const hasFailure = level.some((nodeId) => nodeStates.get(nodeId)?.status === "failed");
      if (hasFailure) {
        runState.status = "failed";
        runState.completedAt = Date.now();
        // Skip remaining dependencies
        break;
      }
    }

    // Determine final status
    if (runState.status === "running") {
      const allCompleted = dag.nodes.every((n) => {
        const s = nodeStates.get(n.id);
        return s && (s.status === "completed" || s.status === "skipped");
      });
      runState.status = allCompleted ? "completed" : "failed";
      runState.completedAt = Date.now();
    }

    return runState;
  }

  getRun(runId: string): DagRunState | null {
    return this.activeRuns.get(runId) ?? null;
  }

  cancelRun(runId: string): boolean {
    const run = this.activeRuns.get(runId);
    if (!run || run.status === "completed" || run.status === "cancelled") return false;
    run.status = "cancelled";
    run.completedAt = Date.now();
    return true;
  }

  listActiveRuns(): DagRunState[] {
    return Array.from(this.activeRuns.values());
  }
}

// ─── Built-in Node Executors ─────────────────────────────────────────

export async function defaultNodeExecutor(
  node: DagNodeDef,
  inputs: Record<string, unknown>,
  context: { runId: string; workspace: string; signal?: AbortSignal }
): Promise<{ outputs: Record<string, unknown>; evidence: Array<{ type: string; payload: unknown }> }> {
  // Default: echo executor that passes through inputs with node metadata
  return {
    outputs: {
      ...inputs,
      _nodeId: node.id,
      _nodeLabel: node.label,
      _completedAt: new Date().toISOString(),
    },
    evidence: [
      {
        type: "node_completed",
        payload: { nodeId: node.id, label: node.label, timestamp: Date.now() },
      },
    ],
  };
}
