import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyCommandRisk,
  createBashTool,
  createGrepTool,
  createReadTool,
  resolveWorkspacePath,
} from "../system/tool-registry.js";
import type { ToolContext } from "../system/tool-registry.js";

const roots: string[] = [];

function workspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openstar-secure-tools-"));
  roots.push(root);
  return root;
}

function context(
  root: string,
  overrides: Partial<ToolContext> = {},
): ToolContext {
  return {
    agentId: "test-agent",
    agentType: "build",
    sessionId: "test-session",
    workingDirectory: root,
    environment: {},
    ...overrides,
  };
}

function text(
  result: Awaited<ReturnType<ReturnType<typeof createReadTool>["execute"]>>,
): string {
  return result.content
    .filter((item) => item.type === "text")
    .map((item) => (item.type === "text" ? item.text : ""))
    .join("\n");
}

afterEach(() => {
  while (roots.length) {
    fs.rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe("secure workspace tools", () => {
  it("rejects a junction or symlink that resolves outside the workspace", async () => {
    const root = workspace();
    const outside = workspace();
    fs.writeFileSync(path.join(outside, "secret.txt"), "OUTSIDE", "utf8");
    const link = path.join(root, "escape");
    fs.symlinkSync(
      outside,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(
      resolveWorkspacePath(context(root), "escape/secret.txt", "existing"),
    ).rejects.toThrow(/outside the configured workspace/);
  });

  it("reads bounded line ranges with metadata", async () => {
    const root = workspace();
    fs.writeFileSync(
      path.join(root, "lines.txt"),
      Array.from({ length: 20 }, (_, index) => `line-${index + 1}`).join("\n"),
      "utf8",
    );

    const result = await createReadTool().execute(
      { path: "lines.txt", offset: 5, limit: 3 },
      context(root),
    );
    const parsed = JSON.parse(text(result));

    expect(parsed.startLine).toBe(5);
    expect(parsed.endLine).toBe(7);
    expect(parsed.totalLines).toBe(20);
    expect(parsed.content).toBe("line-5\nline-6\nline-7");
    expect(parsed.truncated).toBe(true);
  });

  it("searches injection-like text without invoking a shell", async () => {
    const root = workspace();
    const marker = path.join(root, "PWNED");
    const payload = `\"; echo PWNED > \"${marker}\"; echo \"`;
    fs.writeFileSync(
      path.join(root, "source.txt"),
      `before ${payload} after`,
      "utf8",
    );

    const result = await createGrepTool().execute(
      { pattern: payload, path: "." },
      context(root),
    );
    const parsed = JSON.parse(text(result));

    expect(parsed.count).toBe(1);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("requires approval for high-risk commands", async () => {
    const root = workspace();
    const requestApproval = vi.fn().mockResolvedValue(false);
    const executeCommand = vi.fn();

    const result = await createBashTool().execute(
      { command: "git reset --hard" },
      context(root, { requestApproval, executeCommand }),
    );

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("approval was denied");
    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({ risk: "high", tool: "bash" }),
    );
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it("classifies destructive and ordinary commands", () => {
    expect(classifyCommandRisk("git reset --hard").risk).toBe("high");
    expect(classifyCommandRisk("shutdown /s").risk).toBe("critical");
    expect(classifyCommandRisk("git status --short").risk).toBe("low");
  });

  it("passes cancellation and output limits to the command backend", async () => {
    const root = workspace();
    const controller = new AbortController();
    const executeCommand = vi.fn(async (request) => {
      expect(request.signal).toBe(controller.signal);
      expect(request.maxOutputBytes).toBe(4096);
      expect(request.sandbox).toBe("process");
      controller.abort();
      return {
        exitCode: 130,
        stdout: "",
        stderr: "cancelled",
        durationMs: 1,
        backend: "process-restricted",
      };
    });

    const result = await createBashTool().execute(
      { command: "node --version", sandbox: "process" },
      context(root, {
        signal: controller.signal,
        outputLimitBytes: 4096,
        executeCommand,
      }),
    );

    expect(result.isError).toBe(true);
    expect(executeCommand).toHaveBeenCalledOnce();
  });
});
