import type { PetState, PetDefinition, PetEvent } from "./types";
import { PetState as PetStateSchema, PetDefinition as PetDefinitionSchema } from "./types";
import { PetStateMachine } from "./state_machine";
import { XpSystem } from "./xp_system";
import { AgentStatusSyncer } from "./agent_sync";
import { InteractionManager } from "./interactions";

export class PetEngine {
  private state: PetState;
  private definition: PetDefinition;
  private stateMachine: PetStateMachine;
  private xpSystem: XpSystem;
  private agentSyncer: AgentStatusSyncer;
  private interactions: InteractionManager;
  private animationFrame: number = 0;
  private lastTick: number = Date.now();
  private listeners: Array<(event: PetEvent) => void> = [];
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(definition?: Partial<PetDefinition>, state?: Partial<PetState>) {
    this.definition = PetDefinitionSchema.parse(definition || { id: "default-cat", name: "小星" });
    this.state = PetStateSchema.parse(state || { petId: this.definition.id, name: this.definition.name });

    this.stateMachine = new PetStateMachine(this.definition.defaultMood);
    this.xpSystem = new XpSystem(this.state.level, this.state.stats);
    this.agentSyncer = new AgentStatusSyncer(this.stateMachine, this.xpSystem);
    this.interactions = new InteractionManager();

    this.stateMachine.addListener((event) => this.forwardEvent(event));
    this.agentSyncer.addListener((event) => this.forwardEvent(event));
  }

  getState(): PetState {
    return { ...this.state };
  }

  getDefinition(): PetDefinition {
    return { ...this.definition };
  }

  getStateMachine(): PetStateMachine {
    return this.stateMachine;
  }

  getXpSystem(): XpSystem {
    return this.xpSystem;
  }

  getAgentSyncer(): AgentStatusSyncer {
    return this.agentSyncer;
  }

  getInteractions(): InteractionManager {
    return this.interactions;
  }

  setPetDefinition(definition: Partial<PetDefinition>): void {
    this.definition = PetDefinitionSchema.parse({ ...this.definition, ...definition });
  }

  setPetName(name: string): void {
    this.state.name = name;
  }

  setPosition(x: number, y: number): void {
    this.state.position = { x, y };
  }

  setEnabled(enabled: boolean): void {
    this.state.enabled = enabled;
  }

  triggerInteraction(interactionId: string): boolean {
    const result = this.interactions.use(interactionId);
    if (!result) return false;

    this.xpSystem.modifyStat("happiness", result.moodChange);
    this.xpSystem.modifyStat("energy", result.energyChange);

    if (result.xpReward > 0) {
      const levelResult = this.xpSystem.addXp(result.xpReward, `interaction_${interactionId}`);
      if (levelResult.leveledUp) {
        this.stateMachine.trigger("good_news", { levelUp: true });
        this.emitEvent({
          id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: "level_up",
          timestamp: Date.now(),
          data: {
            oldLevel: levelResult.oldLevel,
            newLevel: levelResult.newLevel,
          },
        });
      }
    }

    if (result.triggerAnimation) {
      this.stateMachine.setAction(result.triggerAnimation as any);
      setTimeout(() => {
        this.stateMachine.setAction("idle");
      }, 3000);
    }

    this.emitEvent({
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "interaction",
      timestamp: Date.now(),
      data: {
        interactionId,
        interactionName: result.name,
        moodChange: result.moodChange,
        energyChange: result.energyChange,
        xpReward: result.xpReward,
      },
    });

    return true;
  }

  start(): void {
    if (this.tickTimer) return;

    this.lastTick = Date.now();
    this.tickTimer = setInterval(() => this.tick(), 1000);

    this.xpSystem.recordActiveSession();
  }

  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private tick(): void {
    const now = Date.now();
    const deltaMs = now - this.lastTick;
    this.lastTick = now;

    const activeCount = this.agentSyncer.getActiveAgentCount();

    if (activeCount > 0) {
      this.xpSystem.addWorkMinutes(deltaMs / 60000);
    }

    this.xpSystem.decayStats();

    const moodFromStats = this.xpSystem.getMoodFromStats();
    const currentMood = this.stateMachine.getMood();

    if (currentMood === "idle" && moodFromStats !== "idle") {
      if (Math.random() < 0.1) {
        this.stateMachine.setMood(moodFromStats);
      }
    }

    if (activeCount === 0 && currentMood === "idle") {
      const energy = this.xpSystem.getStats().energy;
      if (energy < 30 && Math.random() < 0.05) {
        this.stateMachine.trigger("idle_too_long");
      }
    }

    this.animationFrame++;
  }

  getAnimationFrame(): number {
    return this.animationFrame;
  }

  getCurrentEmoji(): string {
    const mood = this.stateMachine.getMood();
    const action = this.stateMachine.getAction();

    const emojiMap: Record<string, string> = {
      "idle+idle": this.definition.baseEmoji,
      "idle+sitting": "🐱",
      "thinking+thinking_pose": "🤔",
      "working+typing": "💻",
      "focused+typing": "👨‍💻",
      "celebrating+celebrating": "🎉",
      "happy+waving": "👋",
      "excited+dancing": "💃",
      "sleepy+sleeping": "😴",
      "sad+sitting": "😿",
      "curious+reading": "📖",
      "idle+stretching": "🧘",
      "idle+eating": "🍖",
    };

    const key = `${mood}+${action}`;
    return emojiMap[key] || this.definition.baseEmoji;
  }

  addListener(listener: (event: PetEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private forwardEvent(event: PetEvent): void {
    this.emitEvent(event);
  }

  private emitEvent(event: PetEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // ignore
      }
    }
  }

  saveState(): PetState {
    const level = this.xpSystem.getLevel();
    const stats = this.xpSystem.getStats();

    this.state.mood = this.stateMachine.getMood();
    this.state.currentAction = this.stateMachine.getAction();
    this.state.level = level;
    this.state.stats = stats;

    return { ...this.state };
  }
}
