import { spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import * as Z from "zod";
import type {
  Tool,
  ToolCommandRequest,
  ToolCommandResult,
  ToolContext,
  ToolResult,
  ToolRisk,
} from "./tool-registry.js";

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_READ_LINES = 2000;
const MAX_GREP_RESULTS = 500;
const MAX_GREP_FILES = 10_000;
const IGNORED = new Set([
  ".git",
  ".svn",
  ".hg",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
]);

function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await access(candidate, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function rootFor(context: ToolContext): Promise<string> {
  const root = await realpath(path.resolve(context.workingDirectory));
  if (!(await stat(root)).isDirectory())
    throw new Error(`Workspace is not a directory: ${root}`);
  return root;
}

export async function resolveWorkspacePath(
  context: ToolContext,
  requested: string,
  mode: "existing" | "write",
): Promise<string> {
  const root = await rootFor(context);
  const candidate = path.resolve(root, requested || ".");
  if (!inside(root, candidate))
    throw new Error(`Path escapes the configured workspace: ${requested}`);

  if (mode === "existing") {
    const resolved = await realpath(candidate);
    if (!inside(root, resolved))
      throw new Error(
        `Path resolves outside the configured workspace: ${requested}`,
      );
    return resolved;
  }

  if (await exists(candidate)) {
    if ((await lstat(candidate)).isSymbolicLink())
      throw new Error(
        `Refusing to write through a symbolic link: ${requested}`,
      );
    const resolved = await realpath(candidate);
    if (!inside(root, resolved))
      throw new Error(
        `Path resolves outside the configured workspace: ${requested}`,
      );
    return resolved;
  }

  let ancestor = path.dirname(candidate);
  while (!(await exists(ancestor))) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const resolvedAncestor = await realpath(ancestor);
  if (!inside(root, resolvedAncestor))
    throw new Error(
      `Parent path resolves outside the configured workspace: ${requested}`,
    );
  let cursor = ancestor;
  for (const segment of path
    .relative(ancestor, path.dirname(candidate))
    .split(path.sep)
    .filter(Boolean)) {
    cursor = path.join(cursor, segment);
    if ((await exists(cursor)) && (await lstat(cursor)).isSymbolicLink()) {
      throw new Error(`Refusing to traverse a symbolic link: ${requested}`);
    }
  }
  return candidate;
}

function truncate(
  value: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  const limit = Math.max(1024, Math.min(maxBytes, 4 * 1024 * 1024));
  const buffer = Buffer.from(value);
  if (buffer.length <= limit) return { text: value, truncated: false };
  return {
    text: `${buffer.subarray(0, limit).toString("utf8")}\n[output truncated at ${limit} bytes]`,
    truncated: true,
  };
}

async function textIfPresent(candidate: string): Promise<string | null> {
  if (!(await exists(candidate))) return null;
  const info = await stat(candidate);
  if (!info.isFile()) throw new Error(`Not a file: ${candidate}`);
  if (info.size > MAX_FILE_BYTES)
    throw new Error(`File exceeds ${MAX_FILE_BYTES} byte mutation limit`);
  return readFile(candidate, "utf8");
}

async function atomicWrite(candidate: string, content: string): Promise<void> {
  await mkdir(path.dirname(candidate), { recursive: true });
  const temporary = path.join(
    path.dirname(candidate),
    `.${path.basename(candidate)}.${process.pid}.${Date.now()}.tmp`,
  );
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
  try {
    await rename(temporary, candidate);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function preview(before: string | null, after: string): string {
  if (before === after) return "No content change";
  const left = (before ?? "").split(/\r?\n/);
  const right = after.split(/\r?\n/);
  let line = 0;
  while (
    line < left.length &&
    line < right.length &&
    left[line] === right[line]
  )
    line += 1;
  const removed = left.slice(line, line + 20);
  const added = right.slice(line, line + 20);
  return [
    `@@ line ${line + 1} @@`,
    ...removed.map((value) => `- ${value}`),
    ...added.map((value) => `+ ${value}`),
    removed.length < left.length - line || added.length < right.length - line
      ? "[diff preview truncated]"
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export const createReadTool = (): Tool => ({
  name: "read",
  description:
    "Read a bounded line range from a UTF-8 file inside the configured workspace",
  inputSchema: Z.object({
    path: Z.string().min(1),
    offset: Z.number().int().positive().optional(),
    limit: Z.number().int().positive().max(MAX_READ_LINES).optional(),
    maxBytes: Z.number().int().positive().max(MAX_FILE_BYTES).optional(),
  }),
  execute: async (input, context) => {
    const params = input as {
      path: string;
      offset?: number;
      limit?: number;
      maxBytes?: number;
    };
    const absolute = await resolveWorkspacePath(
      context,
      params.path,
      "existing",
    );
    const info = await stat(absolute);
    if (!info.isFile()) return errorResult(`Not a file: ${params.path}`);
    const maxBytes = params.maxBytes ?? MAX_FILE_BYTES;
    if (info.size > maxBytes)
      return errorResult(`File is ${info.size} bytes; maxBytes is ${maxBytes}`);
    const buffer = await readFile(absolute);
    if (buffer.includes(0))
      return errorResult(`Binary file is not supported: ${params.path}`);
    const lines = buffer.toString("utf8").split(/\r?\n/);
    const start = Math.min(
      Math.max(1, params.offset ?? 1),
      Math.max(1, lines.length),
    );
    const selected = lines.slice(start - 1, start - 1 + (params.limit ?? 200));
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              path: path.relative(await rootFor(context), absolute),
              startLine: start,
              endLine: start + Math.max(0, selected.length - 1),
              totalLines: lines.length,
              truncated: start - 1 + selected.length < lines.length,
              content: selected.join("\n"),
            },
            null,
            2,
          ),
        },
      ],
    };
  },
});

export const createWriteTool = (): Tool => ({
  name: "write",
  description:
    "Atomically write a UTF-8 workspace file and record a reversible mutation",
  inputSchema: Z.object({
    path: Z.string().min(1),
    content: Z.string().max(MAX_FILE_BYTES),
  }),
  authorize: async (_input, context) => ({
    granted: context.agentType !== "plan",
    reason: "Plan agent cannot write files",
  }),
  execute: async (input, context) => {
    const params = input as { path: string; content: string };
    const absolute = await resolveWorkspacePath(context, params.path, "write");
    const before = await textIfPresent(absolute);
    await atomicWrite(absolute, params.content);
    const record = await context.recordMutation?.({
      tool: "write",
      path: absolute,
      before,
      after: params.content,
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              path: params.path,
              bytes: Buffer.byteLength(params.content),
              changeId: record?.changeId,
              diff: preview(before, params.content),
            },
            null,
            2,
          ),
        },
      ],
    };
  },
});

