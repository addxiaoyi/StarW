import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleAcp } from "../acp.js";

let tempDir = "";
let workspaceRoot = "";

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openstar-gateway-"));
  workspaceRoot = path.join(tempDir, "workspace");
  await fs.mkdir(workspaceRoot);
  await fs.writeFile(path.join(workspaceRoot, "inside.txt"), "inside", "utf8");
  await fs.writeFile(path.join(tempDir, "outside.txt"), "outside", "utf8");
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("Gateway ACP handler", () => {
  it("lists real core skills and agents", async () => {
    const result = (await handleAcp("skills/list", {}, { workspaceRoot })) as {
      skills: unknown[];
      agents: unknown[];
    };
    expect(result.skills.length).toBeGreaterThan(0);
    expect(result.agents.length).toBeGreaterThan(0);
  });

  it("executes an allowlisted command without a shell", async () => {
    const result = (await handleAcp(
      "skills/execute",
      { skill_id: "terminal", input: { command: "echo hello-openstar" } },
      { workspaceRoot },
    )) as { success: boolean; output: { stdout: string } };
    expect(result.success).toBe(true);
    expect(result.output.stdout).toContain("hello-openstar");
  });

  it("blocks shell operators", async () => {
    const result = (await handleAcp(
      "skills/execute",
      { skill_id: "terminal", input: { command: "echo ok && whoami" } },
      { workspaceRoot },
    )) as { success: boolean; blocked: boolean; error: string };
    expect(result.success).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.error).toMatch(/Shell operators/);
  });

  it("keeps file reads inside the workspace", async () => {
    const inside = (await handleAcp("files/read", { path: "inside.txt" }, { workspaceRoot })) as {
      content: string;
    };
    expect(inside.content).toBe("inside");

    const outside = (await handleAcp("files/read", { path: "../outside.txt" }, { workspaceRoot })) as {
      content: string;
      error: string;
    };
    expect(outside.content).toBe("");
    expect(outside.error).toMatch(/outside the workspace/);
  });

  it("does not emit a fake provider response", async () => {
    const created = (await handleAcp("sessions/create", { name: "t" }, { workspaceRoot })) as { id: string };
    await handleAcp(
      "sessions/prompt",
      { session_id: created.id, messages: [{ role: "user", content: [{ text: "hi" }] }] },
      { workspaceRoot },
    );
    const list = (await handleAcp(
      "sessions/list_messages",
      { session_id: created.id },
      { workspaceRoot },
    )) as { messages: Array<{ content: Array<{ text?: string }> }> };
    expect(list.messages).toHaveLength(2);
    expect(list.messages[1].content[0].text).toMatch(/No LLM provider/);
    expect(list.messages[1].content[0].text).not.toMatch(/demo/i);
  });

  it("disables config writes by default", async () => {
    const result = (await handleAcp("config/set", { ui: { theme: "dark" } }, { workspaceRoot })) as {
      ok: boolean;
      error: string;
    };
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/disabled/);
  });

  it("throws on unknown methods", async () => {
    await expect(handleAcp("nope", {}, { workspaceRoot })).rejects.toThrow(/Unknown ACP method/);
  });
});
