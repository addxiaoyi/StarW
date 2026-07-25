/**
 * OpenStar Desktop Pet
 *
 * State machine for the desktop pet/assistant companion.
 * Tracks mood, activity, and interactions for a delightful UX.
 */

export type PetMood = "happy" | "working" | "sleeping" | "thinking" | "alert" | "idle";
export type PetAction = "idle" | "greet" | "work" | "rest" | "alert" | "celebrate";

export interface PetState {
  id: string;
  name: string;
  mood: PetMood;
  action: PetAction;
  energy: number; // 0-100
  happiness: number; // 0-100
  level: number;
  experience: number;
  lastInteraction: number;
}

export interface TransitionRule {
  from: PetMood;
  event: string;
  to: PetMood;
  action?: PetAction;
}

export class PetStateMachine {
  private state: PetState;
  private transitions = new Map<string, TransitionRule>();
  private listeners = new Set<(state: PetState) => void>();

  constructor(name = "StarPet", id = "pet_0") {
    this.state = {
      id,
      name,
      mood: "idle",
      action: "idle",
      energy: 100,
      happiness: 80,
      level: 1,
      experience: 0,
      lastInteraction: Date.now(),
    };
  }

  addTransition(rule: TransitionRule): void {
    this.transitions.set(`${rule.from}:${rule.event}`, rule);
  }

  dispatch(event: string): PetState {
    const key = `${this.state.mood}:${event}`;
    const rule = this.transitions.get(key);
    if (rule) {
      this.state = {
        ...this.state,
        mood: rule.to,
        action: rule.action ?? this.state.action,
        lastInteraction: Date.now(),
      };
      this.notify();
    }
    return this.getState();
  }

  onStateChange(listener: (state: PetState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l(this.getState());
  }

  getState(): PetState {
    return { ...this.state };
  }

  awardExperience(amount: number): void {
    this.state.experience += amount;
    const newLevel = Math.floor(this.state.experience / 100) + 1;
    if (newLevel > this.state.level) {
      this.state.level = newLevel;
    }
    this.notify();
  }

  setEnergy(energy: number): void {
    this.state.energy = Math.max(0, Math.min(100, energy));
    this.notify();
  }

  setHappiness(happiness: number): void {
    this.state.happiness = Math.max(0, Math.min(100, happiness));
    this.notify();
  }

  // Default behaviors
  tick(): void {
    const now = Date.now();
    const idleFor = now - this.state.lastInteraction;
    if (idleFor > 60000 && this.state.mood !== "sleeping") {
      this.dispatch("idle_timeout");
    }
  }
}

// Default pet personality
export function createDefaultPet(): PetStateMachine {
  const pet = new PetStateMachine();

  pet.addTransition({ from: "idle", event: "task_start", to: "working", action: "work" });
  pet.addTransition({ from: "working", event: "task_done", to: "happy", action: "celebrate" });
  pet.addTransition({ from: "working", event: "task_fail", to: "alert", action: "alert" });
  pet.addTransition({ from: "happy", event: "idle_timeout", to: "idle" });
  pet.addTransition({ from: "alert", event: "user_ack", to: "idle" });
  pet.addTransition({ from: "idle", event: "greet", to: "happy", action: "greet" });
  pet.addTransition({ from: "working", event: "thinking", to: "thinking" });
  pet.addTransition({ from: "thinking", event: "resume", to: "working", action: "work" });

  return pet;
}

// ─── Engine surface (classes implemented in sibling modules) ───────────────
// The pet package contains a full engine (mood/XP/agent-sync/interactions)
// that was previously not reachable from the package entry point.
export { PetEngine } from "./pet_engine";
export { XpSystem } from "./xp_system";
export { AgentStatusSyncer } from "./agent_sync";
export { InteractionManager, DEFAULT_INTERACTIONS } from "./interactions";
