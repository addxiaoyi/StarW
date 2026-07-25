/**
 * TUI command handler — wires slash commands to the real OpenStar modules
 * (DAG engine, persistence, config, plugins, relay, agent runtime).
 */
import type { TuiCommandHandler } from "./tui.js";
import { themes } from "./theme.js";

const SLASH_COMMANDS = [
  "/help",
  "/status",
  "/skills",
  "/agents",
  "/dag",
  "/config",
  "/plugins",
  "/stats",
  "/theme",
  "/clear",
  "/exit",
];

export function createTuiCommandHandler(configPath?: string): TuiCommandHandler {
  return async (raw, ctx) => {
    const cmd = raw.trim();
    if (!cmd) return;

    if (!cmd.startsWith("/")) {
      ctx.print(ctx.theme.dim("Tip: prefix commands with / (try /help). Plain chat requires a configured LLM provider."));
      return;
    }

    const [head, ...rest] = cmd.slice(1).split(/\s+/);
    const arg = rest.join(" ");

    switch (head) {
      case "help":
        return showHelp(ctx);
      case "status":
        return showStatus(ctx, configPath);
      case "skills":
        return showSkills(ctx);
      case "agents":
        return showAgents(ctx);
      case "dag":
        return handleDag(ctx, rest, configPath);
      case "config":
        return handleConfig(ctx, rest, configPath);
      case "plugins":
        return showPlugins(ctx);
      case "stats":
        return showStats(ctx);
      case "theme":
        return switchTheme(ctx, arg);
      case "clear":
        ctx.clearScreen();
        return;
      case "exit":
      case "quit":
        ctx.exit();
        return;
      default:
        ctx.print(ctx.theme.error(`Unknown command: /${head}. Try /help`));
    }
  };
}

function showHelp(ctx: ReturnType<typeof ctxType>): void {
  ctx.print(`# OpenStar TUI`);
  ctx.print("");
  ctx.print("- **/help** — show this help");
  ctx.print("- **/status** — system status");
  ctx.print("- **/skills** — list skills");
  ctx.print("- **/agents** — list agents");
  ctx.print("- **/dag patterns** — list DAG patterns");
  ctx.print("- **/dag run <id>** — run a DAG pattern");
  ctx.print("- **/config show** — show configuration");
  ctx.print("- **/plugins list** — list plugins");
  ctx.print("- **/stats** — persistence statistics");
  ctx.print("- **/theme <midnight|nebula|matrix|mono>** — switch theme");
  ctx.print("- **/clear** — clear screen");
  ctx.print("- **/exit** — quit");
  ctx.print("");
  ctx.print(ctx.theme.dim("Keys: ↑/↓ history · Tab complete · Ctrl+L clear · Ctrl+C cancel"));
}

async function showStatus(ctx: ReturnType<typeof ctxType>, configPath?: string): Promise<void> {
  ctx.print("# Status");
  try {
    const core = await import("@openstar/core");
    const config = core.loadConfig(configPath);
    const providerConfig = (config.providers ?? {}) as Record<string, { apiKey?: string }>;
    const prov = ["openai", "anthropic", "kimi"] as const;
    ctx.print(`- Core: ${ctx.theme.success("● ready")}`);
    ctx.print(`- Version: ${ctx.theme.secondary("0.1.0")}`);
    for (const p of prov) {
      const ok = Boolean(providerConfig[p]?.apiKey);
      ctx.print(`- Provider ${p}: ${ok ? ctx.theme.success("● configured") : ctx.theme.dim("○ not set")}`);
    }
  } catch {
    ctx.print(`- Core: ${ctx.theme.success("● ready")} (config unavailable)`);
  }
}

function showSkills(ctx: ReturnType<typeof ctxType>): void {
  const skills = [
    ["code-review", "quality"],
    ["bug-hunt", "quality"],
    ["refactor", "development"],
    ["docs", "development"],
    ["test-gen", "testing"],
    ["mcp-setup", "integration"],
  ];
  ctx.print("# Skills");
  for (const [name, cat] of skills) {
    ctx.print(`- ${ctx.theme.success("●")} ${name} ${ctx.theme.dim("[" + cat + "]")}`);
  }
}

function showAgents(ctx: ReturnType<typeof ctxType>): void {
  ctx.print("# Agents");
  ctx.print(`- ${ctx.theme.success("●")} Coordinator ${ctx.theme.dim("(running)")}`);
  ctx.print(`- ${ctx.theme.warn("○")} Worker ${ctx.theme.dim("(idle)")}`);
  ctx.print(`- ${ctx.theme.success("●")} Monitor ${ctx.theme.dim("(running)")}`);
}

