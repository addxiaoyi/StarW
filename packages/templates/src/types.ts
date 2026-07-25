import { z } from "zod";

export const TemplateType = z.enum([
  "design",
  "agent-task",
  "pet-skin",
  "relay-config",
  "canvas",
  "workflow",
]);
export type TemplateType = z.infer<typeof TemplateType>;

export const TemplateCategory = z.enum([
  "ui-design",
  "flowchart",
  "mind-map",
  "wireframe",
  "code-review",
  "research",
  "automation",
  "pet-cat",
  "pet-dog",
  "pet-creature",
  "relay-cluster",
  "relay-ha",
  "canvas-empty",
  "canvas-grid",
]);
export type TemplateCategory = z.infer<typeof TemplateCategory>;

export const TemplateVariable = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean", "select", "textarea"]),
  label: z.string().optional(),
  defaultValue: z.unknown().optional(),
  options: z.array(z.object({
    value: z.unknown(),
    label: z.string(),
  })).optional(),
  required: z.boolean().default(false),
});
export type TemplateVariable = z.infer<typeof TemplateVariable>;

export const TemplateManifest = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: TemplateType,
  category: TemplateCategory,
  version: z.string().default("1.0.0"),
  author: z.string().default("openstar"),
  tags: z.array(z.string()).default(() => []),
  thumbnail: z.string().optional(),
  previewUrl: z.string().optional(),
  variables: z.array(TemplateVariable).default(() => []),
  dependencies: z.array(z.string()).default(() => []),
  mcpServers: z.array(z.string()).default(() => []),
  skills: z.array(z.string()).default(() => []),
  createdAt: z.number().default(() => Date.now()),
  updatedAt: z.number().default(() => Date.now()),
  downloads: z.number().default(0),
  stars: z.number().default(0),
});
export type TemplateManifest = z.infer<typeof TemplateManifest>;

export const TemplateInstance = z.object({
  id: z.string(),
  templateId: z.string(),
  name: z.string(),
  variables: z.record(z.string(), z.unknown()).default(() => ({})),
  data: z.record(z.string(), z.unknown()).default(() => ({})),
  createdAt: z.number().default(() => Date.now()),
  updatedAt: z.number().default(() => Date.now()),
});
export type TemplateInstance = z.infer<typeof TemplateInstance>;

export const TemplateData = z.object({
  manifest: TemplateManifest,
  content: z.record(z.string(), z.unknown()).default(() => ({})),
});
export type TemplateData = z.infer<typeof TemplateData>;

export const TemplateSearchOptions = z.object({
  type: TemplateType.optional(),
  category: TemplateCategory.optional(),
  query: z.string().optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().default(20),
  offset: z.number().default(0),
});
export type TemplateSearchOptions = z.infer<typeof TemplateSearchOptions>;
