import { z } from "zod";

export const PetMood = z.enum([
  "idle",
  "happy",
  "thinking",
  "working",
  "celebrating",
  "sleepy",
  "curious",
  "sad",
  "excited",
  "focused",
]);
export type PetMood = z.infer<typeof PetMood>;

export const PetAction = z.enum([
  "idle",
  "walking",
  "sitting",
  "sleeping",
  "dancing",
  "typing",
  "reading",
  "waving",
  "celebrating",
  "thinking_pose",
  "stretching",
  "eating",
]);
export type PetAction = z.infer<typeof PetAction>;

export const PetAnimationFrame = z.object({
  id: z.string(),
  durationMs: z.number().default(200),
  offsetX: z.number().default(0),
  offsetY: z.number().default(0),
  scale: z.number().default(1),
  rotation: z.number().default(0),
  opacity: z.number().default(1),
  sprite: z.string().optional(),
  emoji: z.string().optional(),
});
export type PetAnimationFrame = z.infer<typeof PetAnimationFrame>;

export const PetAnimation = z.object({
  id: z.string(),
  name: z.string(),
  action: PetAction,
  mood: PetMood.optional(),
  frames: z.array(PetAnimationFrame).default(() => []),
  loop: z.boolean().default(true),
  loopDelayMs: z.number().default(0),
  transitionInMs: z.number().default(100),
  transitionOutMs: z.number().default(100),
});
export type PetAnimation = z.infer<typeof PetAnimation>;

export const PetLevel = z.object({
  level: z.number().default(1),
  xp: z.number().default(0),
  xpToNext: z.number().default(100),
  totalXp: z.number().default(0),
});
export type PetLevel = z.infer<typeof PetLevel>;

export const PetStats = z.object({
  happiness: z.number().default(80),
  energy: z.number().default(90),
  focus: z.number().default(70),
  productivity: z.number().default(0),
  tasksCompleted: z.number().default(0),
  linesOfCode: z.number().default(0),
  commitsMade: z.number().default(0),
  totalWorkMinutes: z.number().default(0),
  streakDays: z.number().default(0),
  lastActiveAt: z.number().default(() => Date.now()),
});
export type PetStats = z.infer<typeof PetStats>;

export const PetDefinition = z.object({
  id: z.string(),
  name: z.string(),
  species: z.string().default("cat"),
  description: z.string().default(""),
  author: z.string().default("openstar"),
  version: z.string().default("1.0.0"),
  defaultMood: PetMood.default("idle"),
  animations: z.array(PetAnimation).default(() => []),
  baseEmoji: z.string().default("🐱"),
  color: z.string().default("#6366f1"),
  size: z.number().default(64),
  traits: z.array(z.string()).default(() => []),
  unlockConditions: z.record(z.string(), z.unknown()).default(() => ({})),
});
export type PetDefinition = z.infer<typeof PetDefinition>;

export const PetState = z.object({
  petId: z.string().default("default-cat"),
  name: z.string().default("小星"),
  mood: PetMood.default("idle"),
  currentAction: PetAction.default("idle"),
  currentAnimation: z.string().default("idle"),
  level: PetLevel.default(() => ({ level: 1, xp: 0, xpToNext: 100, totalXp: 0 })),
  stats: PetStats.default(() => ({
    happiness: 80,
    energy: 90,
    focus: 70,
    productivity: 0,
    tasksCompleted: 0,
    linesOfCode: 0,
    commitsMade: 0,
    totalWorkMinutes: 0,
    streakDays: 0,
    lastActiveAt: Date.now(),
  })),
  position: z.object({
    x: z.number().default(100),
    y: z.number().default(100),
  }).default(() => ({ x: 100, y: 100 })),
  enabled: z.boolean().default(true),
  alwaysOnTop: z.boolean().default(true),
  transparency: z.number().default(0.9),
  interactable: z.boolean().default(true),
  autoHideWhenFullscreen: z.boolean().default(true),
  walkAroundEnabled: z.boolean().default(false),
});
export type PetState = z.infer<typeof PetState>;

export const PetEvent = z.object({
  id: z.string(),
  type: z.enum([
    "mood_change",
    "action_change",
    "level_up",
    "xp_gain",
    "interaction",
    "agent_status",
    "task_start",
    "task_complete",
    "custom",
  ]),
  timestamp: z.number().default(() => Date.now()),
  data: z.record(z.string(), z.unknown()).default(() => ({})),
});
export type PetEvent = z.infer<typeof PetEvent>;

export const PetInteraction = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  emoji: z.string().optional(),
  moodChange: z.number().default(0),
  energyChange: z.number().default(0),
  xpReward: z.number().default(0),
  triggerAnimation: z.string().optional(),
  cooldownMs: z.number().default(0),
  lastUsedAt: z.number().default(0),
  enabled: z.boolean().default(true),
});
export type PetInteraction = z.infer<typeof PetInteraction>;

export const AgentStatusSync = z.object({
  agentId: z.string(),
  agentName: z.string(),
  status: z.enum(["idle", "running", "paused", "completed", "failed"]),
  currentTask: z.string().optional(),
  progress: z.number().default(0),
  toolsUsed: z.array(z.string()).default(() => []),
  startTime: z.number().optional(),
});
export type AgentStatusSync = z.infer<typeof AgentStatusSync>;
