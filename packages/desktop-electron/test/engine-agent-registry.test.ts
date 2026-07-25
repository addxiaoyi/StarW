import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DesktopAgentDefinitionManager } from "../src/engine-agent-registry.js";

const builtIns = () => [{
  name: "general",
  type: "general",
  description: "built in",
  permission: {
    canEdit: true,
    canExecute: true,
    canAccessNetwork: true,
    canUseMcp: true,
    allowedDirectories: [],
    deniedPatterns: [],
  },
}];

describe("DesktopAgentDefinitionManager", () => {
  it("persists least-privilege custom Agents without overriding built-ins", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openstar-agent-def-"));
    const manager = new DesktopAgentDefinitionManager(root, builtIns, () => undefined);
    const created = manager.create({
      name: "reviewer",
      description: "Reviews changes",
      instructions: "Inspect diffs and tests",
      tools: ["read", "grep"],
    });
    expect(created.permission).toMatchObject({ canEdit: false, canExecute: false, canUseMcp: false });
    expect(() => manager.create({ name: "general", description: "override" })).toThrow(/already exists/);
    const reloaded = new DesktopAgentDefinitionManager(root, builtIns, () => undefined);
    expect(reloaded.get("reviewer")).toMatchObject({ name: "reviewer", builtIn: false, tools: ["read", "grep"] });
    expect(reloaded.remove("general")).toBe(false);
  });
});
