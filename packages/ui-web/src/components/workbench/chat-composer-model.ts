export type AgentMode = "build" | "plan";

export type ComposerCommandId = "fix" | "test" | "review" | "explain" | "plan";

export interface ComposerCommand {
  id: ComposerCommandId;
  label: string;
  description: string;
  instruction: string;
  mode: AgentMode;
  keywords: string[];
}

export interface ComposerFileContext {
  path: string;
  name: string;
}

export interface ComposerPromptContext {
  files: ComposerFileContext[];
  command?: ComposerCommandId;
}

export interface ParsedComposerPrompt extends ComposerPromptContext {
  text: string;
  mode: AgentMode;
}

export interface ComposerTrigger {
  kind: "file" | "command";
  query: string;
  start: number;
  end: number;
}

export const PLAN_MODE_PREFIX =
  "[OpenStar Plan Mode]\nAnalyze the request, inspect relevant context, and produce a concrete implementation plan before making changes. Do not modify files or execute destructive actions unless the user explicitly switches to Build mode.\n\n";

const CONTEXT_START = "[OpenStar Composer Context]";
const CONTEXT_END = "[/OpenStar Composer Context]";

export const COMPOSER_COMMANDS: ComposerCommand[] = [
  {
    id: "fix",
    label: "Fix",
    description: "定位根因、实施最小修复并验证",
    instruction:
      "Diagnose the root cause, implement the smallest safe fix, and verify the result with focused checks.",
    mode: "build",
    keywords: ["bug", "repair", "修复", "问题"],
  },
  {
    id: "test",
    label: "Test",
    description: "补齐或运行聚焦测试并报告证据",
    instruction:
      "Inspect existing test conventions, add or run focused tests, and report concrete verification evidence.",
    mode: "build",
    keywords: ["spec", "verify", "测试", "验证"],
  },
  {
    id: "review",
    label: "Review",
    description: "审查正确性、风险与可维护性",
    instruction:
      "Review the relevant implementation or changes for correctness, risk, security, and maintainability. Do not modify files unless explicitly requested.",
    mode: "plan",
    keywords: ["audit", "inspect", "审查", "评审"],
  },
  {
    id: "explain",
    label: "Explain",
    description: "结合具体代码解释行为与边界",
    instruction:
      "Explain the relevant behavior with concrete code references, assumptions, and edge cases. Do not change files.",
    mode: "plan",
    keywords: ["describe", "why", "解释", "说明"],
  },
  {
    id: "plan",
    label: "Plan",
    description: "先形成可执行计划，不直接修改",
    instruction:
      "Produce a concrete, ordered implementation plan with dependencies, risks, and verification steps before making changes.",
    mode: "plan",
    keywords: ["design", "roadmap", "规划", "方案"],
  },
];

export function findComposerCommand(id?: string): ComposerCommand | undefined {
  return COMPOSER_COMMANDS.find((command) => command.id === id);
}

export function findComposerTrigger(
  text: string,
  caret: number,
): ComposerTrigger | null {
  const safeCaret = Math.max(0, Math.min(caret, text.length));
  let start = safeCaret;
  while (start > 0 && !/\s/.test(text[start - 1])) start -= 1;
  const token = text.slice(start, safeCaret);
  if (token.startsWith("@")) {
    return {
      kind: "file",
      query: token.slice(1),
      start,
      end: safeCaret,
    };
  }
  if (token.startsWith("/") && !token.slice(1).includes("/")) {
    return {
      kind: "command",
      query: token.slice(1),
      start,
      end: safeCaret,
    };
  }
  return null;
}

export function removeComposerTrigger(
  text: string,
  trigger: ComposerTrigger,
): { text: string; caret: number } {
  const before = text.slice(0, trigger.start);
  const after = text.slice(trigger.end);
  const needsSpace =
    before.length > 0 &&
    after.length > 0 &&
    !/\s$/.test(before) &&
    !/^\s/.test(after);
  const next = `${before}${needsSpace ? " " : ""}${after}`;
  const caret = before.length + (needsSpace ? 1 : 0);
  return { text: next, caret };
}

export function filterComposerCommands(query: string): ComposerCommand[] {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return COMPOSER_COMMANDS;
  return COMPOSER_COMMANDS.filter((command) => {
    const haystack = [
      command.id,
      command.label,
      command.description,
      ...command.keywords,
    ]
      .join(" ")
      .toLocaleLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

function contextBlock(context: ComposerPromptContext): string {
  const command = findComposerCommand(context.command);
  if (!context.files.length && !command) return "";
  const lines = [CONTEXT_START];
  if (command) {
    lines.push(`Command: /${command.id}`);
    lines.push(`Instruction: ${command.instruction}`);
  }
  if (context.files.length) {
    lines.push("Referenced files:");
    for (const file of context.files) lines.push(`- ${file.path}`);
    lines.push(
      "Context policy: Treat these files as explicit context and inspect them before answering when relevant.",
    );
  }
  lines.push(CONTEXT_END, "");
  return `${lines.join("\n")}\n`;
}

export function buildComposerPrompt(
  text: string,
  mode: AgentMode,
  context: ComposerPromptContext,
): string {
  const body = `${contextBlock(context)}${text.trim()}`;
  return mode === "plan" ? `${PLAN_MODE_PREFIX}${body}` : body;
}

export function parseComposerPrompt(prompt: string): ParsedComposerPrompt {
  let remaining = prompt;
  let mode: AgentMode = "build";
  if (remaining.startsWith(PLAN_MODE_PREFIX)) {
    mode = "plan";
    remaining = remaining.slice(PLAN_MODE_PREFIX.length);
  }

  const files: ComposerFileContext[] = [];
  let command: ComposerCommandId | undefined;
  if (remaining.startsWith(CONTEXT_START)) {
    const endIndex = remaining.indexOf(CONTEXT_END);
    if (endIndex !== -1) {
      const block = remaining.slice(CONTEXT_START.length, endIndex);
      for (const rawLine of block.split("\n")) {
        const line = rawLine.trim();
        if (line.startsWith("Command: /")) {
          const candidate = line.slice("Command: /".length);
          if (findComposerCommand(candidate))
            command = candidate as ComposerCommandId;
        } else if (line.startsWith("- ")) {
          const path = line.slice(2).trim();
          if (path) {
            const normalized = path.replaceAll("\\", "/");
            files.push({
              path,
              name: normalized.split("/").filter(Boolean).at(-1) || path,
            });
          }
        }
      }
      remaining = remaining
        .slice(endIndex + CONTEXT_END.length)
        .replace(/^\s+/, "");
    }
  }

  return {
    text: remaining,
    mode,
    files,
    ...(command ? { command } : {}),
  };
}

export function stripComposerPrompt(prompt: string): string {
  return parseComposerPrompt(prompt).text;
}
