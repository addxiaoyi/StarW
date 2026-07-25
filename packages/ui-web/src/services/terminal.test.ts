import { afterEach, expect, test } from "vitest";

const calls: Array<{ method: string; params: Record<string, unknown> }> = [];

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    starcore: {
      async request(method: string, params: Record<string, unknown> = {}) {
        calls.push({ method, params });
        if (method === "command.execute") {
          return {
            commandId: params.commandId,
            success: true,
            stdout: "ENGINE_OK",
            stderr: "",
            durationMs: 12,
            exitCode: 0,
          };
        }
        if (method === "skills/execute") {
          return {
            success: true,
            output: { content: "TOOL_OK" },
            duration_ms: 5,
          };
        }
        throw new Error(`Unexpected method: ${method}`);
      },
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
  },
});

const { executeTerminalCommand } = await import("./terminal");

afterEach(() => {
  calls.length = 0;
});

test("normal commands execute through the embedded command RPC", async () => {
  const result = await executeTerminalCommand("echo ENGINE_OK", ".", "cmd-1");
  expect(result.success).toBe(true);
  expect(result.output).toBe("ENGINE_OK");
  expect(calls).toEqual([
    {
      method: "command.execute",
      params: { command: "echo ENGINE_OK", cwd: ".", commandId: "cmd-1" },
    },
  ]);
});

test("slash commands execute through the embedded skill RPC", async () => {
  const result = await executeTerminalCommand(
    `/read {"path":"package.json"}`,
    ".",
  );
  expect(result.success).toBe(true);
  expect(result.output).toBe("TOOL_OK");
  expect(calls[0]?.method).toBe("skills/execute");
  expect(calls[0]?.params).toEqual({
    skill_id: "read",
    input: { path: "package.json", cwd: "." },
  });
});