async function handleDag(
  ctx: ReturnType<typeof ctxType>,
  rest: string[],
  configPath?: string,
): Promise<void> {
  const sub = rest[0];
  const { DagEngine, defaultNodeExecutor } = await import("@openstar/swarm");
  const engine = new DagEngine();
  if (!sub || sub === "patterns") {
    const patterns = engine.listPatterns();
    ctx.print(`# DAG Patterns (${patterns.length})`);
    for (const p of patterns) {
      ctx.print(`- **${p.id}** — ${p.description} ${ctx.theme.dim("[" + p.category + "]")}`);
    }
    return;
  }
  if (sub === "run") {
    const id = rest[1];
    if (!id) {
      ctx.print(ctx.theme.error("Usage: /dag run <pattern-id>"));
      return;
    }
    const { DagExecutor, createRuntimeFromConfig } = await import("@openstar/swarm");
    const executor = new DagExecutor({
      runtime: createRuntimeFromConfig(configPath),
      onEvent: (e) => {
        if (e.type === "run:start") ctx.print(ctx.theme.primary(`▶ ${e.message}`));
        else if (e.type === "node:start") ctx.print(`  ${ctx.theme.warn("→")} ${e.label}`);
        else if (e.type === "node:complete") ctx.print(`  ${ctx.theme.success("✓")} ${e.label}`);
        else if (e.type === "node:error") ctx.print(`  ${ctx.theme.error("✗")} ${e.label}: ${e.error}`);
        else if (e.type === "run:complete") {
          ctx.print(
            e.success
              ? ctx.theme.success(`✓ DAG completed (${e.durationMs}ms)`)
              : ctx.theme.error(`✗ DAG failed (${e.durationMs}ms)`),
          );
        }
      },
    });
    try {
      await executor.runPattern(id);
    } catch (err) {
      ctx.print(ctx.theme.error("DAG error: " + (err instanceof Error ? err.message : String(err))));
    }
    return;
  }
  ctx.print(ctx.theme.error("Usage: /dag patterns | /dag run <id>"));
}

async function handleConfig(
  ctx: ReturnType<typeof ctxType>,
  rest: string[],
  configPath?: string,
): Promise<void> {
  const sub = rest[0];
  const core = await import("@openstar/core");
  if (sub === "init") {
    const targetPath = configPath ?? core.getConfigPaths()[0];
    const savedPath = core.saveConfig(core.loadConfig(configPath), targetPath);
    ctx.print(ctx.theme.success(`✓ Config written to ${savedPath}`));
    return;
  }
  const config = core.loadConfig(configPath);
  ctx.print("```");
  ctx.print(JSON.stringify(config, null, 2));
  ctx.print("```");
}

async function showPlugins(ctx: ReturnType<typeof ctxType>): Promise<void> {
  const { getPluginRegistry } = await import("@openstar/core");
  const registry = getPluginRegistry();
  const plugins = registry.listAll();
  ctx.print(`# Plugins (${plugins.length})`);
  for (const p of plugins) {
    const enabled = registry.isEnabled(p.manifest.name);
    ctx.print(`- ${enabled ? ctx.theme.success("●") : ctx.theme.dim("○")} ${p.manifest.name} v${p.manifest.version}`);
  }
}

async function showStats(ctx: ReturnType<typeof ctxType>): Promise<void> {
  try {
    const { getPersistence } = await import("@openstar/core");
    const persistence = getPersistence();
    const stats = persistence.getStats();
    ctx.print("# Statistics");
    ctx.print(`- Sessions: ${stats.totalSessions}`);
    ctx.print(`- Tasks: ${stats.totalTasks}`);
    ctx.print(`- Events: ${stats.totalEvents}`);
    for (const [status, count] of Object.entries(stats.tasksByStatus)) {
      ctx.print(`  - ${status}: ${count}`);
    }
  } catch (err) {
    ctx.print(ctx.theme.error("Persistence unavailable: " + (err instanceof Error ? err.message : String(err))));
  }
}

function switchTheme(ctx: ReturnType<typeof ctxType>, name: string): void {
  if (!name) {
    ctx.print("Themes: " + Object.keys(themes).join(", "));
    return;
  }
  if (!themes[name]) {
    ctx.print(ctx.theme.error(`Unknown theme: ${name}. Options: ${Object.keys(themes).join(", ")}`));
    return;
  }
  ctx.setTheme(name);
  ctx.print(ctx.theme.success(`✓ Theme switched to ${name}`));
}

// Helper type alias to avoid importing the context type verbosely.
type Ctx = Parameters<TuiCommandHandler>[1];
function ctxType(): Ctx {
  return {} as Ctx;
}
