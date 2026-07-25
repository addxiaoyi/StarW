import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type { SkillDefinition } from "../types/skill";

export interface DiscoveredSkill {
  sourcePath: string;
  skill: SkillDefinition;
}

export interface SkillDiscoveryOptions {
  includeHidden?: boolean;
  maxDepth?: number;
}

const DEFAULT_MAX_DEPTH = 10;

function fileNameToId(filepath: string, root: string): string {
  const relative = path.relative(root, filepath);
  const dir = path.dirname(relative);
  const base = path.basename(filepath, ".md");
  if (dir === ".") return base;
  return path.join(dir, base).replace(/[\\/]+/g, "/");
}

function inferName(filepath: string, root: string, frontmatterName?: string): string {
  if (frontmatterName) return frontmatterName;
  const relative = path.relative(root, filepath);
  const dir = path.dirname(relative);
  if (dir !== "." && path.basename(filepath) === "SKILL.md") {
    return path.basename(dir);
  }
  return path.basename(filepath, ".md");
}

export function parseSkillMarkdown(
  filepath: string,
  root: string,
  content: string
): SkillDefinition | null {
  const parsed = matter(content);
  const data = parsed.data || {};
  const name = inferName(filepath, root, data.name);

  if (!name) return null;

  const id = data.id || fileNameToId(filepath, root);
  const tags: string[] = Array.isArray(data.tags) ? data.tags : [];
  if (data.origin && !tags.includes(data.origin)) tags.push(data.origin);

  return {
    id,
    name,
    version: data.version || "1.0.0",
    description: data.description || "",
    author: data.author || data.origin || "",
    tags,
    entryPoint: filepath,
    systemPromptAddon: parsed.content,
    tools: Array.isArray(data.tools) ? data.tools : [],
    dependencies: Array.isArray(data.dependencies) ? data.dependencies : [],
    enabled: data.enabled !== false,
  };
}

async function* walkMarkdown(
  dir: string,
  options: SkillDiscoveryOptions,
  depth = 0
): AsyncGenerator<string> {
  if (depth > (options.maxDepth ?? DEFAULT_MAX_DEPTH)) return;

  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    if (!options.includeHidden && entry.name.startsWith(".")) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      yield* walkMarkdown(full, options, depth + 1);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      yield full;
    }
  }
}

export async function discoverSkills(
  root: string,
  options: SkillDiscoveryOptions = {}
): Promise<DiscoveredSkill[]> {
  const resolvedRoot = path.resolve(root);
  const results: DiscoveredSkill[] = [];

  try {
    const stat = await fs.stat(resolvedRoot);
    if (!stat.isDirectory()) return results;
  } catch {
    return results;
  }

  for await (const filepath of walkMarkdown(resolvedRoot, options)) {
    try {
      const content = await fs.readFile(filepath, "utf8");
      const skill = parseSkillMarkdown(filepath, resolvedRoot, content);
      if (!skill) continue;
      results.push({ sourcePath: filepath, skill });
    } catch {
      // skip unreadable files
    }
  }

  return results.sort((a, b) => a.skill.id.localeCompare(b.skill.id));
}

export async function discoverSkillFile(filepath: string): Promise<DiscoveredSkill | null> {
  const resolved = path.resolve(filepath);
  try {
    const content = await fs.readFile(resolved, "utf8");
    const root = path.dirname(resolved);
    const skill = parseSkillMarkdown(resolved, root, content);
    if (!skill) return null;
    return { sourcePath: resolved, skill };
  } catch {
    return null;
  }
}
