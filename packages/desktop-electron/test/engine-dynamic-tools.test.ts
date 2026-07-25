import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMcpAgentToolName } from "../src/engine-mcp.js";
import { createSkillToolName, DesktopSkillManager } from "../src/engine-skills.js";

describe("desktop dynamic Agent tools", () => {
  it("creates stable bounded MCP and skill function names", () => {
    const mcp = createMcpAgentToolName("server with spaces", "tool/with/a/very/long/name".repeat(4));
    const skill = createSkillToolName("My Project Skill");
    expect(mcp).toMatch(/^mcp__[a-z0-9_-]+__[a-z0-9_-]+_[a-f0-9]{8}$/);
    expect(mcp.length).toBeLessThanOrEqual(64);
    expect(skill).toMatch(/^skill__[a-z0-9_-]+_[a-f0-9]{8}$/);
    expect(skill.length).toBeLessThanOrEqual(64);
  });

  it("discovers workspace SKILL.md files and exposes their instructions", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openstar-skills-"));
    const directory = path.join(root, ".agents", "skills", "review");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, "SKILL.md"),
      "---\nname: Review Expert\ndescription: Review code carefully\n---\n# Review\nAlways inspect tests.",
      "utf8",
    );
    const manager = new DesktopSkillManager(() => root);
    const skill = manager.list()[0];
    expect(skill?.title).toBe("Review Expert");
    expect(skill?.schema).toMatchObject({ type: "function" });
    expect(manager.execute(skill!.name, { input: "Review this change" })).toMatchObject({
      skill: "review",
      input: "Review this change",
      instructions: expect.stringContaining("Always inspect tests"),
    });
  });
});
