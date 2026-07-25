/**
 * OpenStar Claw - Feature Unlocks
 *
 * Manages feature flags, capability unlocking, and version-based gating.
 * Similar to HomeRail's feature flags but for agent capabilities.
 */

export type FeatureState = "locked" | "unlocked" | "experimental" | "deprecated";

export interface FeatureFlag {
  id: string;
  name: string;
  description: string;
  state: FeatureState;
  minVersion: string;
  requiresLicense?: "free" | "pro" | "enterprise";
  dependencies?: string[];
}

export class ClawManager {
  private features = new Map<string, FeatureFlag>();
  private currentVersion: string;

  constructor(currentVersion = "0.1.0") {
    this.currentVersion = currentVersion;
  }

  register(flag: FeatureFlag): void {
    this.features.set(flag.id, flag);
  }

  define(
    id: string,
    name: string,
    description: string,
    state: FeatureState = "locked",
    minVersion = "0.1.0"
  ): void {
    this.register({ id, name, description, state, minVersion });
  }

  isAvailable(id: string): boolean {
    const flag = this.features.get(id);
    if (!flag) return false;
    if (flag.state === "locked" || flag.state === "deprecated") return false;
    const [maj, min, pat] = flag.minVersion.split(".").map(Number);
    const [ca, ci, cp] = this.currentVersion.split(".").map(Number);
    if (maj > ca) return false;
    if (maj === ca && min > ci) return false;
    if (maj === ca && min === ci && pat > cp) return false;
    return true;
  }

  unlock(id: string): boolean {
    const flag = this.features.get(id);
    if (!flag) return false;
    if (flag.state === "deprecated") return false;
    flag.state = "unlocked";
    return true;
  }

  lock(id: string): boolean {
    const flag = this.features.get(id);
    if (!flag) return false;
    flag.state = "locked";
    return true;
  }

  listFeatures(): FeatureFlag[] {
    return Array.from(this.features.values());
  }

  getAvailableFeatures(): FeatureFlag[] {
    return this.listFeatures().filter((f) => this.isAvailable(f.id));
  }
}

// ─── Submodule surface ─────────────────────────────────────────────────────
// Claw ships feature patches, a universal patcher, provider config helpers and
// a "lean mode". These were implemented but not exposed from the entry point.
export { UniversalPatcher, universalPatcher } from "./patcher";
export {
  getAllBuiltinPatches,
  registerBuiltinPatches,
  RESTRICTION_PATCHES,
  VISUAL_PATCHES,
  PERFORMANCE_PATCHES,
  PRIVACY_PATCHES,
  RELIABILITY_PATCHES,
} from "./feature_unlocks";
export {
  applyLeanMode,
  getLeanLevel,
  optimizeToolDefinitions,
  calculateTokenSavings,
  type LeanSettings,
} from "./lean_mode";
export {
  loadProviderConfig,
  saveProviderConfig,
  loadClawConfig,
  saveClawConfig,
  applyProviderEnv,
  isThirdPartyProxy,
  getCacheBustingHeaders,
  getClawDir,
  getProviderConfigPath,
  getFeaturesConfigPath,
  getConfigPath,
} from "./provider_config";
export * from "./types";
