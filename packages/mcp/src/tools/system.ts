/** MCP system tools with explicit capability gates. */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";
import { z } from "zod";
import type { ToolDefinition } from "../core/types.js";
import { prepareCommandExecution, resolvePathSecurity } from "../security/index.js";

const execFileAsync = promisify(execFile);
const SECRET_NAME = /(key|token|secret|password|passwd|credential|cookie|authorization)/i;
const SAFE_ENV_NAMES = new Set([
  "PATH",
  "HOME",
  "USERPROFILE",
  "TEMP",
  "TMP",
  "SHELL",
  "COMSPEC",
  "NODE_ENV",
  "LANG",
]);

export const systemTools: ToolDefinition[] = [
  {
    name: "execute_command",
    description: "Execute one allowlisted executable without invoking a shell",
    inputSchema: z.object({ command: z.string(), cwd: z.string().optional(), timeout: z.number().optional() }),
    handler: async (args) => {
      let prepared;
      try {
        prepared = prepareCommandExecution(String(args.command));
      } catch (error) {
        return {
          command: args.command,
          stdout: "",
          stderr: (error as Error).message,
          exitCode: 403,
          success: false,
          blocked: true,
        };
      }

      const cwd = await resolvePathSecurity(String(args.cwd ?? process.cwd()));
      if (!cwd.allowed || !cwd.path) {
        return {
          command: args.command,
          stdout: "",
          stderr: cwd.reason,
          exitCode: 403,
          success: false,
          blocked: true,
        };
      }

      if (prepared.executable === "echo") {
        return {
          command: args.command,
          stdout: `${prepared.args.join(" ")}${os.EOL}`,
          stderr: "",
          exitCode: 0,
          success: true,
        };
      }

      try {
        const { stdout, stderr } = await execFileAsync(prepared.executable, prepared.args, {
          cwd: cwd.path,
          timeout: Math.max(100, Math.min(Number(args.timeout ?? 30_000), 60_000)),
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true,
        });
        return {
          command: args.command,
          stdout: String(stdout),
          stderr: String(stderr),
          exitCode: 0,
          success: true,
        };
      } catch (error) {
        const failure = error as Error & { stdout?: string; stderr?: string; code?: number };
        return {
          command: args.command,
          stdout: String(failure.stdout ?? ""),
          stderr: String(failure.stderr ?? failure.message),
          exitCode: failure.code ?? 1,
          success: false,
        };
      }
    },
  },
  {
    name: "get_system_info",
    description: "Get non-secret local runtime information",
    inputSchema: z.object({}),
    handler: async () => ({
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
      cpus: os.cpus().length,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      uptime: os.uptime(),
      nodeVersion: process.version,
    }),
  },
  {
    name: "get_process_list",
    description: "Get a bounded process list when explicitly enabled",
    inputSchema: z.object({ filter: z.string().optional(), limit: z.number().optional() }),
    handler: async (args) => {
      if (process.env.OPENSTAR_ALLOW_PROCESS_LIST !== "1") {
        return { success: false, blocked: true, error: "Process listing is disabled" };
      }
      if (process.platform !== "win32") {
        return {
          success: false,
          processes: [],
          count: 0,
          error: "Process listing is currently implemented for Windows only",
        };
      }
      try {
        const { stdout } = await execFileAsync("tasklist", ["/FO", "CSV", "/NH"], {
          windowsHide: true,
          maxBuffer: 2 * 1024 * 1024,
        });
        const filter = String(args.filter ?? "").toLowerCase();
        const limit = Math.max(1, Math.min(Number(args.limit ?? 50), 200));
        const processes = String(stdout)
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => line.split(",").map((part) => part.replace(/^"|"$/g, "")))
          .map((parts) => ({
            name: parts[0],
            pid: Number.parseInt(parts[1] ?? "0", 10) || 0,
            session: parts[2],
            memory: parts[4],
          }))
          .filter((entry) => !filter || entry.name.toLowerCase().includes(filter))
          .slice(0, limit);
        return { success: true, platform: "win32", processes, count: processes.length };
      } catch (error) {
        return { success: false, processes: [], count: 0, error: (error as Error).message };
      }
    },
  },
  {
    name: "kill_process",
    description: "Terminate a process only when explicitly enabled",
    inputSchema: z.object({ pid: z.number().int().positive(), force: z.boolean().optional() }),
    handler: async (args) => {
      const pid = Number(args.pid);
      if (process.env.OPENSTAR_ALLOW_PROCESS_KILL !== "1") {
        return { success: false, blocked: true, pid, error: "Process termination is disabled" };
      }
      if ([process.pid, process.ppid].includes(pid)) {
        return {
          success: false,
          blocked: true,
          pid,
          error: "Cannot terminate the OpenStar process or its parent",
        };
      }
      try {
        process.kill(pid, args.force ? "SIGKILL" : "SIGTERM");
        return { success: true, pid };
      } catch (error) {
        return { success: false, pid, error: (error as Error).message };
      }
    },
  },
  {
    name: "get_env",
    description: "Read one non-secret environment variable or a fixed safe subset",
    inputSchema: z.object({ name: z.string().optional() }),
    handler: async (args) => {
      const name = args.name ? String(args.name).toUpperCase() : undefined;
      if (name) {
        if (SECRET_NAME.test(name) || !SAFE_ENV_NAMES.has(name)) {
          return { name, value: null, blocked: true };
        }
        return { name, value: process.env[name] ?? null };
      }
      return {
        env: Object.fromEntries([...SAFE_ENV_NAMES].map((key) => [key, process.env[key] ?? null])),
      };
    },
  },
  {
    name: "set_env",
    description: "Set a non-secret process-local environment variable when explicitly enabled",
    inputSchema: z.object({ name: z.string(), value: z.string() }),
    handler: async (args) => {
      const name = String(args.name).toUpperCase();
      if (process.env.OPENSTAR_ALLOW_ENV_WRITE !== "1") {
        return { success: false, blocked: true, name, error: "Environment writes are disabled" };
      }
      if (SECRET_NAME.test(name)) {
        return {
          success: false,
          blocked: true,
          name,
          error: "Secret-like environment names cannot be modified",
        };
      }
      if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(name)) {
        return { success: false, blocked: true, name, error: "Invalid environment variable name" };
      }
      process.env[name] = String(args.value);
      return { success: true, name };
    },
  },
  {
    name: "get_disk_usage",
    description: "Get filesystem usage for a path inside configured workspace roots",
    inputSchema: z.object({ path: z.string().optional() }),
    handler: async (args) => {
      const checked = await resolvePathSecurity(String(args.path ?? process.cwd()));
      if (!checked.allowed || !checked.path) {
        return { success: false, blocked: true, error: checked.reason };
      }
      try {
        const stat = await fs.statfs(checked.path);
        const total = Number(stat.blocks) * Number(stat.bsize);
        const free = Number(stat.bavail) * Number(stat.bsize);
        return {
          success: true,
          path: checked.path,
          total,
          free,
          used: total - free,
          percent: total ? (((total - free) / total) * 100).toFixed(1) : "0.0",
        };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    },
  },
];
