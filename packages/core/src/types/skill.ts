import { z } from "zod";

export const SkillDefinition = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  author: z.string().optional(),
  tags: z.array(z.string()).default(() => []),
  entryPoint: z.string(),
  systemPromptAddon: z.string().optional(),
  tools: z.array(z.string()).default(() => []),
  dependencies: z.array(z.string()).default(() => []),
  enabled: z.boolean().default(true),
});
export type SkillDefinition = z.infer<typeof SkillDefinition>;

export const SkillRegistrySchema = z.object({
  skills: z.record(z.string(), SkillDefinition),
  lastUpdated: z.number(),
});
export type SkillRegistryData = z.infer<typeof SkillRegistrySchema>;
