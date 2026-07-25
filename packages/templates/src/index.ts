/**
 * OpenStar Templates
 *
 * Workflow and project template management.
 * Provides reusable DAG, agent, and skill templates.
 */
import { z } from "zod";

export const TemplateDefinition = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.enum(["dag", "agent", "skill", "project", "config"]),
  version: z.string().default("1.0.0"),
  tags: z.array(z.string()).default([]),
  content: z.unknown(),
  variables: z.array(z.object({
    name: z.string(),
    description: z.string(),
    default: z.unknown().optional(),
    required: z.boolean().default(true),
  })).default([]),
});

export type TemplateDefinition = z.infer<typeof TemplateDefinition>;

export class TemplateManager {
  private templates = new Map<string, TemplateDefinition>();

  register(template: TemplateDefinition): void {
    this.templates.set(template.id, TemplateDefinition.parse(template));
  }

  get(id: string): TemplateDefinition | undefined {
    return this.templates.get(id);
  }

  list(category?: TemplateDefinition["category"]): TemplateDefinition[] {
    const all = Array.from(this.templates.values());
    return category ? all.filter((t) => t.category === category) : all;
  }

  search(query: string): TemplateDefinition[] {
    const q = query.toLowerCase();
    return Array.from(this.templates.values()).filter(
      (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.tags.some((tag) => tag.includes(q))
    );
  }

  render(id: string, variables: Record<string, unknown>): unknown {
    const template = this.templates.get(id);
    if (!template) throw new Error(`Template ${id} not found`);

    // Validate required variables
    for (const v of template.variables) {
      if (v.required && !(v.name in variables) && v.default === undefined) {
        throw new Error(`Missing required variable: ${v.name}`);
      }
    }

    // Simple variable substitution in string content
    const merge = (obj: unknown): unknown => {
      if (typeof obj === "string") {
        return obj.replace(/\{\{(\w+)\}\}/g, (_, key) => {
          const value = variables[key] ?? template.variables.find((v) => v.name === key)?.default;
          return value !== undefined ? String(value) : `{{${key}}}`;
        });
      }
      if (Array.isArray(obj)) return obj.map(merge);
      if (obj && typeof obj === "object") {
        return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, merge(v)]));
      }
      return obj;
    };

    return merge(template.content);
  }
}

// ─── Built-in Templates ──────────────────────────────────────────────

export const BUILTIN_TEMPLATES: TemplateDefinition[] = [
  {
    id: "dag.code-review",
    name: "Code Review Pipeline",
    description: "Automated code review using double-check pattern",
    category: "dag",
    version: "1.0.0",
    content: {
      pattern: "double-check",
      inputs: { "Reviewer-1": { repo: "{{repo}}" }, "Reviewer-2": { repo: "{{repo}}" } },
    },
    variables: [{ name: "repo", description: "Repository to review", required: true }],
    tags: ["review", "code"],
  },
  {
    id: "agent.reviewer",
    name: "Code Reviewer Agent",
    description: "Specialized agent for code review",
    category: "agent",
    version: "1.0.0",
    content: {
      type: "specialist",
      capabilities: ["review", "analyze"],
      systemPrompt: "You are an expert code reviewer. Focus on {{focus}}.",
    },
    variables: [{ name: "focus", description: "Review focus area", default: "security and performance", required: false }],
    tags: ["agent", "review"],
  },
  {
    id: "skill.git-workflow",
    name: "Git Workflow Skill",
    description: "Automate git commit, push, and PR creation",
    category: "skill",
    version: "1.0.0",
    content: { commands: ["git add .", "git commit -m \"{{message}}\"", "git push"] },
    variables: [{ name: "message", description: "Commit message", required: true }],
    tags: ["git", "automation"],
  },
];
