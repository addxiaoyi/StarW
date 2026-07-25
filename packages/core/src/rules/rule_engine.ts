import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

export type RuleAction = "allow" | "block" | "confirm";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface SessionRule {
  type: "sessionRule";
  name: string;
  description?: string;
  pattern: string;
  action: Extract<RuleAction, "allow" | "block" | "confirm">;
  reason?: string;
  caseSensitive?: boolean;
}

export interface SceneRouterRule {
  type: "sceneRouter";
  name: string;
  description?: string;
  pattern: string;
  agentId?: string;
  capabilities?: string[];
  reason?: string;
  caseSensitive?: boolean;
}

export interface ToolGuardRule {
  type: "toolGuard";
  name: string;
  description?: string;
  tools: string[];
  pattern: string;
  action: Extract<RuleAction, "allow" | "block" | "confirm">;
  reason?: string;
  risk?: RiskLevel;
  caseSensitive?: boolean;
}

export type Rule = SessionRule | SceneRouterRule | ToolGuardRule;

export interface SessionCheckResult {
  action: RuleAction;
  reason: string;
  risk: RiskLevel;
  matchedRules: string[];
}

export interface SceneCheckResult {
  agentId?: string;
  capabilities: string[];
  reason: string;
  matchedRules: string[];
}

export interface ToolCheckResult {
  action: RuleAction;
  reason: string;
  risk: RiskLevel;
  matchedRules: string[];
}

export interface RuleEngineOptions {
  rules?: Rule[];
  rulesPath?: string;
}

function getDefaultRulesPath(): string {
  return path.join(os.homedir(), ".openstar", "rules.json");
}

function buildDefaultRules(): Rule[] {
  return [
    {
      type: "sessionRule",
      name: "deploy-confirmation",
      description: "Tasks mentioning deploy require confirmation",
      pattern: "\\bdeploy\\b",
      action: "confirm",
      reason: "Deployment-related task should be reviewed",
    },
    {
      type: "sessionRule",
      name: "destructive-block",
      description: "Block tasks that appear destructive",
      pattern: "\\b(delete all|destroy|wipe|drop database|rm -rf)\\b",
      action: "block",
      reason: "Potentially destructive operation",
    },
    {
      type: "sceneRouter",
      name: "code-review-router",
      description: "Route code review tasks to the code reviewer agent",
      pattern: "\\b(code review|review code|pr review)\\b",
      agentId: "code-reviewer",
      capabilities: ["code-review"],
      reason: "Matched code review scene",
    },
    {
      type: "sceneRouter",
      name: "security-router",
      description: "Route security tasks to the security researcher agent",
      pattern: "\\b(security|vulnerability|cve|exploit|pentest)\\b",
      agentId: "security-researcher",
      capabilities: ["security-research"],
      reason: "Matched security research scene",
    },
    {
      type: "toolGuard",
      name: "block-rm-root",
      description: "Block rm -rf / style commands",
      tools: ["Bash", "bash", "shell"],
      pattern: "rm\\s+(-\\w*f\\w*\\s+)?/($|\\s)",
      action: "block",
      reason: "Destructive operation: rm -rf /",
      risk: "critical",
    },
    {
      type: "toolGuard",
      name: "block-mkfs",
      description: "Block filesystem formatting",
      tools: ["Bash", "bash", "shell"],
      pattern: "\\bmkfs\\b",
      action: "block",
      reason: "Destructive operation: mkfs",
      risk: "critical",
    },
    {
      type: "toolGuard",
      name: "block-dd-device",
      description: "Block dd writes to devices",
      tools: ["Bash", "bash", "shell"],
      pattern: "dd\\s+.*of=/dev/",
      action: "block",
      reason: "Destructive operation: dd to device",
      risk: "critical",
    },
    {
      type: "toolGuard",
      name: "block-system-write",
      description: "Block writes to system directories",
      tools: ["Write", "write"],
      pattern: "^(?:[A-Z]:)?(?:\\\\|/)(?:Windows|Program Files|etc|boot|usr|System|EFI)(?:\\\\|/|$)",
      action: "block",
      reason: "System directory write",
      risk: "critical",
    },
    {
      type: "toolGuard",
      name: "confirm-network-scan",
      description: "Confirm network scans outside localhost",
      tools: ["Bash", "bash", "shell"],
      pattern: "(nmap|masscan|rustscan)\\s+(?!.*127\\.0\\.0\\.1)(?!.*localhost)",
      action: "confirm",
      reason: "Network scan against non-localhost target",
      risk: "medium",
    },
  ];
}

