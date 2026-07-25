import { describe, expect, it } from "vitest";
import { normalizeAgentOrchestrationPlan } from "../src/engine-orchestration.js";

describe("normalizeAgentOrchestrationPlan", () => {
  it("accepts a topologically ordered multi-Agent dependency graph", () => {
    expect(
      normalizeAgentOrchestrationPlan([
        { id: "inspect", agent: "plan", prompt: "Inspect the code" },
        { id: "build", agent: "build", prompt: "Apply the fix", dependsOn: ["inspect"] },
        { id: "review", agent: "reviewer", prompt: "Review", dependsOn: ["inspect", "build"] },
      ]),
    ).toEqual([
      { id: "inspect", agent: "plan", prompt: "Inspect the code", dependsOn: [] },
      { id: "build", agent: "build", prompt: "Apply the fix", dependsOn: ["inspect"] },
      { id: "review", agent: "reviewer", prompt: "Review", dependsOn: ["inspect", "build"] },
    ]);
  });

  it("rejects forward and duplicate dependencies", () => {
    expect(() =>
      normalizeAgentOrchestrationPlan([
        { id: "build", agent: "build", prompt: "Build", dependsOn: ["inspect"] },
        { id: "inspect", agent: "plan", prompt: "Inspect" },
      ]),
    ).toThrow(/unknown or later/);
    expect(() =>
      normalizeAgentOrchestrationPlan([
        { id: "same", agent: "plan", prompt: "One" },
        { id: "same", agent: "build", prompt: "Two" },
      ]),
    ).toThrow(/Duplicate/);
  });
});
