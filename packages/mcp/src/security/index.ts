/** Shared MCP command and workspace security policy. */
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_COMMANDS = [
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

export interface SecurityCheckResult {
  allowed: boolean;
  reason?: string;
  path?: string;
}

export interface PreparedCommand {
  executable: string;
  args: string[];
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function getAllowedPaths(): string[] {
  const configured = process.env.OPENSTAR_WORKSPACE_ROOTS;
  const roots = configured
    ? configured.split(path.delimiter)
    : [process.env.OPENSTAR_WORKSPACE_ROOT ?? process.cwd()];
  return [...new Set(roots.map((root) => path.resolve(root.trim())).filter(Boolean))];
}

function tokenize(command: string): string[] {
  const values: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (const char of command.trim()) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        values.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }

  if (quote) throw new Error("Unterminated quoted argument");
  if (current) values.push(current);
  return values;
}

export function prepareCommandExecution(command: string): PreparedCommand {
  if (typeof command !== "string" || !command.trim()) throw new Error("Command is required");
  if (command.length > 4096) throw new Error("Command exceeds 4096 characters");
  if (SHELL_META.test(command)) throw new Error("Shell operators and control characters are not allowed");

  const [executable, ...args] = tokenize(command);
  if (!executable) throw new Error("Command is required");
  if (path.isAbsolute(executable) || executable.includes("/") || executable.includes("\\")) {
    throw new Error("Executable paths are not allowed");
  }

  const name = path.basename(executable).replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();
  const configured = (process.env.OPENSTAR_ALLOWED_COMMANDS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (!new Set([...DEFAULT_COMMANDS, ...configured]).has(name)) {
    throw new Error(`Executable "${name}" is not allowed`);
  }

  return { executable: name === "echo" ? "echo" : executable, args };
}

export function checkCommandSecurity(command: string): SecurityCheckResult {
  try {
    prepareCommandExecution(command);
    return { allowed: true };
  } catch (error) {
    return { allowed: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export function checkPathSecurity(
  targetPath: string,
  allowedPaths: string[] = getAllowedPaths(),
): SecurityCheckResult {
  const target = path.resolve(targetPath);
  const root = allowedPaths.map((entry) => path.resolve(entry)).find((entry) => isWithin(entry, target));
  return root
    ? { allowed: true, path: target }
    : { allowed: false, reason: `Path "${target}" is outside the allowed workspace roots` };
}

export async function resolvePathSecurity(
  targetPath: string,
  options: { allowedPaths?: string[]; allowMissing?: boolean } = {},
): Promise<SecurityCheckResult> {
  const allowedPaths = options.allowedPaths ?? getAllowedPaths();
  const lexical = checkPathSecurity(targetPath, allowedPaths);
  if (!lexical.allowed || !lexical.path) return lexical;

  const lexicalRoot = allowedPaths
    .map((entry) => path.resolve(entry))
    .find((entry) => isWithin(entry, lexical.path!));
  if (!lexicalRoot) return { allowed: false, reason: "No matching workspace root" };

  try {
    const realRoot = await fs.realpath(lexicalRoot);
    try {
      const realTarget = await fs.realpath(lexical.path);
      return isWithin(realRoot, realTarget)
        ? { allowed: true, path: realTarget }
        : { allowed: false, reason: `Path "${realTarget}" escapes the workspace through a symbolic link` };
    } catch (error) {
      if (!options.allowMissing) throw error;

      let ancestor = path.dirname(lexical.path);
      while (true) {
        try {
          const realAncestor = await fs.realpath(ancestor);
          return isWithin(realRoot, realAncestor)
            ? { allowed: true, path: lexical.path }
            : { allowed: false, reason: `Parent path "${realAncestor}" escapes the workspace` };
        } catch {
          const parent = path.dirname(ancestor);
          if (parent === ancestor) break;
          ancestor = parent;
        }
      }

      return { allowed: false, reason: "No existing parent inside the workspace" };
    }
  } catch (error) {
    return { allowed: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export function validateCommandExecution(command: string, cwd?: string): SecurityCheckResult {
  const commandCheck = checkCommandSecurity(command);
  if (!commandCheck.allowed) return commandCheck;
  if (cwd) return checkPathSecurity(cwd);
  return { allowed: true };
}
