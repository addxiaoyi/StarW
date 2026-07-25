import type {
  PackageManifest,
  InstalledPackage,
  MarketplaceConfig,
  InstallOptions,
  UninstallOptions,
  SearchOptions,
  SearchResult,
  PackageType,
} from "./types";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

export class PackageManager {
  private config: MarketplaceConfig;
  private installed: Map<string, InstalledPackage> = new Map();
  private registry: Map<string, PackageManifest> = new Map();

  constructor(config?: Partial<MarketplaceConfig>) {
    this.config = {
      registryUrl: "https://registry.openstar.dev",
      installDir: path.join(os.homedir(), ".openstar", "packages"),
      cacheDir: path.join(os.homedir(), ".openstar", "cache"),
      autoUpdate: false,
      updateCheckIntervalMs: 86400000,
      trustedSources: ["official", "verified"],
      ...config,
    };

    this.loadInstalled();
    this.loadDefaultRegistry();
  }

  getConfig(): MarketplaceConfig {
    return { ...this.config };
  }

  private loadDefaultRegistry(): void {
    const defaults = [
      {
        id: "terminal-skill",
        name: "Terminal Power User",
        type: "skill",
        version: "1.0.0",
        description: "Advanced terminal management and shell scripting skills",
        author: "openstar",
        tags: ["terminal", "shell", "productivity"],
        category: "productivity",
        capabilities: ["terminal", "shell-scripting", "command-execution"],
        stars: 1250,
        downloads: 15000,
        installedCount: 5200,
        updatedAt: Date.now() - 86400000 * 2,
        createdAt: Date.now() - 86400000 * 30,
      },
      {
        id: "git-skill",
        name: "Git Master",
        type: "skill",
        version: "1.2.0",
        description: "Comprehensive Git workflow and version management skills",
        author: "openstar",
        tags: ["git", "vcs", "workflow"],
        category: "development",
        capabilities: ["git", "version-control", "code-review"],
        stars: 2100,
        downloads: 28000,
        installedCount: 9800,
        updatedAt: Date.now() - 86400000,
        createdAt: Date.now() - 86400000 * 60,
      },
      {
        id: "code-review-agent",
        name: "Code Review Agent",
        type: "agent",
        version: "2.0.0",
        description: "Automated code review with security and performance checks",
        author: "openstar",
        tags: ["code-review", "security", "quality"],
        category: "development",
        capabilities: ["code-review", "security-audit", "performance-analysis"],
        stars: 3400,
        downloads: 42000,
        installedCount: 15600,
        updatedAt: Date.now() - 86400000 * 3,
        createdAt: Date.now() - 86400000 * 90,
      },
      {
        id: "research-agent",
        name: "Deep Research Agent",
        type: "agent",
        version: "1.5.0",
        description: "Multi-source research with citation verification",
        author: "community",
        tags: ["research", "analysis", "writing"],
        category: "research",
        capabilities: ["research", "analysis", "writing", "citations"],
        stars: 1800,
        downloads: 22000,
        installedCount: 7800,
        updatedAt: Date.now() - 86400000 * 5,
        createdAt: Date.now() - 86400000 * 45,
      },
      {
        id: "terminal-mcp",
        name: "Terminal MCP Server",
        type: "mcp-server",
        version: "1.0.0",
        description: "Enhanced terminal session management MCP server",
        author: "openstar",
        tags: ["mcp", "terminal", "session"],
        category: "mcp",
        mcpServers: ["terminal-enhanced"],
        stars: 890,
        downloads: 12000,
        installedCount: 4500,
        updatedAt: Date.now() - 86400000 * 7,
        createdAt: Date.now() - 86400000 * 20,
      },
      {
        id: "database-mcp",
        name: "Database MCP Server",
        type: "mcp-server",
        version: "1.3.0",
        description: "SQL database query and management MCP server",
        author: "community",
        tags: ["mcp", "database", "sql"],
        category: "mcp",
        mcpServers: ["database"],
        stars: 1560,
        downloads: 18500,
        installedCount: 6200,
        updatedAt: Date.now() - 86400000 * 4,
        createdAt: Date.now() - 86400000 * 50,
      },
      {
        id: "project-template",
        name: "Full-stack Project Template",
        type: "template",
        version: "1.0.0",
        description: "Production-ready full-stack project template",
        author: "openstar",
        tags: ["template", "fullstack", "starter"],
        category: "templates",
        stars: 720,
        downloads: 9800,
        installedCount: 3400,
        updatedAt: Date.now() - 86400000 * 10,
        createdAt: Date.now() - 86400000 * 25,
      },
      {
        id: "ui-design-agent",
        name: "UI Design Agent",
        type: "agent",
        version: "1.0.0",
        description: "UI/UX design agent with component library",
        author: "community",
        tags: ["design", "ui", "ux", "frontend"],
        category: "design",
        capabilities: ["ui-design", "frontend", "design-systems"],
        stars: 2200,
        downloads: 31000,
        installedCount: 11200,
        updatedAt: Date.now() - 86400000 * 1,
        createdAt: Date.now() - 86400000 * 15,
      },
      {
        id: "pet-companion-pack",
        name: "桌宠伴侣包",
        type: "template",
        version: "1.0.0",
        description: "可爱的桌宠伴侣，陪伴你写代码，支持多种宠物和交互",
        author: "openstar",
        tags: ["pet", "companion", "gamification", "fun"],
        category: "pet",
        mcpServers: ["pet-companion"],
        stars: 3800,
        downloads: 52000,
        installedCount: 23000,
        updatedAt: Date.now() - 86400000 * 1,
        createdAt: Date.now() - 86400000 * 20,
      },
      {
        id: "ai-relay-hub",
        name: "AI 中转站",
        type: "mcp-server",
        version: "1.2.0",
        description: "高性能 AI API 中转站，支持多提供商、负载均衡、故障转移",
        author: "openstar",
        tags: ["relay", "proxy", "llm", "api-gateway"],
        category: "relay",
        mcpServers: ["ai-relay"],
        stars: 2900,
        downloads: 38000,
        installedCount: 14500,
        updatedAt: Date.now() - 86400000 * 2,
        createdAt: Date.now() - 86400000 * 35,
      },
      {
        id: "pet-cat-orange",
        name: "橘猫宠物皮肤",
        type: "template",
        version: "1.0.0",
        description: "可爱的橘猫桌宠皮肤，贪吃又爱睡觉",
        author: "openstar",
        tags: ["pet", "cat", "orange", "skin"],
        category: "pet-skin",
        stars: 1500,
        downloads: 22000,
        installedCount: 9800,
        updatedAt: Date.now() - 86400000 * 3,
        createdAt: Date.now() - 86400000 * 25,
      },
      {
        id: "relay-cluster-mode",
        name: "中转站集群模式",
        type: "plugin",
        version: "1.0.0",
        description: "支持多节点集群部署的中转站扩展",
        author: "community",
        tags: ["relay", "cluster", "ha", "scaling"],
        category: "relay",
        capabilities: ["cluster-management", "load-balancing", "auto-failover"],
        stars: 980,
        downloads: 12000,
        installedCount: 4200,
        updatedAt: Date.now() - 86400000 * 5,
        createdAt: Date.now() - 86400000 * 40,
      },
    ] as unknown as PackageManifest[];

    for (const pkg of defaults) {
      this.registry.set(pkg.id, pkg);
    }
  }