export const createEditTool = (): Tool => ({
  name: "edit",
  description:
    "Replace exact text in a workspace file and record a reversible mutation",
  inputSchema: Z.object({
    path: Z.string().min(1),
    oldText: Z.string().min(1),
    newText: Z.string(),
    replaceAll: Z.boolean().optional(),
  }),
  authorize: async (_input, context) => ({
    granted: context.agentType !== "plan",
    reason: "Plan agent cannot edit files",
  }),
  execute: async (input, context) => {
    const params = input as {
      path: string;
      oldText: string;
      newText: string;
      replaceAll?: boolean;
    };
    const absolute = await resolveWorkspacePath(
      context,
      params.path,
      "existing",
    );
    const before = await textIfPresent(absolute);
    if (before === null)
      return errorResult(`File does not exist: ${params.path}`);
    const occurrences = before.split(params.oldText).length - 1;
    if (!occurrences) return errorResult("oldText was not found");
    if (!params.replaceAll && occurrences !== 1)
      return errorResult(
        `oldText matched ${occurrences} times; provide a unique match or set replaceAll`,
      );
    const after = params.replaceAll
      ? before.split(params.oldText).join(params.newText)
      : before.replace(params.oldText, params.newText);
    if (Buffer.byteLength(after) > MAX_FILE_BYTES)
      return errorResult(`Edited file would exceed ${MAX_FILE_BYTES} bytes`);
    await atomicWrite(absolute, after);
    const record = await context.recordMutation?.({
      tool: "edit",
      path: absolute,
      before,
      after,
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              path: params.path,
              replacements: params.replaceAll ? occurrences : 1,
              changeId: record?.changeId,
              diff: preview(before, after),
            },
            null,
            2,
          ),
        },
      ],
    };
  },
});

