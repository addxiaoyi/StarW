import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition, ToolExecutor, ToolContext, ToolResult } from "./types";

export const definition: ToolDefinition = {
  name: "edit",
  description: "Apply a string replacement in a file. Replaces the first occurrence by default.",
  parameters: {
    path: {
      type: "string",
      description: "Relative or absolute path to the file",
      required: true,
    },
    oldString: {
      type: "string",
      description: "Exact text to replace",
      required: true,
    },
    newString: {
      type: "string",
      description: "Replacement text",
      required: true,
    },
    all: {
      type: "boolean",
      description: "Replace all occurrences",
      required: false,
    },
  },
};

export interface EditInput {
  path: string;
  oldString: string;
  newString: string;
  all?: boolean;
}

export interface EditOutput {
  path: string;
  replacements: number;
  bytes: number;
}

function resolvePath(inputPath: string, context: ToolContext): string {
  if (path.isAbsolute(inputPath)) return inputPath;
  const base = context.workdir || context.cwd;
  return path.resolve(base, inputPath);
}

export const execute: ToolExecutor<EditInput, EditOutput> = async (input, context) => {
  const target = resolvePath(input.path, context);

  try {
    const original = await fs.readFile(target, "utf8");
    let content = original;
    let replacements = 0;

    if (input.all) {
      const parts = content.split(input.oldString);
      replacements = parts.length - 1;
      content = parts.join(input.newString);
    } else {
      const index = content.indexOf(input.oldString);
      if (index !== -1) {
        content = content.slice(0, index) + input.newString + content.slice(index + input.oldString.length);
        replacements = 1;
      }
    }

    if (replacements === 0) {
      return {
        success: false,
        output: { path: target, replacements: 0, bytes: 0 },
        error: "oldString not found in file",
      };
    }

    const buffer = Buffer.from(content, "utf8");
    await fs.writeFile(target, buffer);

    return {
      success: true,
      output: { path: target, replacements, bytes: buffer.length },
    };
  } catch (err) {
    return {
      success: false,
      output: { path: target, replacements: 0, bytes: 0 },
      error: err instanceof Error ? err.message : String(err),
    };
  }
};
