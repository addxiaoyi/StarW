import { describe, it, expect, beforeEach } from "vitest";
import { z as Z } from "zod";
import { StarCore } from "../system/starcore";
import { ToolRegistry } from "../system/tool-registry";
import { AgentRegistry, createAgentRegistry } from "../system/agent";
import { SessionManager, createSessionManager } from "../system/session";

describe("StarCore", () => {
  let starcore: StarCore;

  beforeEach(() => {
    starcore = new StarCore({ workingDirectory: "/tmp/test" });
  });

  describe("initialization", () => {
    it("should initialize successfully", async () => {
      await starcore.initialize();
      const status = starcore.getStatus();
      expect(status.core).toBe("ready");
      expect(status.version).toBe("0.1.0");
    });

    it("should not reinitialize when already initialized", async () => {
      await starcore.initialize();
      await starcore.initialize();
      expect(starcore.getStatus().core).toBe("ready");
    });

    it("should report initializing status before init", () => {
      expect(starcore.getStatus().core).toBe("initializing");
    });
  });

  describe("tools", () => {
    it("should register default tools on initialize", async () => {
      await starcore.initialize();
      const tools = starcore.listTools();
      expect(tools.length).toBeGreaterThan(0);
    });

    it("should execute a registered tool", async () => {
      await starcore.initialize();
      const result = await starcore.executeTool("read_file", {
        path: "/nonexistent/file.txt",
      });
      expect(result).toBeDefined();
    });
  });

  describe("agents", () => {
    it("should list agents after initialization", async () => {
      await starcore.initialize();
      const agents = starcore.listAgents();
      expect(Array.isArray(agents)).toBe(true);
    });
  });

  describe("sessions", () => {
    it("should create a new session", async () => {
      await starcore.initialize();
      const session = starcore.createSession();
      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(typeof session.id).toBe("string");
    });
  });

  describe("shutdown", () => {
    it("should shut down cleanly", async () => {
      await starcore.initialize();
      await starcore.close();
      expect(starcore.getStatus().core).not.toBe("ready");
    });
  });
});

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it("should register a tool", () => {
    registry.register({
      name: "test_tool",
      description: "A test tool",
      inputSchema: Z.object({}),
      execute: async () => ({ content: [{ type: "text", text: "done" }] }),
    });
    expect(registry.list().length).toBe(1);
  });

  it("should list registered tools", () => {
    registry.register({
      name: "tool_a",
      description: "A",
      inputSchema: Z.object({}),
      execute: async () => ({ content: [{ type: "text", text: "a" }] }),
    });
    registry.register({
      name: "tool_b",
      description: "B",
      inputSchema: Z.object({}),
      execute: async () => ({ content: [{ type: "text", text: "b" }] }),
    });
    expect(registry.list().length).toBe(2);
  });

  it("should execute a tool by name", async () => {
    registry.register({
      name: "greet",
      description: "Greet",
      inputSchema: Z.object({ name: Z.string() }),
      execute: async (input) => ({
        content: [{ type: "text", text: `Hello, ${(input as { name: string }).name}!` }],
      }),
    });
    const result = await registry.execute("greet", { name: "World" }, {
      agentId: "test",
      agentType: "build",
      sessionId: "s1",
      workingDirectory: "/tmp",
      environment: {},
    });
    const content = result.content[0];
    expect(content?.type).toBe("text");
    if (!content || content.type !== "text") {
      throw new Error("Expected greet tool to return text content");
    }
    expect(content.text).toBe("Hello, World!");
    expect(result.isError).toBeFalsy();
  });

  it("should return error for unknown tool", async () => {
    const result = await registry.execute("nonexistent", {}, {
      agentId: "test",
      agentType: "build",
      sessionId: "s1",
      workingDirectory: "/tmp",
      environment: {},
    });
    expect(result.isError).toBe(true);
    const content = result.content[0];
    expect(content?.type).toBe("text");
    if (!content || content.type !== "text") {
      throw new Error("Expected unknown-tool error to return text content");
    }
    expect(content.text).toContain("not found");
  });
});

describe("AgentRegistry", () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = createAgentRegistry();
  });

  it("should register and list agents", () => {
    registry.register({
      name: "builder",
      type: "build",
      description: "Build agent",
      permission: {
        canEdit: true,
        canExecute: true,
        canAccessNetwork: true,
        canUseMcp: true,
        allowedDirectories: [],
        deniedPatterns: [],
      },
    });
    expect(registry.get("builder")).toBeDefined();
    expect(registry.list().some((a) => a.name === "builder")).toBe(true);
  });
});

describe("SessionManager", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = createSessionManager();
  });

  it("should create sessions with unique IDs", () => {
    const s1 = manager.create();
    const s2 = manager.create();
    expect(s1.id).toBeDefined();
    expect(s2.id).toBeDefined();
    expect(s1.id).not.toBe(s2.id);
  });

  it("should create sessions with config", () => {
    const session = manager.create({
      model: "claude-3-opus",
      temperature: 0.5,
    });
    expect(session.id).toBeDefined();
  });
});