function globRegex(glob?: string): RegExp | undefined {
  if (!glob) return undefined;
  const value = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__DS__")
    .replace(/\*/g, "[^/\\\\]*")
    .replace(/\?/g, "[^/\\\\]")
    .replace(/__DS__/g, ".*");
  return new RegExp(`^${value}$`, "i");
}

export const createGrepTool = (): Tool => ({
  name: "grep",
  description:
    "Search files natively without shell interpolation; symlinks and generated directories are skipped",
  inputSchema: Z.object({
    pattern: Z.string().min(1),
    path: Z.string().optional(),
    glob: Z.string().optional(),
    regex: Z.boolean().optional(),
    caseSensitive: Z.boolean().optional(),
    maxResults: Z.number().int().positive().max(MAX_GREP_RESULTS).optional(),
  }),
  execute: async (input, context) => {
    const params = input as {
      pattern: string;
      path?: string;
      glob?: string;
      regex?: boolean;
      caseSensitive?: boolean;
      maxResults?: number;
    };
    const root = await resolveWorkspacePath(
      context,
      params.path ?? ".",
      "existing",
    );
    let matcher: RegExp;
    try {
      matcher = params.regex
        ? new RegExp(params.pattern, params.caseSensitive ? "" : "i")
        : new RegExp(
            params.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            params.caseSensitive ? "" : "i",
          );
    } catch (error) {
      return errorResult(`Invalid search pattern: ${String(error)}`);
    }
    const glob = globRegex(params.glob);
    const workspace = await rootFor(context);
    const maxResults = params.maxResults ?? 100;
    const results: Array<{ path: string; line: number; text: string }> = [];
    let filesVisited = 0;
    const inspect = async (file: string) => {
      if (results.length >= maxResults || filesVisited >= MAX_GREP_FILES)
        return;
      filesVisited += 1;
      const relative = path.relative(workspace, file).split(path.sep).join("/");
      if (glob && !glob.test(relative)) return;
      const info = await stat(file);
      if (!info.isFile() || info.size > MAX_FILE_BYTES) return;
      const buffer = await readFile(file);
      if (buffer.includes(0)) return;
      for (const [index, line] of buffer
        .toString("utf8")
        .split(/\r?\n/)
        .entries()) {
        matcher.lastIndex = 0;
        if (matcher.test(line))
          results.push({ path: relative, line: index + 1, text: line });
        if (results.length >= maxResults) break;
      }
    };
    const walk = async (candidate: string): Promise<void> => {
      if (context.signal?.aborted)
        throw new Error("Tool execution was cancelled");
      const info = await lstat(candidate);
      if (info.isSymbolicLink()) return;
      if (info.isFile()) return inspect(candidate);
      if (!info.isDirectory()) return;
      for (const entry of await readdir(candidate, { withFileTypes: true })) {
        if (IGNORED.has(entry.name)) continue;
        await walk(path.join(candidate, entry.name));
        if (results.length >= maxResults || filesVisited >= MAX_GREP_FILES)
          break;
      }
    };
    await walk(root);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              results,
              count: results.length,
              filesVisited,
              truncated:
                results.length >= maxResults || filesVisited >= MAX_GREP_FILES,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
});

export function classifyCommandRisk(command: string): {
  risk: ToolRisk;
  reason: string;
} {
  const value = command.trim().toLowerCase();
  if (
    [
      /\brm\s+-rf\s+[\\/]($|\s)/,
      /\b(format|diskpart|shutdown|reboot)\b/,
      /\bgit\s+clean\s+.*-[a-z]*f.*[a-z]*d.*[a-z]*x/,
      /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sh|bash|powershell|cmd)\b/,
      /\bpowershell(?:\.exe)?\b.*\s-(?:enc|encodedcommand)\b/,
    ].some((pattern) => pattern.test(value))
  ) {
    return { risk: "critical", reason: "destructive or opaque system command" };
  }
  if (
    [
      /\b(rm|del|rmdir|remove-item)\b/,
      /\bgit\s+(reset|clean|checkout|restore)\b/,
      /\b(npm|pnpm|yarn|bun|pip|cargo)\s+(install|add|remove|uninstall)\b/,
      /\b(chmod|chown|taskkill|kill|reg|sc|net\s+user)\b/,
      />\s*(?:[a-z]:)?[\\/]/,
    ].some((pattern) => pattern.test(value))
  ) {
    return {
      risk: "high",
      reason:
        "command can modify dependencies, files, processes, or system state",
    };
  }
  return { risk: "low", reason: "no high-risk command pattern detected" };
}

