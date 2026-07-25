/** Workspace-confined MCP filesystem tools. */
import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import { z } from "zod";
import type { ToolDefinition } from "../core/types.js";
import { resolvePathSecurity } from "../security/index.js";

const MAX_READ_BYTES = 4 * 1024 * 1024;
const SENSITIVE_PATH =
  /(^|\/)(\.ssh|\.aws|\.gnupg|\.config\/gcloud)(\/|$)|(^|\/)(\.env(?!\.example$)|\.npmrc|\.netrc|id_rsa|id_dsa|credentials)(\/|$)/i;

function isSensitive(targetPath: string): boolean {
  return SENSITIVE_PATH.test(targetPath.replace(/\\/g, "/"));
}

async function secure(targetPath: string, allowMissing = false) {
  const absolute = path.resolve(targetPath);
  if (isSensitive(absolute)) {
    return { allowed: false, reason: "Sensitive credential paths are not accessible" };
  }
  return resolvePathSecurity(absolute, { allowMissing });
}

function denied(pathValue: unknown, reason?: string) {
  return { success: false, error: reason ?? "Access denied", path: pathValue };
}

export const filesystemTools: ToolDefinition[] = [
  {
    name: "read_file",
    description: "Read a UTF-8 file inside the configured workspace roots",
    inputSchema: z.object({ path: z.string(), encoding: z.string().optional() }),
    handler: async (args) => {
      const checked = await secure(String(args.path));
      if (!checked.allowed || !checked.path) return denied(args.path, checked.reason);
      try {
        const stat = await fs.stat(checked.path);
        if (!stat.isFile()) return denied(args.path, "Path is not a file");
        if (stat.size > MAX_READ_BYTES) return denied(args.path, `File exceeds ${MAX_READ_BYTES} byte limit`);
        const content = await fs.readFile(
          checked.path,
          ((args.encoding as string) || "utf-8") as BufferEncoding,
        );
        return { success: true, path: checked.path, content: content.toString(), size: content.length };
      } catch (error) {
        return denied(args.path, (error as Error).message);
      }
    },
  },
  {
    name: "write_file",
    description: "Write a file inside the configured workspace roots",
    inputSchema: z.object({ path: z.string(), content: z.string(), encoding: z.string().optional() }),
    handler: async (args) => {
      const checked = await secure(String(args.path), true);
      if (!checked.allowed || !checked.path) return denied(args.path, checked.reason);
      try {
        await fs.writeFile(
          checked.path,
          String(args.content),
          ((args.encoding as string) || "utf-8") as BufferEncoding,
        );
        return { success: true, path: checked.path, size: String(args.content).length };
      } catch (error) {
        return denied(args.path, (error as Error).message);
      }
    },
  },
  {
    name: "append_file",
    description: "Append UTF-8 content inside the configured workspace roots",
    inputSchema: z.object({ path: z.string(), content: z.string() }),
    handler: async (args) => {
      const checked = await secure(String(args.path), true);
      if (!checked.allowed || !checked.path) return denied(args.path, checked.reason);
      try {
        await fs.appendFile(checked.path, String(args.content), "utf-8");
        return { success: true, path: checked.path };
      } catch (error) {
        return denied(args.path, (error as Error).message);
      }
    },
  },
  {
    name: "list_directory",
    description: "List one directory inside the configured workspace roots",
    inputSchema: z.object({ path: z.string().optional(), recursive: z.boolean().optional() }),
    handler: async (args) => {
      const target = String(args.path ?? process.cwd());
      const checked = await secure(target);
      if (!checked.allowed || !checked.path) return denied(target, checked.reason);
      try {
        const entries = await fs.readdir(checked.path, { withFileTypes: true });
        const items = entries.map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? "directory" : "file",
          path: path.join(checked.path!, entry.name),
        }));
        return { success: true, path: checked.path, entries: items, count: items.length };
      } catch (error) {
        return denied(target, (error as Error).message);
      }
    },
  },
  {
    name: "create_directory",
    description: "Create a directory inside the configured workspace roots",
    inputSchema: z.object({ path: z.string(), recursive: z.boolean().optional() }),
    handler: async (args) => {
      const checked = await secure(String(args.path), true);
      if (!checked.allowed || !checked.path) return denied(args.path, checked.reason);
      try {
        await fs.mkdir(checked.path, { recursive: args.recursive !== false });
        return { success: true, path: checked.path };
      } catch (error) {
        return denied(args.path, (error as Error).message);
      }
    },
  },
  {
    name: "delete_file",
    description: "Delete one file inside the configured workspace roots",
    inputSchema: z.object({ path: z.string(), force: z.boolean().optional() }),
    handler: async (args) => {
      const checked = await secure(String(args.path));
      if (!checked.allowed || !checked.path) return denied(args.path, checked.reason);
      try {
        const stat = await fs.lstat(checked.path);
        if (stat.isDirectory()) return denied(args.path, "Directory deletion is not supported by this tool");
        await fs.rm(checked.path, { force: Boolean(args.force) });
        return { success: true, path: checked.path };
      } catch (error) {
        return denied(args.path, (error as Error).message);
      }
    },
  },
  {
    name: "copy_file",
    description: "Copy a file within configured workspace roots",
    inputSchema: z.object({ source: z.string(), destination: z.string() }),
    handler: async (args) => {
      const source = await secure(String(args.source));
      const destination = await secure(String(args.destination), true);
      if (!source.allowed || !source.path) return denied(args.source, source.reason);
      if (!destination.allowed || !destination.path) return denied(args.destination, destination.reason);
      try {
        await fs.copyFile(source.path, destination.path);
        return { success: true, source: source.path, destination: destination.path };
      } catch (error) {
        return denied(args.destination, (error as Error).message);
      }
    },
  },
  {
    name: "move_file",
    description: "Move a file within configured workspace roots",
    inputSchema: z.object({ source: z.string(), destination: z.string() }),
    handler: async (args) => {
      const source = await secure(String(args.source));
      const destination = await secure(String(args.destination), true);
      if (!source.allowed || !source.path) return denied(args.source, source.reason);
      if (!destination.allowed || !destination.path) return denied(args.destination, destination.reason);
      try {
        await fs.rename(source.path, destination.path);
        return { success: true, source: source.path, destination: destination.path };
      } catch (error) {
        return denied(args.destination, (error as Error).message);
      }
    },
  },
  {
    name: "get_file_info",
    description: "Get metadata for a path inside configured workspace roots",
    inputSchema: z.object({ path: z.string() }),
    handler: async (args) => {
      const checked = await secure(String(args.path));
      if (!checked.allowed || !checked.path) return denied(args.path, checked.reason);
      try {
        const stat = await fs.stat(checked.path);
        return {
          success: true,
          path: checked.path,
          size: stat.size,
          created: stat.birthtime,
          modified: stat.mtime,
          isDirectory: stat.isDirectory(),
          isFile: stat.isFile(),
        };
      } catch (error) {
        return denied(args.path, (error as Error).message);
      }
    },
  },
  {
    name: "search_files",
    description: "Search files with a relative glob inside configured workspace roots",
    inputSchema: z.object({ pattern: z.string(), directory: z.string().optional() }),
    handler: async (args) => {
      const pattern = String(args.pattern);
      if (path.isAbsolute(pattern) || pattern.split(/[\\/]/).includes("..")) {
        return {
          success: false,
          error: "Glob patterns must be relative and cannot contain parent traversal",
          pattern,
          files: [],
          count: 0,
        };
      }
      const directory = String(args.directory ?? process.cwd());
      const checked = await secure(directory);
      if (!checked.allowed || !checked.path) {
        return { ...denied(directory, checked.reason), pattern, files: [], count: 0 };
      }
      try {
        const files = await glob(pattern, {
          cwd: checked.path,
          absolute: false,
          follow: false,
          dot: false,
          nodir: true,
        });
        return { success: true, pattern, directory: checked.path, files, count: files.length };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          pattern,
          directory: checked.path,
          files: [],
          count: 0,
        };
      }
    },
  },
];
