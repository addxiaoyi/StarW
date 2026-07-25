import { z } from "zod";

export const PatchStatus = z.enum(["pending", "applied", "failed", "skipped"]);
export type PatchStatus = z.infer<typeof PatchStatus>;

export const PatchDefinition = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.enum(["feature", "restriction", "visual", "performance", "reliability", "privacy"]),
  enabled: z.boolean().optional().default(true),
  pattern: z.union([z.string(), z.instanceof(RegExp)]),
  replacement: z.string(),
  flags: z.string().optional().default("g"),
  sentinel: z.string().optional(),
  unique: z.boolean().optional().default(false),
  priority: z.number().optional().default(50),
  versionRange: z.string().optional(),
  validate: z.function().optional(),
});
export type PatchDefinition = z.infer<typeof PatchDefinition>;
export type PatchDefinitionInput = z.input<typeof PatchDefinition>;

export const PatchResult = z.object({
  patchId: z.string(),
  status: PatchStatus,
  matchCount: z.number().default(0),
  error: z.string().optional(),
  durationMs: z.number().default(0),
});
export type PatchResult = z.infer<typeof PatchResult>;

export const PatchReport = z.object({
  sourceSize: z.number(),
  resultSize: z.number(),
  totalPatches: z.number(),
  appliedCount: z.number(),
  failedCount: z.number(),
  skippedCount: z.number(),
  results: z.array(PatchResult),
  durationMs: z.number(),
});
export type PatchReport = z.infer<typeof PatchReport>;

export const ProviderConfig = z.object({
  apiKey: z.string().default(""),
  baseURL: z.string().default("https://api.anthropic.com"),
  model: z.string().default(""),
  smallModel: z.string().default(""),
  timeoutMs: z.number().default(300000),
});
export type ProviderConfig = z.infer<typeof ProviderConfig>;

export const LeanLevel = z.enum(["off", "on", "max"]);
export type LeanLevel = z.infer<typeof LeanLevel>;

export const ClawConfig = z.object({
  enabled: z.boolean().default(true),
  provider: ProviderConfig.default(() => ({
    apiKey: "",
    baseURL: "https://api.anthropic.com",
    model: "",
    smallModel: "",
    timeoutMs: 300000,
  })),
  leanLevel: LeanLevel.default("on"),
  patches: z.record(z.string(), z.boolean()).default(() => ({})),
  features: z.record(z.string(), z.unknown()).default(() => ({})),
  themeColor: z.string().default("green"),
  enableUpdateCheck: z.boolean().default(true),
});
export type ClawConfig = z.infer<typeof ClawConfig>;

export const ClawState = z.object({
  version: z.string(),
  sourceVersion: z.string().optional(),
  lastPatchedAt: z.number().optional(),
  config: ClawConfig,
});
export type ClawState = z.infer<typeof ClawState>;