function shellFor(command: string): { executable: string; args: string[] } {
  return process.platform === "win32"
    ? {
        executable: process.env.ComSpec || "cmd.exe",
        args: ["/d", "/s", "/c", command],
      }
    : { executable: process.env.SHELL || "/bin/sh", args: ["-lc", command] };
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    }).unref();
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

async function localCommand(
  request: ToolCommandRequest,
): Promise<ToolCommandResult> {
  const startedAt = Date.now();
  const shell = shellFor(request.command);
  return new Promise((resolve, reject) => {
    const child = spawn(shell.executable, shell.args, {
      cwd: request.cwd,
      env: { ...process.env, ...request.environment },
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const append = (target: "stdout" | "stderr", chunk: Buffer) => {
      const current = target === "stdout" ? stdout : stderr;
      const next = truncate(current + chunk.toString(), request.maxOutputBytes);
      truncated ||= next.truncated;
      if (target === "stdout") stdout = next.text;
      else stderr = next.text;
    };
    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", abort);
      resolve({
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        backend: "process-restricted",
        truncated,
      });
    };
    const abort = () => {
      killTree(child);
      finish(130);
    };
    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.on("error", reject);
    child.on("exit", (code) => finish(code ?? 1));
    request.signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => {
      killTree(child);
      finish(124);
    }, request.timeoutMs);
  });
}

export const createBashTool = (): Tool => ({
  name: "bash",
  description:
    "Execute a platform shell command with risk approval, sandbox routing, bounded output, timeout, and process-tree cancellation",
  inputSchema: Z.object({
    command: Z.string().min(1).max(32_768),
    timeout: Z.number().int().positive().max(600_000).optional(),
    sandbox: Z.enum(["auto", "docker", "process", "off"]).optional(),
    networkDisabled: Z.boolean().optional(),
  }),
  authorize: async (_input, context) => ({
    granted: context.agentType !== "plan",
    reason: "Plan agent cannot execute commands",
  }),
  execute: async (input, context) => {
    const params = input as {
      command: string;
      timeout?: number;
      sandbox?: "auto" | "docker" | "process" | "off";
      networkDisabled?: boolean;
    };
    const risk = classifyCommandRisk(params.command);
    if (risk.risk === "high" || risk.risk === "critical") {
      const approved = await context.requestApproval?.({
        tool: "bash",
        action: "execute_command",
        risk: risk.risk,
        summary: risk.reason,
        command: params.command,
      });
      if (!approved)
        return errorResult(
          `Command approval was denied or unavailable (${risk.risk}: ${risk.reason})`,
        );
    }
    const request: ToolCommandRequest = {
      command: params.command,
      cwd: await rootFor(context),
      environment: context.environment,
      timeoutMs: params.timeout ?? 120_000,
      maxOutputBytes: context.outputLimitBytes ?? 128 * 1024,
      signal: context.signal,
      sandbox: params.sandbox ?? context.sandbox ?? "auto",
      networkDisabled:
        params.networkDisabled ?? context.networkDisabled ?? false,
    };
    const result = context.executeCommand
      ? await context.executeCommand(request)
      : await localCommand(request);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: result.exitCode !== 0,
    };
  },
});
