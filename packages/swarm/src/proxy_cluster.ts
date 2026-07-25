import type { ClusterNode, Task } from "./types";

export interface ClusterConfig {
  nodeId: string;
  listenAddress?: string;
  heartbeatIntervalMs?: number;
  nodeTimeoutMs?: number;
}

export type LoadBalancingStrategy = "round-robin" | "least-connections" | "capability-match" | "random";

export class ProxyClusterManager {
  private nodes: Map<string, ClusterNode> = new Map();
  private config: ClusterConfig;
  private roundRobinIndex = 0;

  constructor(config: ClusterConfig) {
    this.config = config;
  }

  registerNode(node: ClusterNode): void {
    this.nodes.set(node.id, {
      ...node,
      lastHeartbeat: Date.now(),
    });
  }

  unregisterNode(nodeId: string): boolean {
    return this.nodes.delete(nodeId);
  }

  getNode(nodeId: string): ClusterNode | undefined {
    return this.nodes.get(nodeId);
  }

  listNodes(filters?: { status?: ClusterNode["status"]; agentType?: string }): ClusterNode[] {
    let result = Array.from(this.nodes.values());

    if (filters?.status) {
      result = result.filter((n) => n.status === filters.status);
    }
    if (filters?.agentType) {
      result = result.filter((n) => n.agentTypes.includes(filters.agentType!));
    }

    return result;
  }

  updateHeartbeat(nodeId: string, load: number): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;

    node.lastHeartbeat = Date.now();
    node.currentLoad = load;

    if (node.status === "offline") {
      node.status = "online";
    }

    return true;
  }

  setNodeStatus(nodeId: string, status: ClusterNode["status"]): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;
    node.status = status;
    return true;
  }

  assignTask(
    task: Task,
    strategy: LoadBalancingStrategy = "least-connections"
  ): ClusterNode | null {
    const onlineNodes = this.listNodes({ status: "online" }).filter(
      (n) => n.currentLoad < n.capacity
    );

    if (onlineNodes.length === 0) return null;

    const eligibleNodes = task.requiredCapabilities.length > 0
      ? onlineNodes.filter((n) =>
          task.requiredCapabilities.some((cap) => n.agentTypes.includes(cap))
        )
      : onlineNodes;

    if (eligibleNodes.length === 0) return null;

    switch (strategy) {
      case "round-robin":
        return this.roundRobin(eligibleNodes);
      case "least-connections":
        return this.leastConnections(eligibleNodes);
      case "capability-match":
        return this.capabilityMatch(eligibleNodes, task);
      case "random":
        return this.randomSelect(eligibleNodes);
      default:
        return this.leastConnections(eligibleNodes);
    }
  }

  private roundRobin(nodes: ClusterNode[]): ClusterNode {
    const node = nodes[this.roundRobinIndex % nodes.length];
    this.roundRobinIndex++;
    return node;
  }

  private leastConnections(nodes: ClusterNode[]): ClusterNode {
    return nodes.reduce((best, current) => {
      const bestUtilization = best.currentLoad / best.capacity;
      const currentUtilization = current.currentLoad / current.capacity;
      return currentUtilization < bestUtilization ? current : best;
    });
  }

  private capabilityMatch(nodes: ClusterNode[], task: Task): ClusterNode {
    let bestNode = nodes[0];
    let bestScore = -1;

    for (const node of nodes) {
      let score = 0;
      const agentTypeSet = new Set(node.agentTypes);

      for (const cap of task.requiredCapabilities) {
        if (agentTypeSet.has(cap)) score += 2;
      }

      const utilization = node.currentLoad / node.capacity;
      score += (1 - utilization) * 0.5;

      if (score > bestScore) {
        bestScore = score;
        bestNode = node;
      }
    }

    return bestNode;
  }

  private randomSelect(nodes: ClusterNode[]): ClusterNode {
    return nodes[Math.floor(Math.random() * nodes.length)];
  }

  checkTimeouts(): string[] {
    const timeoutMs = this.config.nodeTimeoutMs || 30000;
    const now = Date.now();
    const timedOut: string[] = [];

    for (const [id, node] of this.nodes) {
      if (node.status === "online" && now - node.lastHeartbeat > timeoutMs) {
        node.status = "offline";
        timedOut.push(id);
      }
    }

    return timedOut;
  }

  getClusterStats() {
    const nodes = Array.from(this.nodes.values());
    const online = nodes.filter((n) => n.status === "online").length;
    const totalCapacity = nodes.reduce((sum, n) => sum + n.capacity, 0);
    const totalLoad = nodes.reduce((sum, n) => sum + n.currentLoad, 0);

    return {
      totalNodes: nodes.length,
      onlineNodes: online,
      offlineNodes: nodes.length - online,
      totalCapacity,
      totalLoad,
      averageUtilization: totalCapacity > 0 ? totalLoad / totalCapacity : 0,
    };
  }

  getLocalNodeId(): string {
    return this.config.nodeId;
  }

  getLocalNode(): ClusterNode | undefined {
    return this.nodes.get(this.config.nodeId);
  }
}
