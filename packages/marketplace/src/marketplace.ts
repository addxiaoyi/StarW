import { PackageManager } from "./package_manager";
import type {
  PackageManifest,
  InstalledPackage,
  SearchOptions,
  InstallOptions,
  UninstallOptions,
  MarketplaceConfig,
  PackageType,
} from "./types";

export class Marketplace {
  private packageManager: PackageManager;

  constructor(config?: Partial<MarketplaceConfig>) {
    this.packageManager = new PackageManager(config);
  }

  getPackageManager(): PackageManager {
    return this.packageManager;
  }

  async browse(options: SearchOptions = {}): Promise<ReturnType<PackageManager["search"]>> {
    return this.packageManager.search(options);
  }

  async search(query: string, options: Omit<SearchOptions, "query"> = {}): Promise<ReturnType<PackageManager["search"]>> {
    return this.packageManager.search({ ...options, query });
  }

  async getPackage(id: string): Promise<PackageManifest | null> {
    return this.packageManager.getPackage(id);
  }

  async install(packageId: string, options: InstallOptions = {}): Promise<InstalledPackage> {
    return this.packageManager.install(packageId, options);
  }

  async uninstall(packageId: string, options: UninstallOptions = {}): Promise<boolean> {
    return this.packageManager.uninstall(packageId, options);
  }

  listInstalled(filters?: { type?: PackageType; enabled?: boolean }): InstalledPackage[] {
    return this.packageManager.listInstalled(filters);
  }

  isInstalled(packageId: string): boolean {
    return this.packageManager.isInstalled(packageId);
  }

  async update(packageId: string): Promise<InstalledPackage> {
    return this.packageManager.update(packageId);
  }

  async checkForUpdates(): Promise<Array<{ id: string; currentVersion: string; latestVersion: string }>> {
    return this.packageManager.checkForUpdates();
  }

  enable(packageId: string): boolean {
    return this.packageManager.enablePackage(packageId);
  }

  disable(packageId: string): boolean {
    return this.packageManager.disablePackage(packageId);
  }

  async getFeatured(): Promise<PackageManifest[]> {
    const result = await this.packageManager.search({
      sortBy: "popularity",
      perPage: 8,
    });
    return result.packages;
  }

  async getByCategory(category: string): Promise<PackageManifest[]> {
    const result = await this.packageManager.search({
      category,
      sortBy: "popularity",
    });
    return result.packages;
  }

  getCategories(): string[] {
    return [
      "development",
      "productivity",
      "research",
      "design",
      "mcp",
      "templates",
      "security",
      "testing",
    ];
  }

  getStats() {
    return this.packageManager.getStats();
  }
}

export let defaultMarketplace: Marketplace | null = null;

export function initMarketplace(config?: Partial<MarketplaceConfig>): Marketplace {
  defaultMarketplace = new Marketplace(config);
  return defaultMarketplace;
}

export function getMarketplace(): Marketplace {
  if (!defaultMarketplace) {
    defaultMarketplace = new Marketplace();
  }
  return defaultMarketplace;
}
