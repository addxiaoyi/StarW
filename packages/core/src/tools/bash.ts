import { spawn } from "node:child_process";
import path from "node:path";
import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "./types";

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_CAPTURE_BYTES = 1024 * 1024;

export const definition: ToolDefinition = {
  name: "bash",
  description: "Execute a shell command in a working directory with optional timeout.",
  parameters: {
    command: {
      type: "string",
      description: "Shell command string to execute",
      required: true,
    },
    workdir: {
      type: "string",
      description: "Working directory. Defaults to the current context cwd.",
      required: false,
    },
    timeout: {
      type: "number",
      description: `Timeout in milliseconds. Defaults to ${DEFAULT_TIMEOUT_MS} and may not exceed ${MAX_TIMEOUT_MS}.`,
      required: false,
    },
  },
};

export interface BashInput {
  command: string;
  workdir?: string;
  timeout?: number;
}

export interface BashOutput {
  exit: number | null;
  output: string;
  truncated: boolean;
  timeout: boolean;
}

function resolveWorkdir(input: BashInput, context: ToolContext): string {
  const base = input.workdir || context.workdir || context.cwd;
  if (path.isAbsolute(base)) return base;
  return path.resolve(context.cwd, base);
}

export const execute: ToolExecutor<BashInput, BashOutput> = async (input, context) => {
  const timeout = Math.min(input.timeout || context.timeoutMs || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const cwd = resolveWorkdir(input, context);
  const shell = process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : "/bin/sh";
  const shellFlag = process.platform === "win32" ? "/c" : "-c";

  return new Promise<ToolResult<BashOutput>>((resolve) => {
    const child = spawn(shell, [shellFlag, input.command], {
      cwd,
      env: { ...process.env, ...(context.env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    let truncated = false;
    const timeoutId = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5000);
    }, timeout);

    const append = (chunk: Buffer) => {
      if (truncated) return;
      output += chunk.toString("utf8");
      if (output.length > MAX_CAPTURE_BYTES) {
        output = output.slice(0, MAX_CAPTURE_BYTES);
        truncated = true;
      }
    };

    child.stdout?.on("data", append);
    child.stderr?.on("data", append);

    child.on("error", (err) => {
      clearTimeout(timeoutId);
      resolve({
        success: false,
        output: { exit: null, output: "", truncated: false, timeout: false },
        error: err.message,
      });
    });

    child.on("close", (exit) => {
      clearTimeout(timeoutId);
      const timedOut = exit === null && child.killed;
      resolve({
        success: !timedOut && exit === 0,
        output: { exit, output, truncated, timeout: timedOut },
        error: timedOut ? "Command timed out before completion." : undefined,
      });
    });
  });
};
