import type { PetLevel, PetStats } from "./types";
import { PetLevel as PetLevelSchema, PetStats as PetStatsSchema } from "./types";

export class XpSystem {
  private level: PetLevel;
  private stats: PetStats;

  constructor(initialLevel?: Partial<PetLevel>, initialStats?: Partial<PetStats>) {
    this.level = PetLevelSchema.parse(initialLevel || {});
    this.stats = PetStatsSchema.parse(initialStats || {});
  }

  getLevel(): PetLevel {
    return { ...this.level };
  }

  getStats(): PetStats {
    return { ...this.stats };
  }

  addXp(amount: number, reason?: string): { leveledUp: boolean; oldLevel: number; newLevel: number } {
    const oldLevel = this.level.level;
    this.level.xp += amount;
    this.level.totalXp += amount;

    let leveledUp = false;
    while (this.level.xp >= this.level.xpToNext) {
      this.level.xp -= this.level.xpToNext;
      this.level.level++;
      this.level.xpToNext = this.calculateXpToNext(this.level.level);
      leveledUp = true;
    }

    this.updateStat("productivity", Math.min(100, this.stats.productivity + amount * 0.01));
    this.stats.lastActiveAt = Date.now();

    return { leveledUp, oldLevel, newLevel: this.level.level };
  }

  private calculateXpToNext(level: number): number {
    return Math.floor(100 * Math.pow(1.15, level - 1));
  }

  addTaskCompleted(xpReward = 20): void {
    this.addXp(xpReward, "task_complete");
    this.stats.tasksCompleted++;
    this.updateStat("happiness", Math.min(100, this.stats.happiness + 2));
  }

  addCodeWritten(lines: number): void {
    this.stats.linesOfCode += lines;
    if (lines > 0) {
      this.addXp(Math.min(10, Math.floor(lines / 10)), "code_written");
    }
  }

  addCommit(): void {
    this.stats.commitsMade++;
    this.addXp(15, "commit");
    this.updateStat("happiness", Math.min(100, this.stats.happiness + 1));
  }

  addWorkMinutes(minutes: number): void {
    this.stats.totalWorkMinutes += minutes;
    if (minutes > 0) {
      this.addXp(Math.floor(minutes * 0.5), "work_time");
    }
  }

  updateStat(stat: keyof PetStats, value: number): void {
    (this.stats as Record<string, number>)[stat] = Math.max(0, Math.min(100, value));
  }

  modifyStat(stat: keyof PetStats, delta: number): number {
    const current = (this.stats as Record<string, number>)[stat] || 0;
    const newValue = Math.max(0, Math.min(100, current + delta));
    (this.stats as Record<string, number>)[stat] = newValue;
    return newValue;
  }

  decayStats(): void {
    const now = Date.now();
    const hoursSinceActive = (now - this.stats.lastActiveAt) / (1000 * 60 * 60);

    if (hoursSinceActive > 1) {
      const decayRate = Math.min(1, hoursSinceActive * 0.1);
      this.modifyStat("happiness", -decayRate * 2);
      this.modifyStat("energy", -decayRate * 3);
      this.modifyStat("focus", -decayRate * 1.5);
    }

    if (hoursSinceActive > 24) {
      this.stats.streakDays = 0;
    }
  }

  recordActiveSession(): void {
    const today = new Date().toDateString();
    const lastActiveDate = new Date(this.stats.lastActiveAt).toDateString();

    if (today !== lastActiveDate) {
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      if (lastActiveDate === yesterday) {
        this.stats.streakDays++;
      } else if (lastActiveDate !== today) {
        this.stats.streakDays = 1;
      }
    }

    this.stats.lastActiveAt = Date.now();
  }

  getMoodFromStats(): "happy" | "idle" | "sad" | "sleepy" | "excited" {
    const { happiness, energy, focus } = this.stats;

    if (energy < 20) return "sleepy";
    if (happiness < 30) return "sad";
    if (happiness > 80 && energy > 60) return "excited";
    if (happiness > 60) return "happy";
    return "idle";
  }

  reset(): void {
    this.level = PetLevelSchema.parse({});
    this.stats = PetStatsSchema.parse({});
  }
}