function matchesPattern(text: string, pattern: string, caseSensitive = false): boolean {
  if (!text) return false;
  const flags = caseSensitive ? "" : "i";
  try {
    const regex = new RegExp(pattern, flags);
    return regex.test(text);
  } catch {
    return false;
  }
}

export class RuleEngine {
  private rules: Rule[];
  private rulesPath: string;

  constructor(options: RuleEngineOptions = {}) {
    this.rulesPath = options.rulesPath ?? getDefaultRulesPath();
    this.rules = options.rules ?? [];
  }

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.rulesPath, "utf8");
      const parsed = JSON.parse(data) as unknown;
      if (Array.isArray(parsed)) {
        this.rules = parsed as Rule[];
        return;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`[RuleEngine] Failed to load rules from ${this.rulesPath}:`, (err as Error).message);
      }
    }
    this.rules = buildDefaultRules();
  }

  reload(): Rule[] {
    this.rules = buildDefaultRules();
    return this.rules;
  }

  async reloadFromDisk(): Promise<Rule[]> {
    await this.load();
    return this.rules;
  }

  listRules(): Rule[] {
    return [...this.rules];
  }

  evaluateSession(context: { title: string; description: string }): SessionCheckResult {
    const matchedRules: string[] = [];
    let action: RuleAction = "allow";
    let reason = "";
    let risk: RiskLevel = "low";

    const text = `${context.title} ${context.description}`;

    for (const rule of this.rules) {
      if (rule.type !== "sessionRule") continue;
      if (matchesPattern(text, rule.pattern, rule.caseSensitive)) {
        matchedRules.push(rule.name);
        if (rule.action === "block") {
          action = "block";
          reason = rule.reason || `Blocked by rule: ${rule.name}`;
          risk = "critical";
          break;
        }
        if (rule.action === "confirm" && action === "allow") {
          action = "confirm";
          reason = rule.reason || `Confirmation required by rule: ${rule.name}`;
          risk = "medium";
        }
      }
    }

    return { action, reason, risk, matchedRules };
  }

  evaluateScene(context: { title: string; description: string }): SceneCheckResult {
    const matchedRules: string[] = [];
    const capabilities: string[] = [];
    let agentId: string | undefined;
    let reason = "";

    const text = `${context.title} ${context.description}`;

    for (const rule of this.rules) {
      if (rule.type !== "sceneRouter") continue;
      if (matchesPattern(text, rule.pattern, rule.caseSensitive)) {
        matchedRules.push(rule.name);
        if (rule.agentId && !agentId) {
          agentId = rule.agentId;
        }
        if (rule.capabilities) {
          for (const cap of rule.capabilities) {
            if (!capabilities.includes(cap)) {
              capabilities.push(cap);
            }
          }
        }
        if (!reason && rule.reason) {
          reason = rule.reason;
        }
      }
    }

    return { agentId, capabilities, reason, matchedRules };
  }

  evaluateTool(
    toolName: string,
    toolInput: Record<string, unknown>,
    _context?: { cwd?: string; sessionId?: string }
  ): ToolCheckResult {
    const matchedRules: string[] = [];
    let action: RuleAction = "allow";
    let reason = "";
    let risk: RiskLevel = "low";

    const command = typeof toolInput.command === "string" ? toolInput.command : "";
    const filePath = typeof toolInput.file_path === "string" ? toolInput.file_path : "";

    for (const rule of this.rules) {
      if (rule.type !== "toolGuard") continue;
      if (rule.tools.length > 0 && !rule.tools.some((t) => t.toLowerCase() === toolName.toLowerCase())) {
        continue;
      }

      let hit = false;
      if (["Bash", "bash", "shell"].includes(toolName)) {
        hit = matchesPattern(command, rule.pattern, rule.caseSensitive);
      } else if (["Write", "write"].includes(toolName)) {
        hit = matchesPattern(filePath, rule.pattern, rule.caseSensitive);
      } else {
        hit = matchesPattern(command || filePath, rule.pattern, rule.caseSensitive);
      }

      if (hit) {
        matchedRules.push(rule.name);
        if (rule.action === "block") {
          action = "block";
          reason = rule.reason || `Blocked by rule: ${rule.name}`;
          risk = rule.risk ?? "critical";
          break;
        }
        if (rule.action === "confirm" && action === "allow") {
          action = "confirm";
          reason = rule.reason || `Confirmation required by rule: ${rule.name}`;
          risk = rule.risk ?? "medium";
        }
      }
    }

    return { action, reason, risk, matchedRules };
  }
}
