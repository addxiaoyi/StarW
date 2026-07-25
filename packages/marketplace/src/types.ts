import { z } from "zod";

export const PackageType = z.enum(["skill", "agent", "mcp-server", "template", "plugin"]);
export type PackageType = z.infer<typeof PackageType>;

export const PackageStatus = z.enum(["available", "installed", "updating", "failed", "disabled"]);
export type PackageStatus = z.infer<typeof PackageStatus>;

export const PackageVersion = z.object({
  version: z.string(),
  releasedAt: z.number(),
  changelog: z.string().optional(),
  downloadUrl: z.string().optional(),
  sha256: z.string().optional(),
});
export type PackageVersion = z.infer<typeof PackageVersion>;

export const PackageManifest = z.object({
  id: z.string(),
  name: z.string(),
  type: PackageType,
  version: z.string(),
  description: z.string(),
  author: z.string().optional(),
  tags: z.array(z.string()).default(() => []),
  keywords: z.array(z.string()).default(() => []),
  homepage: z.string().optional(),
  repository: z.string().optional(),
  license: z.string().optional(),
  readme: z.string().optional(),
  icon: z.string().optional(),
  category: z.string().optional(),
  entryPoint: z.string().optional(),
  dependencies: z.array(z.string()).default(() => []),
  mcpServers: z.array(z.string()).default(() => []),
  capabilities: z.array(z.string()).default(() => []),
  stars: z.number().default(0),
  downloads: z.number().default(0),
  installedCount: z.number().default(0),
  versions: z.array(PackageVersion).default(() => []),
  updatedAt: z.number().default(() => Date.now()),
  createdAt: z.number().default(() => Date.now()),
});
export type PackageManifest = z.infer<typeof PackageManifest>;

export const InstalledPackage = z.object({
  manifest: PackageManifest,
  installPath: z.string(),
  installedAt: z.number(),
  updatedAt: z.number(),
  status: PackageStatus.default("installed"),
  enabled: z.boolean().default(true),
  config: z.record(z.string(), z.unknown()).default(() => ({})),
});
export type InstalledPackage = z.infer<typeof InstalledPackage>;

export const MarketplaceConfig = z.object({
  registryUrl: z.string().default("https://registry.openstar.dev"),
  installDir: z.string().default("~/.openstar/packages"),
  cacheDir: z.string().default("~/.openstar/cache"),
  autoUpdate: z.boolean().default(false),
  updateCheckIntervalMs: z.number().default(86400000),
  trustedSources: z.array(z.string()).default(() => ["official", "verified"]),
});
export type MarketplaceConfig = z.infer<typeof MarketplaceConfig>;

export interface InstallOptions {
  version?: string;
  force?: boolean;
  skipDependencies?: boolean;
  enable?: boolean;
  onProgress?: (percent: number, stage: string) => void;
}

export interface UninstallOptions {
  removeConfig?: boolean;
  removeDependencies?: boolean;
}

export interface SearchOptions {
  query?: string;
  type?: PackageType;
  category?: string;
  tags?: string[];
  page?: number;
  perPage?: number;
  sortBy?: "popularity" | "recent" | "name" | "downloads";
}

export interface SearchResult {
  packages: PackageManifest[];
  total: number;
  page: number;
  perPage: number;
}
