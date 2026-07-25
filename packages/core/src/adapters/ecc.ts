import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import matter from "gray-matter";
import type { AgentDefinition } from "../types/agent";
import type { SkillDefinition } from "../types/skill";

export interface EccManifest {
  spec_version: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  model?: {
    preferred?: string;
    fallback?: string[];
  };
  skills?: string[];
  commands?: string[];
  tags?: string[];
}

export interface EccAdapterResult {
  manifest: EccManifest;
  skills: SkillDefinition[];
  commands: SkillDefinition[];
  agents: AgentDefinition[];
}

const SKILL_DIRS = [".kiro/skills", ".cursor/skills", ".agents/skills", "skills"];
const AGENT_DIRS = ["agents", ".kiro/agents", ".cursor/agents", ".agents"];

export async function loadEccManifest(manifestPath: string): Promise<EccManifest | null> {
  try {
    const content = await fs.readFile(manifestPath, "utf8");
    const parsed = YAML.parse(content);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as EccManifest;
  } catch {
    return null;
  }
}

function skillIdFromName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-");
}

async function findSkillFile(root: string, skillName: string): Promise<string | null> {
  for (const dir of SKILL_DIRS) {
    const candidates = [
      path.join(root, dir, skillName, "SKILL.md"),
      path.join(root, dir, `${skillName}.md`),
      path.join(root, dir, skillName, `${skillName}.md`),
    ];
    for (const candidate of candidates) {
      try {
        const stat = await fs.stat(candidate);
        if (stat.isFile()) return candidate;
      } catch {
        // continue
      }
    }
  }
  return null;
}

async function loadSkillFromFile(
  skillName: string,
  filepath: string,
  origin: string
): Promise<SkillDefinition> {
  const content = await fs.readFile(filepath, "utf8");
  const parsed = matter(content);
  const data = parsed.data || {};

  const tags: string[] = Array.isArray(data.tags) ? data.tags : [];
  if (!tags.includes(origin)) tags.push(origin);

  return {
    id: data.id || skillIdFromName(skillName),
    name: data.name || skillName,
    version: data.version || "1.0.0",
    description: data.description || `ECC skill: ${skillName}`,
    author: data.author || origin,
    tags,
    entryPoint: filepath,
    systemPromptAddon: parsed.content,
    tools: Array.isArray(data.tools) ? data.tools : [],
    dependencies: Array.isArray(data.dependencies) ? data.dependencies : [],
    enabled: data.enabled !== false,
  };
}

async function loadSkill(
  root: string,
  skillName: string,
  manifest: EccManifest
): Promise<SkillDefinition> {
  const filepath = await findSkillFile(root, skillName);
  if (filepath) {
    return loadSkillFromFile(skillName, filepath, manifest.name);
  }

  return {
    id: skillIdFromName(skillName),
    name: skillName,
    version: manifest.version || "1.0.0",
    description: `ECC skill: ${skillName}`,
    author: manifest.author || "",
    tags: [manifest.name],
    entryPoint: path.join(root, "agent.yaml"),
    systemPromptAddon: ``,
    tools: [],
    dependencies: [],
    enabled: true,
  };
}

async function loadCommand(
  root: string,
  commandName: string,
  manifest: EccManifest
): Promise<SkillDefinition> {
  const commandDirs = ["commands", "legacy-command-shims/commands"];
  let filepath: string | null = null;

  for (const dir of commandDirs) {
    const candidate = path.join(root, dir, `${commandName}.md`);
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        filepath = candidate;
        break;
      }
    } catch {
      // continue
    }
  }

  if (filepath) {
    const content = await fs.readFile(filepath, "utf8");
    const parsed = matter(content);
    const data = parsed.data || {};
    const tags: string[] = Array.isArray(data.tags) ? data.tags : [];
    if (!tags.includes(manifest.name)) tags.push(manifest.name);

    return {
      id: data.id || `cmd-${skillIdFromName(commandName)}`,
      name: data.name || commandName,
      version: data.version || manifest.version || "1.0.0",
      description: data.description || `ECC command: /${commandName}`,
      author: data.author || manifest.author || "",
      tags,
      entryPoint: filepath,
      systemPromptAddon: parsed.content,
      tools: Array.isArray(data.tools) ? data.tools : [],
      dependencies: Array.isArray(data.dependencies) ? data.dependencies : [],
      enabled: data.enabled !== false,
    };
  }

  return {
    id: `cmd-${skillIdFromName(commandName)}`,
    name: commandName,
    version: manifest.version || "1.0.0",
    description: `ECC command: /${commandName}`,
    author: manifest.author || "",
    tags: [manifest.name],
    entryPoint: path.join(root, "agent.yaml"),
    systemPromptAddon: ``,
    tools: [],
    dependencies: [],
    enabled: true,
  };
}

async function discoverAgents(root: string, manifest: EccManifest): Promise<AgentDefinition[]> {
  const agents: AgentDefinition[] = [];

  for (const dir of AGENT_DIRS) {
    const fullDir = path.join(root, dir);
    try {
      const entries = await fs.readdir(fullDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const filepath = path.join(fullDir, entry.name);
        const content = await fs.readFile(filepath, "utf8");
        const parsed = matter(content);
        const data = parsed.data || {};
        const id = data.name || path.basename(entry.name, ".md");

        agents.push({
          id: skillIdFromName(id),
          name: id,
          type: "specialist",
          description: data.description || `ECC agent: ${id}`,
          systemPrompt: parsed.content,
          model: data.model || manifest.model?.preferred,
          capabilities: [],
          skills: [],
          mcpServers: [],
          maxConcurrentTasks: 1,
          timeoutMs: 300000,
        });
      }
    } catch {
      // directory may not exist
    }
  }

  return agents;
}

export async function loadEccAdapter(root: string): Promise<EccAdapterResult | null> {
  const manifestPath = path.join(root, "agent.yaml");
  const manifest = await loadEccManifest(manifestPath);
  if (!manifest) return null;

  const skills: SkillDefinition[] = [];
  for (const skillName of manifest.skills || []) {
    skills.push(await loadSkill(root, skillName, manifest));
  }

  const commands: SkillDefinition[] = [];
  for (const commandName of manifest.commands || []) {
    commands.push(await loadCommand(root, commandName, manifest));
  }

  const agents = await discoverAgents(root, manifest);

  return {
    manifest,
    skills,
    commands,
    agents,
  };
}
