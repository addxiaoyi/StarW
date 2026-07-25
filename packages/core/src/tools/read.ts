import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "./types";

const MAX_READ_BYTES = 1024 * 1024;

export const definition: ToolDefinition = {
  name: "read",
  description: "Read the contents of a file or list a directory.",
  parameters: {
    path: {
      type: "string",
      description: "Relative or absolute path to the file or directory",
      required: true,
    },
    offset: {
      type: "number",
      description: "Line offset to start reading from (1-based). Only for files.",
      required: false,
    },
    limit: {
      type: "number",
      description: "Maximum number of lines to read. Only for files.",
      required: false,
    },
  },
};

export interface ReadInput {
  path: string;
  offset?: number;
  limit?: number;
}

export interface ReadOutput {
  path: string;
  type: "file" | "directory";
  content?: string;
  entries?: string[];
  truncated?: boolean;
  lines?: number;
}

function resolvePath(inputPath: string, context: ToolContext): string {
  if (path.isAbsolute(inputPath)) return inputPath;
  const base = context.workdir || context.cwd;
  return path.resolve(base, inputPath);
}

export const execute: ToolExecutor<ReadInput, ReadOutput> = async (input, context) => {
  const target = resolvePath(input.path, context);

  try {
    const stat = await fs.stat(target);

    if (stat.isDirectory()) {
      const entries = await fs.readdir(target);
      return {
        success: true,
        output: { path: target, type: "directory", entries: entries.slice(0, 200) },
      };
    }

    const handle = await fs.open(target, "r");
    try {
      const buffer = Buffer.alloc(MAX_READ_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, MAX_READ_BYTES, 0);
      let content = buffer.toString("utf8", 0, bytesRead);
      const truncated = bytesRead === MAX_READ_BYTES;
      const allLines = content.split("\n");
      const offset = Math.max(0, (input.offset || 1) - 1);
      const limit = input.limit ?? allLines.length;
      const selectedLines = allLines.slice(offset, offset + limit);

      return {
        success: true,
        output: {
          path: target,
          type: "file",
          content: selectedLines.join("\n"),
          truncated,
          lines: allLines.length,
        },
      };
    } finally {
      await handle.close();
    }
  } catch (err) {
    return {
      success: false,
      output: { path: target, type: "file" },
      error: err instanceof Error ? err.message : String(err),
    };
  }
};
