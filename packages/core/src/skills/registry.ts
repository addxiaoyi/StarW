import path from "node:path";
import type { SkillDefinition } from "../types/skill";
import type { AgentDefinition } from "../types/agent";
import { discoverSkills, type DiscoveredSkill } from "./discovery";
import { loadEccAdapter, type EccAdapterResult } from "../adapters/ecc";

export interface SkillSource {
  type: "directory" | "ecc";
  path: string;
}

export class SkillRegistry {
  private sources: SkillSource[] = [];
  private skills = new Map<string, SkillDefinition>();
  private commands = new Map<string, SkillDefinition>();
  private agents: AgentDefinition[] = [];

  addSource(source: SkillSource): void {
    this.sources.push(source);
  }

  async load(): Promise<void> {
    this.skills.clear();
    this.commands.clear();
    this.agents = [];

    for (const source of this.sources) {
      if (source.type === "directory") {
        const discovered = await discoverSkills(source.path);
        for (const item of discovered) {
          this.skills.set(item.skill.id, item.skill);
        }
      } else if (source.type === "ecc") {
        const ecc = await loadEccAdapter(source.path);
        if (!ecc) continue;
        for (const skill of ecc.skills) {
          this.skills.set(skill.id, skill);
        }
        for (const command of ecc.commands) {
          this.commands.set(command.id, command);
          this.skills.set(command.id, command);
        }
        this.agents.push(...ecc.agents);
      }
    }
  }

  get(id: string): SkillDefinition | undefined {
    return this.skills.get(id);
  }

  list(): SkillDefinition[] {
    return Array.from(this.skills.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  listSkills(): SkillDefinition[] {
    return Array.from(this.skills.values())
      .filter((s) => !this.commands.has(s.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  listCommands(): SkillDefinition[] {
    return Array.from(this.commands.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  listAgents(): AgentDefinition[] {
    return [...this.agents];
  }

  findByPrefix(prefix: string): SkillDefinition[] {
    const lower = prefix.toLowerCase();
    return this.list().filter(
      (s) =>
        s.name.toLowerCase().startsWith(lower) ||
        s.id.toLowerCase().startsWith(lower) ||
        s.description.toLowerCase().includes(lower)
    );
  }

  getSystemPrompt(id: string): string | undefined {
    const skill = this.skills.get(id);
    return skill?.systemPromptAddon;
  }
}

export function createSkillRegistry(sources: SkillSource[] = []): SkillRegistry {
  const registry = new SkillRegistry();
  for (const source of sources) {
    registry.addSource(source);
  }
  return registry;
}
