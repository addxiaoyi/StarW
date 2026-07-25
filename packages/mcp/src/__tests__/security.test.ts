import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkPathSecurity, prepareCommandExecution, resolvePathSecurity } from "../security/index.js";
import { filesystemTools } from "../tools/filesystem.js";
import { systemTools } from "../tools/system.js";

let tempDir = "";
let root = "";

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openstar-mcp-security-"));
  root = path.join(tempDir, "workspace");
  await fs.mkdir(root);
  process.env.OPENSTAR_WORKSPACE_ROOTS = root;
});

afterEach(async () => {
  delete process.env.OPENSTAR_WORKSPACE_ROOTS;
  delete process.env.OPENSTAR_ALLOW_ENV_WRITE;
  delete process.env.OPENSTAR_ALLOW_PROCESS_LIST;
  delete process.env.OPENSTAR_ALLOW_PROCESS_KILL;
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("MCP security", () => {
  it("rejects sibling-prefix paths", () => {
    expect(checkPathSecurity(path.join(tempDir, "workspace-secret", "x"), [root]).allowed).toBe(false);
  });

  it("rejects command chaining and executable paths", () => {
    expect(() => prepareCommandExecution("git status && whoami")).toThrow(/Shell operators/);
    expect(() => prepareCommandExecution("C:\\Windows\\System32\\cmd.exe /c whoami")).toThrow(/Executable paths/);
  });

  it("resolves workspace paths and blocks traversal", async () => {
    await fs.writeFile(path.join(root, "inside.txt"), "ok");
    expect((await resolvePathSecurity(path.join(root, "inside.txt"))).allowed).toBe(true);
    expect((await resolvePathSecurity(path.join(root, "..", "outside.txt"))).allowed).toBe(false);
  });

  it("does not expose secret environment variables", async () => {
    process.env.OPENAI_API_KEY = "secret";
    const getEnv = systemTools.find((tool) => tool.name === "get_env")!;
    const result = (await getEnv.handler({ name: "OPENAI_API_KEY" })) as { value: unknown; blocked: boolean };
    expect(result.value).toBeNull();
    expect(result.blocked).toBe(true);
    delete process.env.OPENAI_API_KEY;
  });

  it("disables process environment writes by default", async () => {
    const setEnv = systemTools.find((tool) => tool.name === "set_env")!;
    const result = (await setEnv.handler({ name: "OPENSTAR_TEST_VALUE", value: "x" })) as {
      success: boolean;
      blocked: boolean;
    };
    expect(result.success).toBe(false);
    expect(result.blocked).toBe(true);
  });

  it("blocks sensitive credential paths", async () => {
    const secretDir = path.join(root, ".ssh");
    await fs.mkdir(secretDir);
    await fs.writeFile(path.join(secretDir, "id_rsa"), "private");
    const readFile = filesystemTools.find((tool) => tool.name === "read_file")!;
    const result = (await readFile.handler({ path: path.join(secretDir, "id_rsa") })) as {
      success: boolean;
      error: string;
    };
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Sensitive credential/);
  });

  it("disables process control by default", async () => {
    const list = systemTools.find((tool) => tool.name === "get_process_list")!;
    const kill = systemTools.find((tool) => tool.name === "kill_process")!;
    expect((await list.handler({})) as object).toMatchObject({ success: false, blocked: true });
    expect((await kill.handler({ pid: process.pid })) as object).toMatchObject({ success: false, blocked: true });
  });
});
