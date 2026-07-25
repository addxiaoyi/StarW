/**
 * OpenStar built-in tool executor
 *
 * A functional set of tools the Agent Runtime can call during a run:
 * read_file, write_file, list_files, run_command, web_fetch.
 * Implemented with Node built-ins only (no extra dependencies).
 */
import fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { ToolExecutor } from "./agent.js";

const execAsync = promisify(exec);

export function createBuiltinToolExecutor(workdir = process.cwd()): ToolExecutor {
  return async (toolName: string, input: Record<string, unknown>) => {
    try {
      switch (toolName) {
        case "read_file": {
          const p = resolve(input.path);
          const content = await fs.readFile(p, "utf-8");
          return { success: true, output: content };
        }
        case "write_file": {
          const p = resolve(input.path);
          await fs.mkdir(path.dirname(p), { recursive: true });
          await fs.writeFile(p, String(input.content ?? ""), "utf-8");
          return { success: true, output: `Wrote ${p}` };
        }
        case "list_files": {
          const dir = resolve(input.path ?? ".");
          const entries = await fs.readdir(dir, { withFileTypes: true });
          return {
            success: true,
            output: entries.map((e) => ({
              name: e.name,
              type: e.isDirectory() ? "directory" : "file",
            })),
          };
        }
        case "run_command":
        case "shell":
        case "bash": {
          const command = String(input.command ?? "");
          const cwd = input.cwd ? resolve(input.cwd) : workdir;
          const { stdout, stderr } = await execAsync(command, {
            cwd,
            timeout: 60_000,
            maxBuffer: 8 * 1024 * 1024,
          });
          return { success: true, output: stdout || stderr };
        }
        case "web_fetch": {
          const url = String(input.url ?? "");
          const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
          const text = await res.text();
          return { success: res.ok, output: text.slice(0, 20000) };
        }
        default:
          return { success: false, output: null, error: `Unknown tool: ${toolName}` };
      }
    } catch (err) {
      return { success: false, output: null, error: err instanceof Error ? err.message : String(err) };
    }
  };

  function resolve(p?: unknown): string {
    const s = String(p ?? ".");
    return path.isAbsolute(s) ? s : path.resolve(workdir, s);
  }
}
