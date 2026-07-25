import { createMemo, createResource } from "solid-js";
import { listSkills } from "../services/acp";

export interface SlashCommand {
  id: string;
  trigger: string;
  title: string;
  description?: string;
  icon: "terminal" | "photo" | "window-cursor" | "sparkle-2" | "subagent";
  source: "skill" | "agent" | "system";
}

const systemCommands: SlashCommand[] = [
  { id: "terminal", trigger: "terminal", title: "切换到终端", icon: "terminal", source: "system" },
  { id: "canvas", trigger: "canvas", title: "切换到画布", icon: "photo", source: "system" },
  { id: "browser", trigger: "browser", title: "切换到浏览器", icon: "window-cursor", source: "system" },
];

export function useSlashCommands() {
  const [skills] = createResource(listSkills, { initialValue: { skills: [], agents: [] } });

  const allCommands = createMemo<SlashCommand[]>(() => [
    ...systemCommands,
    ...(skills()?.skills ?? []).map(
      (s): SlashCommand => ({
        id: s.id,
        trigger: s.id,
        title: s.name,
        description: s.description,
        icon: "sparkle-2",
        source: "skill",
      }),
    ),
    ...(skills()?.agents ?? []).map(
      (a): SlashCommand => ({
        id: a.id,
        trigger: a.id,
        title: a.name,
        description: a.description,
        icon: "subagent",
        source: "agent",
      }),
    ),
  ]);

  return allCommands;
}
