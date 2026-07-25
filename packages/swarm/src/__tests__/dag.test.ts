import { describe, it, expect } from "vitest";
import { DagEngine, defaultNodeExecutor, BUILTIN_PATTERNS, DagDefinition } from "../dag/engine";

describe("DagEngine", () => {
  let engine: DagEngine;

  beforeEach(() => {
    engine = new DagEngine();
    engine.setNodeExecutor(defaultNodeExecutor);
  });

  describe("patterns", () => {
    it("should have built-in patterns", () => {
      const patterns = engine.listPatterns();
      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns.some((p) => p.id === "orchestrator-workers")).toBe(true);
      expect(patterns.some((p) => p.id === "double-check")).toBe(true);
    });

    it("should list all patterns as DagPattern objects", () => {
      for (const p of engine.listPatterns()) {
        expect(p.id).toBeDefined();
        expect(p.name).toBeDefined();
        expect(p.category).toBeDefined();
      }
    });
  });

  describe("DAG construction", () => {
    it("should create a DAG from a pattern", () => {
      const dag = engine.fromPattern("pipeline");
      expect(dag).not.toBeNull();
      expect(dag!.nodes.length).toBeGreaterThanOrEqual(3);
      expect(dag!.edges.length).toBeGreaterThanOrEqual(2);
    });

    it("should return null for unknown pattern", () => {
      const dag = engine.fromPattern("nonexistent-pattern");
      expect(dag).toBeNull();
    });

    it("should create a custom DAG", () => {
      const dag = engine.createDag(
        "Custom Test",
        [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        [{ id: "e1", source: "a", target: "b" }]
      );
      expect(dag.nodes.length).toBe(2);
      expect(dag.edges.length).toBe(1);
    });
  });

  describe("validation", () => {
    it("should validate a valid DAG", () => {
      const dag = engine.fromPattern("pipeline")!;
      const result = engine.validate(dag);
      expect(result.valid).toBe(true);
    });

    it("should detect missing edge references", () => {
      const dag = DagDefinition.parse({
        id: "bad",
        name: "Bad",
        nodes: [{ id: "a", label: "A" }],
        edges: [{ id: "e1", source: "a", target: "missing" }],
      });
      const result = engine.validate(dag);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("missing"))).toBe(true);
    });

    it("should detect cycles", () => {
      const dag = DagDefinition.parse({
        id: "cyclic",
        name: "Cyclic",
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [
          { id: "e1", source: "a", target: "b" },
          { id: "e2", source: "b", target: "a" },
        ],
      });
      const result = engine.validate(dag);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("cycle"))).toBe(true);
    });
  });

  describe("execution", () => {
    it("should execute a simple DAG", async () => {
      const dag = engine.fromPattern("pipeline")!;
      const run = await engine.execute(dag, {}, { workspace: process.cwd() });
      expect(run.status).toBe("completed");
      expect(run.nodes.size).toBe(dag.nodes.length);
      // all nodes should be completed
      for (const [_, state] of run.nodes) {
        expect(state.status).toBe("completed");
        expect(state.outputs).toBeDefined();
      }
    });

    it("should provide all node states", async () => {
      const dag = engine.fromPattern("orchestrator-workers")!;
      const run = await engine.execute(dag, {}, { workspace: process.cwd() });
      expect(run.runId).toBeDefined();
      expect(run.startedAt).toBeGreaterThan(0);
      expect(run.completedAt).toBeGreaterThan(0);
    });

    it("should track active runs", async () => {
      const dag = engine.fromPattern("pipeline")!;
      const run = await engine.execute(dag, {}, { workspace: process.cwd() });
      const found = engine.getRun(run.runId);
      expect(found).toBeDefined();
      expect(found!.runId).toBe(run.runId);
    });
  });
});
