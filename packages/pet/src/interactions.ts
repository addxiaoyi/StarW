import type { PetInteraction } from "./types";

export const DEFAULT_INTERACTIONS = [
  {
    id: "pet",
    name: "摸摸头",
    description: "轻轻地摸摸宠物的头",
    emoji: "🤚",
    moodChange: 5,
    energyChange: 0,
    xpReward: 2,
    triggerAnimation: "waving",
    cooldownMs: 5000,
    lastUsedAt: 0,
  },
  {
    id: "feed",
    name: "喂食",
    description: "给宠物一些好吃的",
    emoji: "🍖",
    moodChange: 8,
    energyChange: 15,
    xpReward: 5,
    triggerAnimation: "eating",
    cooldownMs: 60000,
  },
  {
    id: "play",
    name: "玩耍",
    description: "和宠物一起玩",
    emoji: "🎾",
    moodChange: 12,
    energyChange: -10,
    xpReward: 10,
    triggerAnimation: "dancing",
    cooldownMs: 30000,
  },
  {
    id: "sleep",
    name: "休息",
    description: "让宠物休息一会儿",
    emoji: "😴",
    moodChange: 3,
    energyChange: 25,
    xpReward: 1,
    triggerAnimation: "sleeping",
    cooldownMs: 0,
  },
  {
    id: "dance",
    name: "跳舞",
    description: "让宠物跳个舞",
    emoji: "💃",
    moodChange: 10,
    energyChange: -5,
    xpReward: 3,
    triggerAnimation: "dancing",
    cooldownMs: 10000,
  },
  {
    id: "stretch",
    name: "伸懒腰",
    description: "让宠物伸展一下",
    emoji: "🧘",
    moodChange: 4,
    energyChange: 8,
    xpReward: 2,
    triggerAnimation: "stretching",
    cooldownMs: 15000,
  },
] as unknown as PetInteraction[];

export class InteractionManager {
  private interactions: Map<string, PetInteraction> = new Map();

  constructor(initialInteractions: PetInteraction[] = DEFAULT_INTERACTIONS as PetInteraction[]) {
    for (const interaction of initialInteractions) {
      this.interactions.set(interaction.id, interaction);
    }
  }

  getAvailable(): PetInteraction[] {
    const now = Date.now();
    return Array.from(this.interactions.values()).filter((i) => {
      if (i.enabled === false) return false;
      if (i.cooldownMs > 0 && now - i.lastUsedAt < i.cooldownMs) return false;
      return true;
    });
  }

  getAll(): PetInteraction[] {
    return Array.from(this.interactions.values());
  }

  get(id: string): PetInteraction | undefined {
    return this.interactions.get(id);
  }

  canUse(id: string): boolean {
    const interaction = this.interactions.get(id);
    if (!interaction) return false;
    const now = Date.now();
    if (interaction.cooldownMs > 0 && now - interaction.lastUsedAt < interaction.cooldownMs) {
      return false;
    }
    return true;
  }

  getCooldownRemaining(id: string): number {
    const interaction = this.interactions.get(id);
    if (!interaction) return 0;
    const elapsed = Date.now() - interaction.lastUsedAt;
    return Math.max(0, interaction.cooldownMs - elapsed);
  }

  use(id: string): PetInteraction | null {
    const interaction = this.interactions.get(id);
    if (!interaction || !this.canUse(id)) {
      return null;
    }

    interaction.lastUsedAt = Date.now();
    return { ...interaction };
  }

  addInteraction(interaction: PetInteraction): void {
    this.interactions.set(interaction.id, interaction);
  }

  removeInteraction(id: string): boolean {
    return this.interactions.delete(id);
  }
}
