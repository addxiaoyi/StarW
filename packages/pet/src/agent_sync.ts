import type { AgentStatusSync, PetEvent } from "./types";
import { PetStateMachine } from "./state_machine";
import { XpSystem } from "./xp_system";

export class AgentStatusSyncer {
  private stateMachine: PetStateMachine;
  private xpSystem: XpSystem;
  private activeAgents: Map<string, AgentStatusSync> = new Map();
  private listeners: Array<(event: PetEvent) => void> = [];

  constructor(stateMachine: PetStateMachine, xpSystem: XpSystem) {
    this.stateMachine = stateMachine;
    this.xpSystem = xpSystem;
  }

  updateAgentStatus(status: AgentStatusSync): void {
    const oldStatus = this.activeAgents.get(status.agentId);
    this.activeAgents.set(status.agentId, status);

    const event: PetEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "agent_status",
      timestamp: Date.now(),
      data: {
        agentId: status.agentId,
        agentName: status.agentName,
        oldStatus: oldStatus?.status,
        newStatus: status.status,
        currentTask: status.currentTask,
        progress: status.progress,
      },
    };
    this.notifyListeners(event);

    this.handleStatusChange(oldStatus?.status, status);
  }

  private handleStatusChange(
    oldStatus: string | undefined,
    newStatus: AgentStatusSync,
  ): void {
    if (oldStatus === newStatus.status) {
      if (newStatus.status === "running") {
        const progress = newStatus.progress;
        if (progress > 0 && progress < 100) {
          this.stateMachine.trigger("task_progress", {
            agentId: newStatus.agentId,
            progress,
          });
        }
      }
      return;
    }

    switch (newStatus.status) {
      case "running":
        if (oldStatus !== "paused") {
          this.stateMachine.trigger("task_start", {
            agentId: newStatus.agentId,
            task: newStatus.currentTask,
          });
        } else {
          this.stateMachine.setMood("working", "typing");
        }
        this.xpSystem.recordActiveSession();
        break;

      case "paused":
        this.stateMachine.trigger("task_pause", { agentId: newStatus.agentId });
        break;

      case "completed":
        this.stateMachine.trigger("task_complete", {
          agentId: newStatus.agentId,
          task: newStatus.currentTask,
        });
        this.xpSystem.addTaskCompleted(25);
        break;

      case "failed":
        this.stateMachine.trigger("task_failed", { agentId: newStatus.agentId });
        this.xpSystem.modifyStat("happiness", -3);
        break;

      case "idle":
        if (oldStatus === "running" || oldStatus === "paused") {
          this.stateMachine.trigger("return_to_idle", { agentId: newStatus.agentId });
        }
        break;
    }
  }

  removeAgent(agentId: string): void {
    this.activeAgents.delete(agentId);
  }

  getActiveAgents(): AgentStatusSync[] {
    return Array.from(this.activeAgents.values());
  }

  getActiveAgentCount(): number {
    return Array.from(this.activeAgents.values()).filter((a) => a.status === "running").length;
  }

  getOverallProgress(): number {
    const active = Array.from(this.activeAgents.values()).filter((a) => a.status === "running");
    if (active.length === 0) return 0;
    return active.reduce((acc, a) => acc + a.progress, 0) / active.length;
  }

  handleToolUse(agentId: string, toolName: string): void {
    this.stateMachine.trigger("tool_use", { agentId, toolName });
    this.xpSystem.addXp(2, "tool_use");

    const agent = this.activeAgents.get(agentId);
    if (agent) {
      agent.toolsUsed = [...(agent.toolsUsed || []), toolName];
    }
  }

  handleCodeWritten(agentId: string, lines: number): void {
    this.xpSystem.addCodeWritten(lines);

    if (lines > 10) {
      this.stateMachine.trigger("code_writing", { agentId, lines });
    }
  }

  handleCommit(agentId: string, message: string): void {
    this.xpSystem.addCommit();
    this.stateMachine.trigger("good_news", { agentId, message });
  }

  addListener(listener: (event: PetEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners(event: PetEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // ignore
      }
    }
  }
}
