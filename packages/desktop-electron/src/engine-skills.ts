import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface DesktopSkillTool {
  id: string;
  name: string;
  title: string;
  description: string;
  source: string;
  instructions: string;
  schema: Record<string, unknown>;
}

const MAX_SKILLS = 100;
const MAX_SKILL_BYTES = 128 * 1024;

function safeSegment(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "skill";
}

export function createSkillToolName(id: string): string {
  const segment = safeSegment(id);
  const hash = crypto.createHash("sha1").update(id).digest("hex").slice(0, 8);
  return `skill__${segment.slice(0, 46)}_${hash}`;
}

function parseMetadata(
  content: string,
  fallback: string,
): { title: string; description: string } {
  const lines = content.split(/\r?\n/);
  const metadata: Record<string, string> = {};
  if (lines[0]?.trim() === "---") {
    for (let index = 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.trim() === "---") break;
      const match = line.match(/^([a-zA-Z][\w-]*):\s*(.+)$/);
      if (match)
        metadata[match[1].toLowerCase()] = match[2]
          .trim()
          .replace(/^['"]|['"]$/g, "");
    }
  }
  const heading = lines
    .find((line) => /^#\s+/.test(line))
    ?.replace(/^#\s+/, "")
    .trim();
  const description =
    metadata.description ||
    lines
      .find((line) => {
        const value = line.trim();
        return (
          value &&
          !value.startsWith("#") &&
          value !== "---" &&
          !/^\w[\w-]*:\s*/.test(value)
        );
      })
      ?.trim() ||
    `Workspace skill ${fallback}`;
  return { title: metadata.name || heading || fallback, description };
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export class DesktopSkillManager {
  constructor(private readonly workspace: () => string) {}

  list(): DesktopSkillTool[] {
    const root = fs.realpathSync(path.resolve(this.workspace()));
    const files: string[] = [];
    for (const relative of [".agents/skills", ".openstar/skills"]) {
      const directory = path.join(root, relative);
      if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory())
        continue;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (files.length >= MAX_SKILLS) break;
        const candidate = entry.isDirectory()
          ? path.join(directory, entry.name, "SKILL.md")
          : entry.isFile() && entry.name.toLowerCase().endsWith(".md")
            ? path.join(directory, entry.name)
            : "";
        if (!candidate || !fs.existsSync(candidate)) continue;
        const stat = fs.lstatSync(candidate);
        if (
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          stat.size > MAX_SKILL_BYTES
        )
          continue;
        const resolved = fs.realpathSync(candidate);
        if (inside(root, resolved)) files.push(resolved);
      }
    }
    return files.map((source) => {
      const id =
        path.basename(path.dirname(source)) === "skills"
          ? path.basename(source, path.extname(source))
          : path.basename(path.dirname(source));
      const instructions = fs.readFileSync(source, "utf8");
      const metadata = parseMetadata(instructions, id);
      return {
        id,
        name: createSkillToolName(id),
        title: metadata.title,
        description: metadata.description,
        source: path.relative(root, source).replaceAll("\\", "/"),
        instructions,
        schema: {
          type: "function",
          function: {
            name: createSkillToolName(id),
            description: `Load and apply workspace skill: ${metadata.title}. ${metadata.description}`,
            parameters: {
              type: "object",
              properties: {
                input: {
                  type: "string",
                  description: "Task or question to apply this skill to",
                },
                context: {
                  type: "object",
                  description: "Optional structured context for the skill",
                },
              },
              required: ["input"],
              additionalProperties: false,
            },
          },
        },
      };
    });
  }

  get(name: string): DesktopSkillTool | undefined {
    return this.list().find((tool) => tool.name === name);
  }

  execute(
    name: string,
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    const skill = this.get(name);
    if (!skill) throw new Error(`Workspace skill does not exist: ${name}`);
    return {
      skill: skill.id,
      title: skill.title,
      source: skill.source,
      input: typeof input.input === "string" ? input.input : "",
      context:
        input.context && typeof input.context === "object"
          ? input.context
          : undefined,
      instructions: skill.instructions,
    };
  }
}
