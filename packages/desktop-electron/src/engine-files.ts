import fs from "node:fs";
import path from "node:path";

export interface WorkspaceFileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  modifiedAt: number;
  symlink: boolean;
}

export function safeRelativePath(workspace: string, requested = "."): string {
  const resolved = path.resolve(workspace, requested);
  const relative = path.relative(workspace, resolved);
  const escapesWorkspace =
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative);
  if (!escapesWorkspace) return resolved;
  throw new Error(`Path escapes the configured workspace: ${requested}`);
}

export function fileEntry(
  absolute: string,
  workspace: string,
): WorkspaceFileEntry {
  const stat = fs.lstatSync(absolute);
  return {
    name: path.basename(absolute),
    path: path.relative(workspace, absolute).replaceAll("\\", "/") || ".",
    type: stat.isDirectory() ? "directory" : "file",
    size: stat.isFile() ? stat.size : undefined,
    modifiedAt: stat.mtimeMs,
    symlink: stat.isSymbolicLink(),
  };
}
