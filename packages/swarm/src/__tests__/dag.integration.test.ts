import { describe, it, expect } from "vitest";
import { DagEngine, defaultNodeExecutor } from "../dag/engine.js";

describe("DagEngine integration", () => {
  it("executes a linear DAG and passes evidence between nodes", async () => {
    const engine = new DagEngine();
    engine.setNodeExecutor(defaultNodeExecutor);

    const nodes = [
      { id: "A", label: "Stage A" },
      { id: "B", label: "Stage B" },
    ];
    const edges = [{ id: "e1", source: "A", target: "B" }];
    const dag = engine.createDag("pipeline-test", nodes as never, edges as never);

    const validation = engine.validate(dag);
    expect(validation.valid).toBe(true);

    const run = await engine.execute(dag, { A: { value: 42 } });
    expect(run.status).toBe("completed");

    const a = run.nodes.get("A")!;
    const b = run.nodes.get("B")!;
    expect(a.status).toBe("completed");
    expect(b.status).toBe("completed");
    // Evidence from A must reach B.
    expect(b.outputs.value).toBe(42);
    expect(b.outputs._nodeId).toBe("B");
  });

  it("detects cycles during validation", () => {
    const engine = new DagEngine();
    const dag = engine.createDag(
      "cycle",
      [
        { id: "A", label: "A" },
        { id: "B", label: "B" },
      ] as never,
      [
        { id: "e1", source: "A", target: "B" },
        { id: "e2", source: "B", target: "A" },
      ] as never,
    );

    const validation = engine.validate(dag);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => /cycle/i.test(e))).toBe(true);
  });

  it("runs a built-in pattern end-to-end", async () => {
    const engine = new DagEngine();
    engine.setNodeExecutor(defaultNodeExecutor);

    const dag = engine.fromPattern("pipeline");
    expect(dag).toBeTruthy();

    const run = await engine.execute(dag!);
    expect(run.status).toBe("completed");
    expect(run.nodes.size).toBe(3);
  });

  it("reports node progress callbacks", async () => {
    const engine = new DagEngine();
    engine.setNodeExecutor(defaultNodeExecutor);

    const dag = engine.fromPattern("double-check")!;
    const seen: string[] = [];
    const run = await engine.execute(dag, {}, {
      onNodeProgress: (nodeId, status) => seen.push(`${nodeId}:${status}`),
    });
    expect(run.status).toBe("completed");
    expect(seen.some((s) => s.endsWith(":completed"))).toBe(true);
  });
});
