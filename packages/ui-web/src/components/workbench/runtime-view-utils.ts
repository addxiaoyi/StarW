export const LARGE_FILE_WARNING_BYTES = 1024 * 1024;
export const MAX_FILE_PREVIEW_BYTES = 5 * 1024 * 1024;

const GENERATED_ROOT_ENTRY_NAMES = new Set([
  ".cache",
  ".git",
  ".tmp",
  ".turbo",
  ".vite",
  "%systemdrive%",
  "coverage",
  "dist",
  "node_modules",
  "nvidia corporation",
]);

export interface WorkspaceBreadcrumb {
  label: string;
  path: string;
}

export interface TextMatch {
  start: number;
  end: number;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isGeneratedWorkspaceEntry(
  name: string,
  currentPath: string,
): boolean {
  if (currentPath !== ".") return false;
  return GENERATED_ROOT_ENTRY_NAMES.has(name.trim().toLowerCase());
}

export function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export function formatBytes(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

export function joinWorkspacePath(parent: string, name: string): string {
  const cleanName = name.trim().replaceAll("\\", "/").replace(/^\/+/, "");
  if (!cleanName) return "";
  return parent === "."
    ? cleanName
    : `${parent.replace(/\/$/, "")}/${cleanName}`;
}

export function parentWorkspacePath(currentPath: string): string {
  const value = currentPath.replaceAll("\\", "/");
  if (!value || value === ".") return ".";
  const parts = value
    .split("/")
    .filter((part) => Boolean(part) && part !== ".");
  parts.pop();
  return parts.length ? parts.join("/") : ".";
}

export function workspaceBreadcrumbs(
  currentPath: string,
  workspaceLabel: string,
): WorkspaceBreadcrumb[] {
  const parts = currentPath
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => Boolean(part) && part !== ".");
  return [
    { label: workspaceLabel || "workspace", path: "." },
    ...parts.map((label, index) => ({
      label,
      path: parts.slice(0, index + 1).join("/"),
    })),
  ];
}

export function findNextTextMatch(
  source: string,
  query: string,
  selectionEnd: number,
  previousMatchEnd: number,
): TextMatch | null {
  if (!query) return null;
  const start = Math.max(selectionEnd, previousMatchEnd);
  let index = source.indexOf(query, start);
  if (index < 0) index = source.indexOf(query);
  return index < 0 ? null : { start: index, end: index + query.length };
}
