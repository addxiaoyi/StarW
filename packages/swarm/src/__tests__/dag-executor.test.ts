import { describe, it, expect } from "vitest";
import { DagExecutor } from "../runtime/dag-executor";
import { DagEngine } from "../dag/engine";

describe("DagExecutor (offline local mode)", () => {
  it("runs a built-in pattern end-to-end without a provider", async () => {
    const events: string[] = [];
    const executor = new DagExecutor({
      onEvent: (e) => events.push(e.type),
    });
    const result = await executor.runPattern("pipeline");

    expect(result.success).toBe(true);
    expect(result.mode).toBe("local");
    expect(Object.keys(result.nodeResults).length).toBe(3);
    expect(events).toContain("run:start");
    expect(events).toContain("run:complete");
  });

  it("passes upstream outputs to downstream nodes", async () => {
    const executor = new DagExecutor();
    const result = await executor.runPattern("orchestrator-workers");
    expect(result.success).toBe(true);
    // Every node completed and produced an output object.
    for (const r of Object.values(result.nodeResults)) {
      expect(r.success).toBe(true);
      expect(r.output).toBeDefined();
    }
  });

  it("throws on an unknown pattern", async () => {
    const executor = new DagExecutor();
    await expect(executor.runPattern("does-not-exist")).rejects.toThrow(/Unknown DAG pattern/);
  });

  it("exposes built-in patterns via the engine", () => {
    const patterns = new DagEngine().listPatterns();
    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns.map((p) => p.id)).toContain("double-check");
  });
});
