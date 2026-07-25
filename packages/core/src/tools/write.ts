import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "./types";

export const definition: ToolDefinition = {
  name: "write",
  description: "Create or overwrite a file with the provided content.",
  parameters: {
    path: {
      type: "string",
      description: "Relative or absolute path to the file",
      required: true,
    },
    content: {
      type: "string",
      description: "Full content to write",
      required: true,
    },
  },
};

export interface WriteInput {
  path: string;
  content: string;
}

export interface WriteOutput {
  path: string;
  bytes: number;
}

function resolvePath(inputPath: string, context: ToolContext): string {
  if (path.isAbsolute(inputPath)) return inputPath;
  const base = context.workdir || context.cwd;
  return path.resolve(base, inputPath);
}

export const execute: ToolExecutor<WriteInput, WriteOutput> = async (input, context) => {
  const target = resolvePath(input.path, context);

  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const buffer = Buffer.from(input.content, "utf8");
    await fs.writeFile(target, buffer);

    return {
      success: true,
      output: { path: target, bytes: buffer.length },
    };
  } catch (err) {
    return {
      success: false,
      output: { path: target, bytes: 0 },
      error: err instanceof Error ? err.message : String(err),
    };
  }
};