  private loadInstalled(): void {
    const installedFile = path.join(this.config.installDir, "installed.json");
    try {
      if (fs.existsSync(installedFile)) {
        const raw = fs.readFileSync(installedFile, "utf8");
        const data = JSON.parse(raw);
        for (const pkg of data) {
          this.installed.set(pkg.manifest.id, pkg);
        }
      }
    } catch {
      // ignore
    }
  }

  private saveInstalled(): void {
    const dir = this.config.installDir;
    fs.mkdirSync(dir, { recursive: true });

    const data = Array.from(this.installed.values());
    fs.writeFileSync(
      path.join(dir, "installed.json"),
      JSON.stringify(data, null, 2) + "\n"
    );
  }

  async search(options: SearchOptions = {}): Promise<SearchResult> {
    const {
      query,
      type,
      category,
      tags,
      page = 1,
      perPage = 20,
      sortBy = "popularity",
    } = options;

    let results = Array.from(this.registry.values());

    if (query) {
      const q = query.toLowerCase();
      results = results.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q)) ||
          p.keywords.some((k) => k.toLowerCase().includes(q))
      );
    }

    if (type) {
      results = results.filter((p) => p.type === type);
    }

    if (category) {
      results = results.filter((p) => p.category === category);
    }

    if (tags && tags.length > 0) {
      results = results.filter((p) => tags.some((t) => p.tags.includes(t)));
    }

    switch (sortBy) {
      case "popularity":
        results.sort((a, b) => b.stars - a.stars);
        break;
      case "recent":
        results.sort((a, b) => b.updatedAt - a.updatedAt);
        break;
      case "name":
        results.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "downloads":
        results.sort((a, b) => b.downloads - a.downloads);
        break;
    }

    const total = results.length;
    const start = (page - 1) * perPage;
    const paginated = results.slice(start, start + perPage);

    return {
      packages: paginated,
      total,
      page,
      perPage,
    };
  }

  async getPackage(id: string): Promise<PackageManifest | null> {
    return this.registry.get(id) || null;
  }

  async install(packageId: string, options: InstallOptions = {}): Promise<InstalledPackage> {
    const { version, force = false, enable = true } = options;

    const manifest = this.registry.get(packageId);
    if (!manifest) {
      throw new Error(`Package ${packageId} not found in registry`);
    }

    const existing = this.installed.get(packageId);
    if (existing && !force) {
      throw new Error(`Package ${packageId} is already installed`);
    }

    const installPath = path.join(this.config.installDir, packageId);

    const installed: InstalledPackage = {
      manifest: { ...manifest, version: version || manifest.version },
      installPath,
      installedAt: Date.now(),
      updatedAt: Date.now(),
      status: "installed",
      enabled: enable,
      config: {},
    };

    fs.mkdirSync(installPath, { recursive: true });
    fs.writeFileSync(
      path.join(installPath, "manifest.json"),
      JSON.stringify(installed.manifest, null, 2)
    );

    this.installed.set(packageId, installed);
    this.saveInstalled();

    return installed;
  }

  async uninstall(packageId: string, options: UninstallOptions = {}): Promise<boolean> {
    const { removeConfig = false } = options;

    const installed = this.installed.get(packageId);
    if (!installed) {
      return false;
    }

    try {
      if (fs.existsSync(installed.installPath)) {
        fs.rmSync(installed.installPath, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }

    this.installed.delete(packageId);
    this.saveInstalled();

    return true;
  }

  listInstalled(filters?: {
    type?: PackageType;
    enabled?: boolean;
  }): InstalledPackage[] {
    let result = Array.from(this.installed.values());

    if (filters?.type) {
      result = result.filter((p) => p.manifest.type === filters.type);
    }

    if (filters?.enabled !== undefined) {
      result = result.filter((p) => p.enabled === filters.enabled);
    }

    return result.sort((a, b) => a.installedAt - b.installedAt);
  }

  isInstalled(packageId: string): boolean {
    return this.installed.has(packageId);
  }

  getInstalled(packageId: string): InstalledPackage | null {
    return this.installed.get(packageId) || null;
  }

  enablePackage(packageId: string): boolean {
    const pkg = this.installed.get(packageId);
    if (!pkg) return false;
    pkg.enabled = true;
    this.saveInstalled();
    return true;
  }

  disablePackage(packageId: string): boolean {
    const pkg = this.installed.get(packageId);
    if (!pkg) return false;
    pkg.enabled = false;
    this.saveInstalled();
    return true;
  }

  async checkForUpdates(): Promise<Array<{ id: string; currentVersion: string; latestVersion: string }>> {
    const updates: Array<{ id: string; currentVersion: string; latestVersion: string }> = [];

    for (const [id, installed] of this.installed) {
      const latest = this.registry.get(id);
      if (latest && latest.version !== installed.manifest.version) {
        updates.push({
          id,
          currentVersion: installed.manifest.version,
          latestVersion: latest.version,
        });
      }
    }

    return updates;
  }

  async update(packageId: string): Promise<InstalledPackage> {
    const installed = this.installed.get(packageId);
    if (!installed) {
      throw new Error(`Package ${packageId} not installed`);
    }

    const latest = this.registry.get(packageId);
    if (!latest) {
      throw new Error(`Package ${packageId} not found in registry`);
    }

    if (latest.version === installed.manifest.version) {
      return installed;
    }

    installed.manifest = { ...latest };
    installed.updatedAt = Date.now();
    this.saveInstalled();

    return installed;
  }

  getStats() {
    return {
      installed: this.installed.size,
      registrySize: this.registry.size,
      enabled: this.listInstalled({ enabled: true }).length,
      byType: this.countByType(),
    };
  }

  private countByType(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const pkg of this.installed.values()) {
      const type = pkg.manifest.type;
      counts[type] = (counts[type] || 0) + 1;
    }
    return counts;
  }
}

export let defaultPackageManager: PackageManager | null = null;

export function initPackageManager(config?: Partial<MarketplaceConfig>): PackageManager {
  defaultPackageManager = new PackageManager(config);
  return defaultPackageManager;
}

export function getPackageManager(): PackageManager {
  if (!defaultPackageManager) {
    defaultPackageManager = new PackageManager();
  }
  return defaultPackageManager;
}
