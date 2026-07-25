import type { PetMood, PetAction, PetEvent } from "./types";
import { PetMood as PetMoodEnum, PetAction as PetActionEnum } from "./types";

type StateTransition = {
  from: PetMood;
  to: PetMood;
  trigger: string;
  action?: PetAction;
  probability?: number;
};

export class PetStateMachine {
  private currentMood: PetMood;
  private currentAction: PetAction;
  private transitions: StateTransition[] = [];
  private listeners: Array<(event: PetEvent) => void> = [];

  constructor(initialMood: PetMood = "idle", initialAction: PetAction = "idle") {
    this.currentMood = initialMood;
    this.currentAction = initialAction;
    this.initDefaultTransitions();
  }

  private initDefaultTransitions(): void {
    this.transitions = [
      { from: "idle", to: "thinking", trigger: "task_start", action: "thinking_pose", probability: 0.9 },
      { from: "idle", to: "working", trigger: "code_writing", action: "typing", probability: 0.85 },
      { from: "idle", to: "curious", trigger: "tool_use", action: "reading", probability: 0.7 },
      { from: "idle", to: "sleepy", trigger: "idle_too_long", action: "sleeping", probability: 0.5 },
      { from: "idle", to: "happy", trigger: "pet_interaction", action: "waving", probability: 0.95 },

      { from: "thinking", to: "working", trigger: "task_progress", action: "typing", probability: 0.8 },
      { from: "thinking", to: "focused", trigger: "deep_thinking", action: "thinking_pose", probability: 0.9 },
      { from: "thinking", to: "idle", trigger: "task_cancel", action: "sitting", probability: 0.7 },

      { from: "working", to: "celebrating", trigger: "task_complete", action: "celebrating", probability: 1.0 },
      { from: "working", to: "sad", trigger: "task_failed", action: "sitting", probability: 0.8 },
      { from: "working", to: "focused", trigger: "deep_work", action: "typing", probability: 0.9 },
      { from: "working", to: "idle", trigger: "task_pause", action: "sitting", probability: 0.6 },

      { from: "celebrating", to: "happy", trigger: "celebration_end", action: "waving", probability: 0.9 },
      { from: "celebrating", to: "idle", trigger: "return_to_idle", action: "idle", probability: 0.5 },

      { from: "happy", to: "idle", trigger: "return_to_idle", action: "idle", probability: 0.7 },
      { from: "happy", to: "excited", trigger: "good_news", action: "dancing", probability: 0.85 },

      { from: "sad", to: "idle", trigger: "comfort", action: "sitting", probability: 0.6 },
      { from: "sad", to: "happy", trigger: "pet_interaction", action: "waving", probability: 0.7 },

      { from: "sleepy", to: "idle", trigger: "wake_up", action: "stretching", probability: 0.9 },
      { from: "sleepy", to: "sleepy", trigger: "continue_sleep", action: "sleeping", probability: 1.0 },

      { from: "focused", to: "working", trigger: "continue_work", action: "typing", probability: 0.8 },
      { from: "focused", to: "celebrating", trigger: "breakthrough", action: "dancing", probability: 0.95 },
      { from: "focused", to: "idle", trigger: "task_complete", action: "idle", probability: 0.7 },

      { from: "curious", to: "idle", trigger: "return_to_idle", action: "idle", probability: 0.6 },
      { from: "curious", to: "excited", trigger: "discovery", action: "waving", probability: 0.8 },

      { from: "excited", to: "happy", trigger: "calm_down", action: "waving", probability: 0.7 },
      { from: "excited", to: "idle", trigger: "return_to_idle", action: "idle", probability: 0.5 },
    ];
  }

  getMood(): PetMood {
    return this.currentMood;
  }

  getAction(): PetAction {
    return this.currentAction;
  }

  trigger(event: string, data?: Record<string, unknown>): boolean {
    const validTransitions = this.transitions.filter(
      (t) => t.from === this.currentMood && t.trigger === event,
    );

    if (validTransitions.length === 0) {
      return false;
    }

    const transition = validTransitions[Math.floor(Math.random() * validTransitions.length)];
    const probability = transition.probability ?? 1.0;

    if (Math.random() > probability) {
      return false;
    }

    const oldMood = this.currentMood;
    this.currentMood = transition.to;
    if (transition.action) {
      this.currentAction = transition.action;
    }

    const petEvent: PetEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: transition.to === this.currentMood && oldMood !== transition.to ? "mood_change" : "custom",
      timestamp: Date.now(),
      data: {
        oldMood,
        newMood: transition.to,
        trigger: event,
        action: transition.action,
        ...(data || {}),
      },
    };

    this.notifyListeners(petEvent);

    return true;
  }

  setMood(mood: PetMood, action?: PetAction): void {
    const oldMood = this.currentMood;
    this.currentMood = mood;
    if (action) {
      this.currentAction = action;
    }

    const event: PetEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "mood_change",
      timestamp: Date.now(),
      data: {
        oldMood,
        newMood: mood,
        action: this.currentAction,
      },
    };
    this.notifyListeners(event);
  }

  setAction(action: PetAction): void {
    const oldAction = this.currentAction;
    this.currentAction = action;

    const event: PetEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "custom",
      timestamp: Date.now(),
      data: {
        oldAction,
        newAction: action,
      },
    };
    this.notifyListeners(event);
  }

  addListener(listener: (event: PetEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners(event: PetEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // ignore
      }
    }
  }

  getAvailableTransitions(): string[] {
    return [...new Set(this.transitions.filter((t) => t.from === this.currentMood).map((t) => t.trigger))];
  }

  addTransition(transition: StateTransition): void {
    this.transitions.push(transition);
  }
}
