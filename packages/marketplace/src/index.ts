/**
 * OpenStar Marketplace
 *
 * Plugin and skill distribution marketplace.
 * Handles package discovery, installation, and version management.
 */
import { z } from "zod";
import path from "path";
import fs from "fs";

export const PackageManifest = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  type: z.enum(["plugin", "skill", "template", "agent"]),
  description: z.string(),
  author: z.string(),
  tags: z.array(z.string()).default([]),
  downloads: z.number().default(0),
  rating: z.number().min(0).max(5).default(0),
});

export type PackageManifest = z.infer<typeof PackageManifest>;

export interface PackageSource {
  id: string;
  url: string;
  type: "registry" | "git" | "local";
}

export class Marketplace {
  private sources = new Map<string, PackageSource>();
  private cache = new Map<string, PackageManifest[]>();
  private localDir: string;

  constructor(localDir = "~/.openstar/marketplace") {
    this.localDir = localDir;
    if (!fs.existsSync(this.localDir)) {
      try {
        fs.mkdirSync(this.localDir, { recursive: true });
      } catch {
        // ignore
      }
    }
  }

  registerSource(source: PackageSource): void {
    this.sources.set(source.id, source);
  }

  async search(query: string, tags?: string[]): Promise<PackageManifest[]> {
    const all = new Map<string, PackageManifest>();
    for (const source of this.sources.values()) {
      const packages = await this.fetchFromSource(source);
      for (const pkg of packages) {
        if (query && !pkg.name.toLowerCase().includes(query.toLowerCase()) && !pkg.description.toLowerCase().includes(query.toLowerCase())) {
          continue;
        }
        if (tags && !tags.every((t) => pkg.tags.includes(t))) {
          continue;
        }
        all.set(pkg.id, pkg);
      }
    }
    return Array.from(all.values());
  }

  private async fetchFromSource(source: PackageSource): Promise<PackageManifest[]> {
    if (this.cache.has(source.id)) {
      return this.cache.get(source.id)!;
    }
    if (source.type === "local") {
      try {
        const files = fs.readdirSync(source.url);
        const packages: PackageManifest[] = [];
        for (const file of files) {
          const manifestPath = path.join(source.url, file, "package.json");
          if (fs.existsSync(manifestPath)) {
            const raw = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
            const result = PackageManifest.safeParse(raw);
            if (result.success) packages.push(result.data);
          }
        }
        this.cache.set(source.id, packages);
        return packages;
      } catch {
        return [];
      }
    }
    // For remote sources, we'd fetch from registry; for now return cached or empty
    return this.cache.get(source.id) ?? [];
  }

  async install(packageId: string, sourceId: string): Promise<boolean> {
    // Implementation would download and extract package
    // For now, just records intent
    const manifest = this.cache.get(sourceId)?.find((p) => p.id === packageId);
    if (!manifest) return false;
    const installPath = path.join(this.localDir, packageId);
    try {
      fs.mkdirSync(installPath, { recursive: true });
      fs.writeFileSync(path.join(installPath, "installed.json"), JSON.stringify(manifest, null, 2));
      return true;
    } catch {
      return false;
    }
  }

  async uninstall(packageId: string): Promise<boolean> {
    const installPath = path.join(this.localDir, packageId);
    try {
      fs.rmSync(installPath, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  listInstalled(): PackageManifest[] {
    try {
      const entries = fs.readdirSync(this.localDir);
      const result: PackageManifest[] = [];
      for (const entry of entries) {
        const manifestPath = path.join(this.localDir, entry, "installed.json");
        if (fs.existsSync(manifestPath)) {
          const raw = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
          const result2 = PackageManifest.safeParse(raw);
          if (result2.success) result.push(result2.data);
        }
      }
      return result;
    } catch {
      return [];
    }
  }
}
