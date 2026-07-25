/**
 * OpenStar CLI plugin discovery and loading.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface OpenStarPlugin {
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  type: "skill" | "agent" | "mcp" | "theme" | "all";
  main?: string;
  load?: (context: PluginContext) => Promise<void>;
  skills?: OpenStarSkill[];
  agents?: OpenStarAgentDef[];
}

export interface PluginContext {
  log: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  config: PluginConfig;
  loadConfig<T>(key: string): Promise<T>;
  saveConfig<T>(key: string, value: T): Promise<void>;
}

export interface PluginConfig {
  plugins: string[];
  pluginDir: string;
}

export interface OpenStarSkill {
  id: string;
  name: string;
  description: string;
  category:
    | "quality"
    | "development"
    | "testing"
    | "integration"
    | "devops"
    | "utils";
  enabled: boolean;
  execute: (args: string[]) => Promise<SkillResult>;
}

export interface OpenStarAgentDef {
  id: string;
  name: string;
  description?: string;
  skills: string[];
}

export interface SkillResult {
  success: boolean;
  output?: string;
  logs?: string[];
  error?: Error;
}

export class PluginManager {
  private readonly plugins: OpenStarPlugin[] = [];
  private readonly loaded = new Set<string>();

  constructor(
    private readonly pluginDir = path.join(
      process.env.HOME ?? process.env.USERPROFILE ?? process.cwd(),
      ".openstar",
      "plugins",
    ),
  ) {}

  async initialize(): Promise<void> {
    await fs.mkdir(this.pluginDir, { recursive: true });
  }

  async loadAll(): Promise<void> {
    await this.initialize();
    const files = await fs.readdir(this.pluginDir);
    const pluginFiles = files.filter((file) =>
      [".js", ".mjs", ".json"].includes(path.extname(file).toLowerCase()),
    );

    for (const file of pluginFiles) {
      await this.loadPlugin(path.join(this.pluginDir, file));
    }
  }

  async loadPlugin(pluginPath: string): Promise<void> {
    const plugin = await this.readPlugin(pluginPath);
    if (this.loaded.has(plugin.id)) return;

    this.plugins.push(plugin);
    this.loaded.add(plugin.id);
    console.log(`Loaded plugin: ${plugin.name} v${plugin.version}`);
  }

  async getAllSkills(): Promise<OpenStarSkill[]> {
    const skills = this.plugins.flatMap((plugin) => plugin.skills ?? []);
    console.log(`Loaded ${skills.length} plugin skill(s).`);
    return skills;
  }

  async getAllAgents(): Promise<OpenStarAgentDef[]> {
    const agents = this.plugins.flatMap((plugin) => plugin.agents ?? []);
    console.log(`Loaded ${agents.length} plugin agent(s).`);
    return agents;
  }

  registerBuiltInPlugins(): void {
    // Built-ins are registered by the CLI bootstrap; this hook is retained for extensions.
  }

  private async readPlugin(pluginPath: string): Promise<OpenStarPlugin> {
    if (path.extname(pluginPath).toLowerCase() === ".json") {
      return JSON.parse(await fs.readFile(pluginPath, "utf8")) as OpenStarPlugin;
    }

    const module = (await import(pathToFileURL(pluginPath).href)) as {
      default?: OpenStarPlugin;
    } & Partial<OpenStarPlugin>;
    const plugin = module.default ?? module;

    if (!plugin.id || !plugin.name || !plugin.version || !plugin.description || !plugin.type) {
      throw new Error(`Invalid plugin manifest: ${pluginPath}`);
    }
    return plugin as OpenStarPlugin;
  }
}

export const pluginManager = new PluginManager();
export default PluginManager;
