import type {
  PatchDefinition,
  PatchResult,
  PatchReport,
  PatchStatus,
} from "./types";

export class UniversalPatcher {
  private patches: Map<string, PatchDefinition> = new Map();
  private lastResult: PatchReport | null = null;

  registerPatch(patch: PatchDefinition): void {
    this.patches.set(patch.id, patch);
  }

  registerPatches(patches: PatchDefinition[]): void {
    for (const patch of patches) {
      this.registerPatch(patch);
    }
  }

  unregisterPatch(patchId: string): boolean {
    return this.patches.delete(patchId);
  }

  getPatch(patchId: string): PatchDefinition | undefined {
    return this.patches.get(patchId);
  }

  listPatches(category?: PatchDefinition["category"]): PatchDefinition[] {
    let result = Array.from(this.patches.values());

    if (category) {
      result = result.filter((p) => p.category === category);
    }

    return result.sort((a, b) => a.priority - b.priority);
  }

  enablePatch(patchId: string): boolean {
    const patch = this.patches.get(patchId);
    if (!patch) return false;
    patch.enabled = true;
    return true;
  }

  disablePatch(patchId: string): boolean {
    const patch = this.patches.get(patchId);
    if (!patch) return false;
    patch.enabled = false;
    return true;
  }

  apply(source: string, options?: {
    only?: string[];
    exclude?: string[];
    categories?: PatchDefinition["category"][];
  }): PatchReport {
    const startTime = Date.now();
    const results: PatchResult[] = [];
    let current = source;
    let applied = 0;
    let failed = 0;
    let skipped = 0;

    const patchesToApply = this.getActivePatches(options);

    for (const patch of patchesToApply) {
      const patchStart = Date.now();

      try {
        const { output, matchCount, status, error } = this.applySinglePatch(current, patch);
        current = output;

        const result: PatchResult = {
          patchId: patch.id,
          status,
          matchCount,
          error,
          durationMs: Date.now() - patchStart,
        };

        results.push(result);

        if (status === "applied") applied++;
        else if (status === "failed") failed++;
        else if (status === "skipped") skipped++;
      } catch (err) {
        const result: PatchResult = {
          patchId: patch.id,
          status: "failed",
          matchCount: 0,
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - patchStart,
        };
        results.push(result);
        failed++;
      }
    }

    const report: PatchReport = {
      sourceSize: source.length,
      resultSize: current.length,
      totalPatches: patchesToApply.length,
      appliedCount: applied,
      failedCount: failed,
      skippedCount: skipped,
      results,
      durationMs: Date.now() - startTime,
    };

    this.lastResult = report;
    return report;
  }

  private applySinglePatch(
    source: string,
    patch: PatchDefinition
  ): { output: string; matchCount: number; status: PatchStatus; error?: string } {
    if (!patch.enabled) {
      return { output: source, matchCount: 0, status: "skipped" };
    }

    if (patch.sentinel && !source.includes(patch.sentinel)) {
      return { output: source, matchCount: 0, status: "skipped" };
    }

    let regex: RegExp;
    try {
      regex = new RegExp(patch.pattern, patch.flags);
    } catch (err) {
      return {
        output: source,
        matchCount: 0,
        status: "failed",
        error: `Invalid regex: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const matches = source.match(regex);
    const matchCount = matches ? matches.length : 0;

    if (matchCount === 0) {
      return { output: source, matchCount: 0, status: "skipped" };
    }

    if (patch.unique && matchCount > 1) {
      return {
        output: source,
        matchCount,
        status: "failed",
        error: `Unique patch matched ${matchCount} times`,
      };
    }

    if (patch.validate) {
      const firstMatch = source.match(regex)?.[0] || "";
      const validateFn = patch.validate as (match: string, source: string) => boolean;
      if (!validateFn(firstMatch, source)) {
        return { output: source, matchCount: 0, status: "skipped" };
      }
    }

    const output = source.replace(regex, patch.replacement);

    return { output, matchCount, status: "applied" };
  }

  private getActivePatches(options?: {
    only?: string[];
    exclude?: string[];
    categories?: PatchDefinition["category"][];
  }): PatchDefinition[] {
    let patches = Array.from(this.patches.values());

    if (options?.only) {
      const onlySet = new Set(options.only);
      patches = patches.filter((p) => onlySet.has(p.id));
    }

    if (options?.exclude) {
      const excludeSet = new Set(options.exclude);
      patches = patches.filter((p) => !excludeSet.has(p.id));
    }

    if (options?.categories) {
      const catSet = new Set(options.categories);
      patches = patches.filter((p) => catSet.has(p.category));
    }

    return patches.sort((a, b) => a.priority - b.priority);
  }

  getLastResult(): PatchReport | null {
    return this.lastResult;
  }

  getStats() {
    return {
      totalPatches: this.patches.size,
      enabledPatches: Array.from(this.patches.values()).filter((p) => p.enabled).length,
      categories: this.getCategoryCounts(),
    };
  }

  private getCategoryCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const patch of this.patches.values()) {
      counts[patch.category] = (counts[patch.category] || 0) + 1;
    }
    return counts;
  }
}

export const universalPatcher = new UniversalPatcher();
