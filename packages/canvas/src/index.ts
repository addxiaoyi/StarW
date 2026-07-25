/**
 * OpenStar Canvas Package
 *
 * Visual workflow canvas for DAG rendering, node editing, and real-time monitoring.
 * Provides a graph-based UI engine for workflow visualization.
 */

export interface CanvasNode {
  id: string;
  type: "agent" | "tool" | "decision" | "input" | "output" | "group";
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  status?: "pending" | "running" | "completed" | "failed" | "cancelled";
  data?: Record<string, unknown>;
}

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  sourcePort?: string;
  targetPort?: string;
  label?: string;
  style?: "solid" | "dashed" | "dotted";
  animated?: boolean;
}

export interface CanvasState {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: { x: number; y: number; zoom: number };
  selected: string[];
}

export interface CanvasLayout {
  name: "dagre" | "force" | "grid" | "tree";
  direction?: "TB" | "LR" | "RL" | "BT";
  spacing?: number;
}

export class WorkflowCanvas {
  private state: CanvasState;

  constructor() {
    this.state = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, selected: [] };
  }

  addNode(node: Omit<CanvasNode, "x" | "y">, x = 0, y = 0): CanvasNode {
    const n: CanvasNode = { ...node, x, y, width: 180, height: 60 };
    this.state.nodes.push(n);
    return n;
  }

  removeNode(id: string): void {
    this.state.nodes = this.state.nodes.filter((n) => n.id !== id);
    this.state.edges = this.state.edges.filter((e) => e.source !== id && e.target !== id);
  }

  addEdge(edge: CanvasEdge): CanvasEdge {
    this.state.edges.push(edge);
    return edge;
  }

  removeEdge(id: string): void {
    this.state.edges = this.state.edges.filter((e) => e.id !== id);
  }

  updateNodeStatus(id: string, status: CanvasNode["status"]): void {
    const node = this.state.nodes.find((n) => n.id === id);
    if (node) node.status = status;
  }

  autoLayout(layout: CanvasLayout = { name: "dagre", direction: "TB", spacing: 120 }): void {
    // Simple layered layout
    const levels = this.computeLevels();
    const spacing = layout.spacing ?? 120;
    for (let i = 0; i < levels.length; i++) {
      const nodesInLevel = levels[i];
      for (let j = 0; j < nodesInLevel.length; j++) {
        const node = this.state.nodes.find((n) => n.id === nodesInLevel[j]);
        if (node) {
          node.x = j * (180 + spacing);
          node.y = i * (60 + spacing);
        }
      }
    }
  }

  private computeLevels(): string[][] {
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const n of this.state.nodes) {
      inDegree.set(n.id, 0);
      adj.set(n.id, []);
    }
    for (const e of this.state.edges) {
      inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
      adj.get(e.source)?.push(e.target);
    }
    const levels: string[][] = [];
    let queue = this.state.nodes.filter((n) => inDegree.get(n.id) === 0).map((n) => n.id);
    while (queue.length > 0) {
      levels.push([...queue]);
      const next: string[] = [];
      for (const id of queue) {
        for (const target of adj.get(id) ?? []) {
          inDegree.set(target, (inDegree.get(target) ?? 1) - 1);
          if (inDegree.get(target) === 0) next.push(target);
        }
      }
      queue = next;
    }
    return levels;
  }

  getState(): CanvasState {
    return structuredClone(this.state);
  }

  toJSON(): string {
    return JSON.stringify(this.state, null, 2);
  }

  fromJSON(json: string): void {
    this.state = JSON.parse(json);
  }

  exportMermaid(): string {
    const lines = ["graph TD"];
    for (const edge of this.state.edges) {
      const src = this.state.nodes.find((n) => n.id === edge.source);
      const tgt = this.state.nodes.find((n) => n.id === edge.target);
      if (src && tgt) {
        lines.push(`  ${src.label}[${src.label}] --> ${tgt.label}[${tgt.label}]`);
      }
    }
    return lines.join("\n");
  }
}
