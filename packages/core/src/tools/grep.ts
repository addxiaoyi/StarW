import { execFile } from "node:child_process";
import path from "node:path";
import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "./types";

const MAX_RESULTS = 200;

export const definition: ToolDefinition = {
  name: "grep",
  description: "Search file contents using ripgrep or fallback grep.",
  parameters: {
    pattern: {
      type: "string",
      description: "Search pattern (regex supported)",
      required: true,
    },
    path: {
      type: "string",
      description: "Directory or file to search. Defaults to cwd.",
      required: false,
    },
    glob: {
      type: "string",
      description: "Glob filter, e.g. '*.ts'",
      required: false,
    },
    caseSensitive: {
      type: "boolean",
      description: "Case sensitive search. Defaults to true.",
      required: false,
    },
  },
};

export interface GrepInput {
  pattern: string;
  path?: string;
  glob?: string;
  caseSensitive?: boolean;
}

export interface GrepMatch {
  path: string;
  line: number;
  column: number;
  text: string;
}

export interface GrepOutput {
  matches: GrepMatch[];
  truncated: boolean;
}

function resolvePath(inputPath: string | undefined, context: ToolContext): string {
  const base = inputPath || context.workdir || context.cwd;
  if (path.isAbsolute(base)) return base;
  return path.resolve(context.cwd, base);
}

function runRipgrep(input: GrepInput, target: string): Promise<ToolResult<GrepOutput>> {
  return new Promise((resolve) => {
    const args = ["--json", "--line-number", "--column"];
    if (input.glob) args.push("--glob", input.glob);
    if (input.caseSensitive === false) args.push("--ignore-case");
    args.push(input.pattern, target);

    execFile("rg", args, { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      const matches: GrepMatch[] = [];
      for (const line of stdout.split("\n")) {
        if (!line.startsWith("{")) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type === "match" && obj.data) {
            const m = obj.data;
            const text = m.lines?.text?.replace(/\r?\n$/, "") || "";
            matches.push({
              path: m.path?.text || target,
              line: m.line_number || 0,
              column: m.submatches?.[0]?.start || 0,
              text,
            });
          }
        } catch {
          // ignore malformed json
        }
      }

      resolve({
        success: !err || matches.length > 0,
        output: { matches: matches.slice(0, MAX_RESULTS), truncated: matches.length > MAX_RESULTS },
        error: err && matches.length === 0 ? err.message : undefined,
      });
    });
  });
}

export const execute: ToolExecutor<GrepInput, GrepOutput> = async (input, context) => {
  const target = resolvePath(input.path, context);
  return runRipgrep(input, target);
};
