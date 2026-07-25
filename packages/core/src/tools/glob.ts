import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "./types";

const MAX_RESULTS = 1000;

export const definition: ToolDefinition = {
  name: "glob",
  description: "List files matching a glob pattern under a directory.",
  parameters: {
    pattern: {
      type: "string",
      description: "Glob pattern, e.g. '*.ts' or '**/*.md'. Supports * and **.",
      required: true,
    },
    path: {
      type: "string",
      description: "Directory to search. Defaults to cwd.",
      required: false,
    },
    absolute: {
      type: "boolean",
      description: "Return absolute paths. Defaults to false.",
      required: false,
    },
  },
};

export interface GlobInput {
  pattern: string;
  path?: string;
  absolute?: boolean;
}

export interface GlobOutput {
  matches: string[];
  truncated: boolean;
}

function resolveBase(inputPath: string | undefined, context: ToolContext): string {
  const base = inputPath || context.workdir || context.cwd;
  if (path.isAbsolute(base)) return base;
  return path.resolve(context.cwd, base);
}

function segmentMatches(name: string, pattern: string): boolean {
  const regex = new RegExp(
    "^" +
      pattern
        .replace(/\*\*/g, "{{GLOBSTAR}}")
        .replace(/\./g, "\\.")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, ".")
        .replace(/\{\{GLOBSTAR\}\}/g, ".*") +
      "$"
  );
  return regex.test(name);
}

function matchPattern(relativePath: string, pattern: string): boolean {
  if (!pattern.includes("/")) {
    return segmentMatches(path.basename(relativePath), pattern);
  }

  const parts = pattern.split("/");
  const names = relativePath.split(path.sep);

  let pi = 0;
  let ni = 0;

  while (pi < parts.length && ni < names.length) {
    const part = parts[pi];
    const name = names[ni];

    if (part === "**") {
      if (pi === parts.length - 1) return true;
      const nextPart = parts[pi + 1];
      while (ni < names.length && !segmentMatches(names[ni], nextPart)) {
        ni++;
      }
      if (ni >= names.length) return false;
      pi += 2;
      continue;
    }

    if (!segmentMatches(name, part)) return false;
    pi++;
    ni++;
  }

  return pi === parts.length && ni === names.length;
}

async function globFiles(base: string, pattern: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string, relativePrefix: string) {
    if (results.length >= MAX_RESULTS) return;

    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= MAX_RESULTS) return;
      if (entry.name === "node_modules" || entry.name === ".git") continue;

      const rel = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (pattern.includes("**") || pattern.includes("/")) {
          await walk(full, rel);
        }
      } else if (entry.isFile()) {
        if (matchPattern(rel, pattern) || matchPattern(entry.name, pattern)) {
          results.push(rel);
        }
      }
    }
  }

  await walk(base, "");
  return results;
}

export const execute: ToolExecutor<GlobInput, GlobOutput> = async (input, context) => {
  const base = resolveBase(input.path, context);

  try {
    const matches = await globFiles(base, input.pattern);
    const output = input.absolute
      ? matches.map((m) => path.resolve(base, m))
      : matches;

    return {
      success: true,
      output: { matches: output.slice(0, MAX_RESULTS), truncated: matches.length > MAX_RESULTS },
    };
  } catch (err) {
    return {
      success: false,
      output: { matches: [], truncated: false },
      error: err instanceof Error ? err.message : String(err),
    };
  }
};
