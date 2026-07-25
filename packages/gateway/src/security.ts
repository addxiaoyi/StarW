import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_EXECUTABLES = [
  "echo",
  "git",
  "node",
  "bun",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "rg",
  "grep",
  "find",
  "where",
  "ls",
  "pwd",
];

const SHELL_META = /[\0\r\n;&|<>`]|\$\(/;
const SECRET_KEY = /(api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret|private[_-]?key|client[_-]?secret|authorization|cookie)/i;

export interface PreparedCommand {
  executable: string;
  args: string[];
}

export interface PathCheckResult {
  allowed: boolean;
  path?: string;
  reason?: string;
}

function allowedExecutables(): Set<string> {
  const configured = (process.env.OPENSTAR_ALLOWED_COMMANDS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_EXECUTABLES, ...configured]);
}

function executableName(value: string): string {
  return path.basename(value).replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function parseCommandLine(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (const char of command.trim()) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }

  if (quote) throw new Error("Unterminated quoted argument");
  if (current) tokens.push(current);
  return tokens;
}

export function prepareCommand(command: string): PreparedCommand {
  if (typeof command !== "string" || !command.trim()) throw new Error("Command is required");
  if (command.length > 4096) throw new Error("Command exceeds 4096 characters");
  if (SHELL_META.test(command)) throw new Error("Shell operators and control characters are not allowed");

  const [executable, ...args] = parseCommandLine(command);
  if (!executable) throw new Error("Command is required");
  if (path.isAbsolute(executable) || executable.includes("/") || executable.includes("\\")) {
    throw new Error("Executable paths are not allowed");
  }

  const name = executableName(executable);
  if (!allowedExecutables().has(name)) throw new Error(`Executable "${name}" is not allowed`);
  return { executable: name === "echo" ? "echo" : executable, args };
}

export function resolveWorkspacePath(workspaceRoot: string, targetPath: string): PathCheckResult {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, targetPath || ".");
  if (!isWithin(root, target)) {
    return { allowed: false, reason: `Path "${target}" is outside the workspace root` };
  }
  return { allowed: true, path: target };
}

export async function resolveReadablePath(workspaceRoot: string, targetPath: string): Promise<PathCheckResult> {
  const lexical = resolveWorkspacePath(workspaceRoot, targetPath);
  if (!lexical.allowed || !lexical.path) return lexical;

  try {
    const [realRoot, realTarget] = await Promise.all([fs.realpath(path.resolve(workspaceRoot)), fs.realpath(lexical.path)]);
    if (!isWithin(realRoot, realTarget)) {
      return { allowed: false, reason: `Path ${realTarget} escapes the workspace through a symbolic link` };
    }
    return { allowed: true, path: realTarget };
  } catch (error) {
    return { allowed: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => redactSecrets(entry)) as T;
  if (!value || typeof value !== "object") return value;

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SECRET_KEY.test(key) && entry != null ? "[REDACTED]" : redactSecrets(entry);
  }
  return output as T;
}
