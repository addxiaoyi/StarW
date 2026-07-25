import type { LeanLevel } from "./types";

const BASE_DENY_TOOLS = [
  "DesignSync",
  "NotebookEdit",
  "PushNotification",
  "RemoteTrigger",
  "CronCreate",
  "CronDelete",
  "CronList",
];

const MAX_DENY_TOOLS = [
  "EnterPlanMode",
  "ExitPlanMode",
  "SendMessage",
  "ScheduleWakeup",
  "AskUserQuestion",
  "ReportFindings",
];

const BASE_FLAGS = [
  "disableWorkflows",
  "disableRemoteControl",
  "disableClaudeAiConnectors",
  "disableArtifact",
];

const MAX_FLAGS = ["disableBundledSkills"];

export interface LeanSettings {
  permissions: {
    deny: string[];
  };
  [key: string]: unknown;
}

export function applyLeanMode(
  settings: LeanSettings,
  level: LeanLevel
): LeanSettings {
  const result: LeanSettings = {
    ...settings,
    permissions: {
      deny: [...(settings.permissions?.deny || [])],
    },
  };

  if (level === "off") {
    for (const flag of [...BASE_FLAGS, ...MAX_FLAGS]) {
      delete result[flag];
    }
    const allDeny = new Set([...BASE_DENY_TOOLS, ...MAX_DENY_TOOLS]);
    result.permissions.deny = result.permissions.deny.filter(
      (t) => !allDeny.has(t)
    );
    return result;
  }

  const isMax = level === "max";
  const denyTools = isMax
    ? [...BASE_DENY_TOOLS, ...MAX_DENY_TOOLS]
    : BASE_DENY_TOOLS;
  const flags = isMax ? [...BASE_FLAGS, ...MAX_FLAGS] : BASE_FLAGS;

  const denySet = new Set(result.permissions.deny);
  for (const tool of denyTools) {
    denySet.add(tool);
  }
  result.permissions.deny = Array.from(denySet);

  for (const flag of flags) {
    result[flag] = true;
  }

  if (!isMax) {
    for (const flag of MAX_FLAGS) {
      delete result[flag];
    }
    const maxDenySet = new Set(MAX_DENY_TOOLS);
    result.permissions.deny = result.permissions.deny.filter(
      (t) => !maxDenySet.has(t)
    );
  }

  return result;
}

export function getLeanLevel(settings: LeanSettings): LeanLevel {
  const hasMaxFlags = MAX_FLAGS.every((f) => settings[f] === true);
  const hasBaseFlags = BASE_FLAGS.every((f) => settings[f] === true);

  if (hasMaxFlags) return "max";
  if (hasBaseFlags) return "on";
  return "off";
}

export function optimizeToolDefinitions(
  tools: Array<{ name: string; description: string }>
): Array<{ name: string; description: string }> {
  const skipPatterns = [
    /workflow/i,
    /artifact/i,
    /notification/i,
    /remote/i,
  ];

  return tools.filter(
    (t) => !skipPatterns.some((p) => p.test(t.name) || p.test(t.description))
  );
}

export function calculateTokenSavings(
  originalTools: number,
  leanTools: number
): { saved: number; percent: number } {
  const saved = originalTools - leanTools;
  const percent = originalTools > 0 ? (saved / originalTools) * 100 : 0;
  return { saved, percent };
}
