/**
 * OpenStar Plugin SDK
 *
 * Declarative plugin development toolkit with HRP-compatible package format.
 * Inspired by HomeRail's plugin SDK and HRP packer.
 */
import { z } from "zod";
import path from "path";
import fs from "fs";

// ─── Plugin Manifest ─────────────────────────────────────────────────

export const PluginManifest = z.object({
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+/),
  description: z.string().min(1),
  author: z.string().optional(),
  license: z.string().default("MIT"),
  homepage: z.string().optional(),
  openstar: z.object({
    minVersion: z.string().default("0.1.0"),
    capabilities: z.array(z.enum([
      "dag-pattern", "agent-definition", "skill", "mcp-tool", "generative-ui"
    ])).default(() => []),
    permissions: z.array(z.enum([
      "filesystem:read", "filesystem:write", "network", "shell", "docker", "git"
    ])).default(() => []),
  }).default(() => ({ minVersion: "0.1.0", capabilities: [], permissions: [] })),
  dependencies: z.record(z.string(), z.string()).default(() => ({})),
});

export type PluginManifest = z.infer<typeof PluginManifest>;

// ─── Plugin Definition ───────────────────────────────────────────────

export interface PluginContext {
  pluginDir: string;
  workdir: string;
  env: Record<string, string>;
}

export interface PluginLifecycle {
  onInstall?: (ctx: PluginContext) => Promise<void>;
  onUninstall?: (ctx: PluginContext) => Promise<void>;
  onEnable?: (ctx: PluginContext) => Promise<void>;
  onDisable?: (ctx: PluginContext) => Promise<void>;
}

export interface PluginContributions {
  dagPatterns?: Array<{
    id: string;
    name: string;
    description: string;
    category: "orchestration" | "review" | "pipeline" | "diagnosis" | "notification";
    definition: Record<string, unknown>;
  }>;
  agentDefinitions?: Array<{
    id: string;
    name: string;
    type: string;
    description: string;
    systemPrompt?: string;
    capabilities: string[];
  }>;
  skills?: Array<{
    id: string;
    name: string;
    description: string;
    tags: string[];
    execute: string; // path to execute handler
  }>;
  mcpTools?: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    handler: string; // path to handler module
  }>;
}

export interface Plugin {
  manifest: PluginManifest;
  lifecycle?: PluginLifecycle;
  contributions?: PluginContributions;
}

// ─── Plugin Registry ─────────────────────────────────────────────────

export class PluginRegistry {
  private plugins = new Map<string, Plugin>();
  private enabled = new Set<string>();

  register(plugin: Plugin): void {
    this.plugins.set(plugin.manifest.name, plugin);
  }

  unregister(name: string): boolean {
    return this.plugins.delete(name) && this.enabled.delete(name);
  }

  enable(name: string): boolean {
    if (!this.plugins.has(name)) return false;
    this.enabled.add(name);
    return true;
  }

  disable(name: string): boolean {
    return this.enabled.delete(name);
  }

  get(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  listAll(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  listEnabled(): Plugin[] {
    return Array.from(this.enabled)
      .map((name) => this.plugins.get(name))
      .filter((p): p is Plugin => p !== undefined);
  }

  isEnabled(name: string): boolean {
    return this.enabled.has(name);
  }

  getContributions<T extends keyof PluginContributions>(type: T): NonNullable<PluginContributions[T]> {
    const results: NonNullable<PluginContributions[T]> = [];
    for (const name of this.enabled) {
      const plugin = this.plugins.get(name);
      const contribs = plugin?.contributions?.[type];
      if (contribs) {
        for (const c of contribs as any[]) {
          results.push(c);
        }
      }
    }
    return results as NonNullable<PluginContributions[T]>;
  }
}

// ─── Plugin Loader ───────────────────────────────────────────────────

export async function loadPlugin(pluginPath: string): Promise<Plugin> {
  const manifestPath = path.join(pluginPath, "plugin.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Plugin manifest not found at ${manifestPath}`);
  }

  const manifestRaw = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const manifest = PluginManifest.parse(manifestRaw);

  const plugin: Plugin = { manifest };

  // Try to load lifecycle hooks
  const lifecyclePath = path.join(pluginPath, "lifecycle.js");
  if (fs.existsSync(lifecyclePath)) {
    try {
      const lifecycleModule = await import(`file://${lifecyclePath}`);
      plugin.lifecycle = lifecycleModule.default || lifecycleModule;
    } catch {
      // lifecycle is optional
    }
  }

  // Try to load contributions
  const contribsPath = path.join(pluginPath, "contributions.json");
  if (fs.existsSync(contribsPath)) {
    plugin.contributions = JSON.parse(fs.readFileSync(contribsPath, "utf-8"));
  }

  return plugin;
}

export async function loadPluginsFromDir(
  dir: string,
  registry: PluginRegistry
): Promise<number> {
  if (!fs.existsSync(dir)) return 0;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let count = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const plugin = await loadPlugin(path.join(dir, entry.name));
      registry.register(plugin);
      // Auto-enable plugins by default
      registry.enable(plugin.manifest.name);
      count++;
    } catch (err) {
      console.warn(`[Plugin] Failed to load ${entry.name}: ${err instanceof Error ? err.message : err}`);
    }
  }

  return count;
}

// ─── HRP Packer ──────────────────────────────────────────────────────

/**
 * Create an HRP (HomeRail Plugin) package from a plugin directory.
 * HRP is just a .tar.gz of the plugin directory with a manifest.
 */
export function createHrpPackage(pluginDir: string, outputDir?: string): string {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(pluginDir, "plugin.json"), "utf-8")
  );
  PluginManifest.parse(manifest);

  const name = `${manifest.name}-${manifest.version}.hrp`;
  const output = path.join(outputDir ?? process.cwd(), name);

  // Simple tar-like packaging using built-in APIs
  const archiver = require("archiver");
  const archive = archiver("tar", { gzip: true });
  const outputStream = fs.createWriteStream(output);

  archive.pipe(outputStream);
  archive.directory(pluginDir, false);
  archive.finalize();

  return output;
}

// ─── Singleton ───────────────────────────────────────────────────────

let defaultRegistry: PluginRegistry | null = null;

export function getPluginRegistry(): PluginRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new PluginRegistry();
  }
  return defaultRegistry;
}

export function initPluginRegistry(): PluginRegistry {
  defaultRegistry = new PluginRegistry();
  return defaultRegistry;
}
