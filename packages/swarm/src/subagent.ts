import { generateAgentInstanceId } from "@openstar/core";
import type {
  AgentDefinition,
  AgentInstance,
  ChatMessage,
  AgentStatus,
} from "@openstar/core";
import type { SubAgentSpawnOptions } from "./types";

export class SubAgentManager {
  private agents: Map<string, AgentInstance> = new Map();
  private definitions: Map<string, AgentDefinition> = new Map();
  private messageHandlers: Map<string, Set<(msg: ChatMessage) => void>> = new Map();
  private statusHandlers: Map<string, Set<(status: AgentStatus) => void>> = new Map();

  registerDefinition(definition: AgentDefinition): void {
    this.definitions.set(definition.id, definition);
  }

  getDefinition(id: string): AgentDefinition | undefined {
    return this.definitions.get(id);
  }

  listDefinitions(): AgentDefinition[] {
    return Array.from(this.definitions.values());
  }

  spawnAgent(options: SubAgentSpawnOptions): AgentInstance {
    const { definition, taskId, sessionId, onStatusChange, onMessage } = options;

    const instance: AgentInstance = {
      instanceId: generateAgentInstanceId(),
      definitionId: definition.id,
      status: "idle",
      currentTaskId: taskId,
      startedAt: Date.now(),
      metadata: {
        sessionId,
        spawnedAt: Date.now(),
      },
    };

    this.agents.set(instance.instanceId, instance);

    if (onStatusChange) {
      if (!this.statusHandlers.has(instance.instanceId)) {
        this.statusHandlers.set(instance.instanceId, new Set());
      }
      this.statusHandlers.get(instance.instanceId)!.add(onStatusChange);
    }

    if (onMessage) {
      if (!this.messageHandlers.has(instance.instanceId)) {
        this.messageHandlers.set(instance.instanceId, new Set());
      }
      this.messageHandlers.get(instance.instanceId)!.add(onMessage);
    }

    this.updateStatus(instance.instanceId, "running");

    return instance;
  }

  getAgent(instanceId: string): AgentInstance | undefined {
    return this.agents.get(instanceId);
  }

  listAgents(filters?: { status?: AgentStatus; definitionId?: string }): AgentInstance[] {
    let result = Array.from(this.agents.values());

    if (filters?.status) {
      result = result.filter((a) => a.status === filters.status);
    }
    if (filters?.definitionId) {
      result = result.filter((a) => a.definitionId === filters.definitionId);
    }

    return result;
  }

  updateStatus(instanceId: string, status: AgentStatus): boolean {
    const agent = this.agents.get(instanceId);
    if (!agent) return false;

    agent.status = status;

    if (status === "completed" || status === "failed" || status === "cancelled") {
      agent.completedAt = Date.now();
    }

    const handlers = this.statusHandlers.get(instanceId);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(status);
        } catch {
          // ignore handler errors
        }
      }
    }

    return true;
  }

  setError(instanceId: string, error: string): boolean {
    const agent = this.agents.get(instanceId);
    if (!agent) return false;

    agent.error = error;
    this.updateStatus(instanceId, "failed");

    return true;
  }

  dispatchMessage(instanceId: string, message: ChatMessage): void {
    const handlers = this.messageHandlers.get(instanceId);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(message);
        } catch {
          // ignore handler errors
        }
      }
    }
  }

  terminateAgent(instanceId: string): boolean {
    const agent = this.agents.get(instanceId);
    if (!agent) return false;

    this.updateStatus(instanceId, "cancelled");
    this.messageHandlers.delete(instanceId);
    this.statusHandlers.delete(instanceId);

    return true;
  }

  getRunningCount(): number {
    let count = 0;
    for (const agent of this.agents.values()) {
      if (agent.status === "running") count++;
    }
    return count;
  }

  cleanupCompleted(maxAgeMs: number = 3600000): number {
    const now = Date.now();
    let removed = 0;

    for (const [id, agent] of this.agents) {
      if (
        (agent.status === "completed" || agent.status === "failed" || agent.status === "cancelled") &&
        agent.completedAt &&
        now - agent.completedAt > maxAgeMs
      ) {
        this.agents.delete(id);
        this.messageHandlers.delete(id);
        this.statusHandlers.delete(id);
        removed++;
      }
    }

    return removed;
  }

  findBestAgentForTask(
    requiredCapabilities: string[],
    excludeIds: Set<string> = new Set()
  ): AgentDefinition | null {
    let bestMatch: AgentDefinition | null = null;
    let bestScore = -1;

    for (const def of this.definitions.values()) {
      if (excludeIds.has(def.id)) continue;

      const capabilitySet = new Set(def.capabilities.map((c) => c.name));
      let score = 0;

      for (const req of requiredCapabilities) {
        if (capabilitySet.has(req)) {
          score += 2;
        }
      }

      score += def.capabilities.length * 0.1;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = def;
      }
    }

    return bestMatch;
  }
}

export const subAgentManager = new SubAgentManager();
