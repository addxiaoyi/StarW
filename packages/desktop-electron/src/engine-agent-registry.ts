import fs from "node:fs";
import path from "node:path";
import type { DesktopAgentDefinition } from "./engine-agent.js";

export interface StoredAgentDefinition extends DesktopAgentDefinition {
  builtIn: boolean;
  provider?: string;
  model?: string;
  tools?: string[];
}

const NAME_PATTERN = /^[a-z][a-z0-9_-]{1,47}$/;
const MAX_AGENTS = 50;
const MAX_INSTRUCTIONS = 128 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeTools(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tools = [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].slice(0, 64);
  return tools.length ? tools : undefined;
}

function normalizeCustom(
  value: unknown,
  existingName?: string,
): StoredAgentDefinition {
  if (!isRecord(value))
    throw new TypeError("Agent definition must be an object");
  const name = stringValue(value.name, existingName).trim().toLowerCase();
  if (!NAME_PATTERN.test(name))
    throw new Error("Agent name must match /^[a-z][a-z0-9_-]{1,47}$/");
  const description = stringValue(value.description).trim();
  if (!description) throw new Error("Agent description is required");
  const permission = isRecord(value.permission) ? value.permission : {};
  return {
    name,
    type: "custom",
    description: description.slice(0, 2000),
    instructions: stringValue(value.instructions).slice(0, MAX_INSTRUCTIONS),
    provider: stringValue(value.provider).trim() || undefined,
    model: stringValue(value.model).trim() || undefined,
    tools: normalizeTools(value.tools),
    permission: {
      canEdit: booleanValue(permission.canEdit, false),
      canExecute: booleanValue(permission.canExecute, false),
      canAccessNetwork: booleanValue(permission.canAccessNetwork, false),
      canUseMcp: booleanValue(permission.canUseMcp, false),
      allowedDirectories: Array.isArray(permission.allowedDirectories)
        ? permission.allowedDirectories
            .filter((item): item is string => typeof item === "string")
            .slice(0, 64)
        : [],
      deniedPatterns: Array.isArray(permission.deniedPatterns)
        ? permission.deniedPatterns
            .filter((item): item is string => typeof item === "string")
            .slice(0, 64)
        : [],
    },
    builtIn: false,
  };
}

export class DesktopAgentDefinitionManager {
  private readonly file: string;
  private custom: StoredAgentDefinition[];

  constructor(
    dataDir: string,
    private readonly builtIns: () => DesktopAgentDefinition[],
    private readonly emit: (event: string, payload: unknown) => void,
  ) {
    this.file = path.join(dataDir, "custom-agents.json");
    this.custom = this.load();
  }

  private load(): StoredAgentDefinition[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (!Array.isArray(parsed)) return [];
      const result: StoredAgentDefinition[] = [];
      for (const item of parsed.slice(0, MAX_AGENTS)) {
        try {
          result.push(normalizeCustom(item));
        } catch {
          /* ignore invalid legacy entry */
        }
      }
      return result;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        console.error(`[custom-agents] ${String(error)}`);
      return [];
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(
      temporary,
      `${JSON.stringify(this.custom, null, 2)}\n`,
      "utf8",
    );
    fs.renameSync(temporary, this.file);
  }

  list(): StoredAgentDefinition[] {
    const builtIns = this.builtIns().map((agent) => ({
      ...agent,
      builtIn: true,
    }));
    return [...builtIns, ...this.custom].map((agent) => structuredClone(agent));
  }

  get(name: string): StoredAgentDefinition | undefined {
    return this.list().find((agent) => agent.name === name);
  }

  create(input: unknown): StoredAgentDefinition {
    const agent = normalizeCustom(input);
    if (this.list().some((item) => item.name === agent.name))
      throw new Error(`Agent already exists: ${agent.name}`);
    if (this.custom.length >= MAX_AGENTS)
      throw new Error(`Custom Agent limit reached: ${MAX_AGENTS}`);
    this.custom.push(agent);
    this.save();
    this.emit("agent.definition.created", { agent });
    return structuredClone(agent);
  }

  update(name: string, input: unknown): StoredAgentDefinition {
    const index = this.custom.findIndex((agent) => agent.name === name);
    if (index < 0) throw new Error(`Custom Agent does not exist: ${name}`);
    const current = this.custom[index];
    const merged = normalizeCustom(
      { ...current, ...(isRecord(input) ? input : {}), name },
      name,
    );
    this.custom[index] = merged;
    this.save();
    this.emit("agent.definition.updated", { agent: merged });
    return structuredClone(merged);
  }

  remove(name: string): boolean {
    const index = this.custom.findIndex((agent) => agent.name === name);
    if (index < 0) return false;
    this.custom.splice(index, 1);
    this.save();
    this.emit("agent.definition.deleted", { name });
    return true;
  }
}
