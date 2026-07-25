import { describe, it, expect, beforeEach } from "vitest";
import { AgentOrchestrator } from "../orchestrator";
import type { AgentDefinition } from "@openstar/core";

function makeAgent(id: string, caps: string[] = []): AgentDefinition {
  return {
    id,
    name: id,
    type: "worker",
    description: `Agent ${id}`,
    capabilities: caps.map((c) => ({ name: c, description: c, version: "1.0.0", tags: [] })),
    skills: [],
    mcpServers: [],
    maxConcurrentTasks: 2,
    timeoutMs: 30000,
  };
}

describe("AgentOrchestrator", () => {
  let orchestrator: AgentOrchestrator;

  beforeEach(() => {
    orchestrator = new AgentOrchestrator({
      config: { maxConcurrentAgents: 3, maxTaskRetries: 1, taskTimeoutMs: 30000, enableParallelExecution: false, defaultAgentId: "primary" },
      agentDefinitions: [makeAgent("primary"), makeAgent("worker1", ["code", "test"])],
    });
  });

  describe("task management", () => {
    it("should create a task with generated ID", () => {
      const task = orchestrator.createTask("Test Task", "Do something");
      expect(task.id).toBeDefined();
      expect(task.id.length).toBeGreaterThan(0);
      expect(task.title).toBe("Test Task");
      expect(task.status).toBe("pending");
      expect(task.priority).toBe("normal");
    });

    it("should create tasks with different priorities", () => {
      const high = orchestrator.createTask("Urgent", "ASAP", { priority: "urgent" });
      const low = orchestrator.createTask("Later", "Whenever", { priority: "low" });
      expect(high.priority).toBe("urgent");
      expect(low.priority).toBe("low");
    });

    it("should retrieve a task by ID", () => {
      const task = orchestrator.createTask("Find Me", "test");
      const found = orchestrator.getTask(task.id);
      expect(found).toBeDefined();
      expect(found!.title).toBe("Find Me");
    });

    it("should return undefined for nonexistent task", () => {
      expect(orchestrator.getTask("no-such-id")).toBeUndefined();
    });

    it("should list all tasks", () => {
      orchestrator.createTask("A", "desc");
      orchestrator.createTask("B", "desc");
      expect(orchestrator.listTasks().length).toBe(2);
    });

    it("should filter tasks by priority", () => {
      orchestrator.createTask("High Prio", "desc", { priority: "high" });
      orchestrator.createTask("Normal", "desc", { priority: "normal" });
      expect(orchestrator.listTasks({ priority: "high" }).length).toBe(1);
    });
  });

  describe("agent management", () => {
    it("should register agent definitions", () => {
      orchestrator.registerAgentDefinition(makeAgent("specialist", ["review"]));
      const defs = orchestrator.listAgentDefinitions();
      expect(defs.some((d) => d.id === "specialist")).toBe(true);
    });

    it("should list registered agent definitions", () => {
      const defs = orchestrator.listAgentDefinitions();
      expect(defs.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("config management", () => {
    it("should get config", () => {
      const config = orchestrator.getConfig();
      expect(config.maxConcurrentAgents).toBe(3);
    });

    it("should update config", () => {
      orchestrator.setConfig({ maxConcurrentAgents: 5 });
      expect(orchestrator.getConfig().maxConcurrentAgents).toBe(5);
    });
  });

  describe("execution lifecycle", () => {
    it("should have subagent manager accessible", () => {
      const mgr = orchestrator.getSubAgentManager();
      expect(mgr).toBeDefined();
    });

    it("should handle task cancellation", () => {
      const task = orchestrator.createTask("Cancel Me", "test");
      const result = orchestrator.cancelTask(task.id);
      expect(result).toBe(true);
      const cancelled = orchestrator.getTask(task.id);
      expect(cancelled!.status).toBe("cancelled");
    });

    it("should return stats", () => {
      orchestrator.createTask("Stats 1", "test");
      orchestrator.createTask("Stats 2", "test");
      const stats = orchestrator.getStats();
      expect(stats.totalTasks).toBe(2);
      expect(stats.runningAgents).toBe(0);
      expect(stats.maxConcurrentAgents).toBe(3);
    });
  });

  describe("error handling", () => {
    it("should throw for nonexistent task execution", async () => {
      await expect(orchestrator.executeTask("no-such-task")).rejects.toThrow("not found");
    });
  });
});
