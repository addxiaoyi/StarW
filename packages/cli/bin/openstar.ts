#!/usr/bin/env bun

import { Command } from "effect/Command";
import { Console } from "effect/Console";
import { pipe } from "effect";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { McpManager } from "@openstar/mcp";
import { PetEngine } from "@openstar/pet";
import { Relay } from "@openstar/relay";
import { TemplateManager } from "@openstar/templates";
import { CanvasEngine } from "@openstar/canvas";
import { BrowserEngine } from "@openstar/browser";
import { getConfig, saveAppConfig, getConfigPath, getDataDir, SkillRegistry, createSkillRegistry, type AppConfig } from "@openstar/core";
import { AgentOrchestrator } from "@openstar/swarm";
import { AcpServer, HttpTransport } from "@openstar/acp";

const logo = `
  ____  _             ____                  _
 / ___|| |_ ___      / ___|_ __ __ _ _ __ | |_ ___ _ __
 \\___ \\| __/ _ \\_____| |   | '__/ _\` | '_ \\| __/ _ \\ '__|
  ___) | ||  __/_____| |___| | | (_| | |_) | ||  __/ |
 |____/ \\__\\___|      \\____|_|  \\__,_| .__/ \\__\\___|_|
                                     |_|
`;

type Mode = "terminal" | "canvas" | "browser" | "pet" | "relay" | "swarm";

let currentMode: Mode = "terminal";
let mcpManager: McpManager | null = null;
let petEngine: PetEngine | null = null;
let relay: Relay | null = null;
let templateManager: TemplateManager | null = null;
let canvasEngine: CanvasEngine | null = null;
let browserEngine: BrowserEngine | null = null;
let skillRegistry: SkillRegistry | null = null;
let orchestrator: AgentOrchestrator | null = null;
let acpServer: AcpServer | null = null;
let acpTransport: HttpTransport | null = null;

async function init() {
  const config = await getConfig();
  const dataDir = getDataDir();

  mcpManager = new McpManager({ configPath: `${dataDir}/mcp.json` });
  relay = new Relay({
    strategy: "priority",
    defaultProvider: "openai",
    enableCache: true,
    apiKeys: config.apiKey
      ? [
          {
            id: "default",
            provider: "openai" as const,
            key: config.apiKey,
            baseUrl: config.baseURL || undefined,
          },
        ]
      : [],
  });
  templateManager = new TemplateManager();
  canvasEngine = new CanvasEngine();
  browserEngine = new BrowserEngine();
  petEngine = new PetEngine();
  skillRegistry = createSkillRegistry();
  orchestrator = new AgentOrchestrator({ skillRegistry, relay: relay ?? undefined });
  acpServer = new AcpServer({ orchestrator, skillRegistry });

  await mcpManager.loadConfig();

  console.log(logo);
  console.log(`OpenStar v0.1.0 - The Ultimate Agent Platform`);
  console.log(`Data directory: ${dataDir}`);
  console.log(`Current mode: ${currentMode}`);
  console.log("=".repeat(60));
}

async function startMcpServers(servers: string[]) {
  if (!mcpManager) {
    console.error("MCP Manager not initialized");
    return;
  }

  for (const serverId of servers) {
    try {
      const state = await mcpManager.startServer(serverId);
      console.log(`✅ MCP server started: ${serverId} (${state.status})`);
    } catch (error) {
      console.error(`❌ Failed to start MCP server ${serverId}: ${(error as Error).message}`);
    }
  }
}

async function stopMcpServers() {
  if (!mcpManager) return;
  for (const [id] of mcpManager["servers"]) {
    try {
      await mcpManager.stopServer(id);
      console.log(`⏹️ MCP server stopped: ${id}`);
    } catch {
      // ignore
    }
  }
}

async function startAcpServer(port: number = 3456) {
  if (!acpServer) {
    console.error("ACP server not initialized");
    return;
  }
  acpTransport = new HttpTransport(acpServer, { port, host: "127.0.0.1" });
  await acpTransport.start();
  console.log(`🌐 ACP server listening on http://127.0.0.1:${port}/acp`);
}

async function stopAcpServer() {
  if (!acpTransport) return;
  await acpTransport.stop();
  acpTransport = null;
  console.log("⏹️ ACP server stopped");
}

async function showHelp() {
  const help = `
OpenStar - Ultimate Agent Platform

Usage: openstar <command> [options]

Commands:
  init          Initialize OpenStar environment
  start         Start all services
  stop          Stop all services
  config        Manage OpenStar configuration
  mode          Switch mode (terminal/canvas/browser/pet/relay/swarm)
  mcp           Manage MCP servers
  pet           Interact with pet companion
  relay         Manage AI relay hub
  template      Manage templates
  canvas        Canvas operations
  browser       Browser operations
  swarm         Swarm orchestrator commands
  skills        Manage skills and commands
  agents        List registered agents
  run           Run a skill or command via orchestrator
  help          Show this help message

Config commands:
  openstar config get <key>      Get config value
  openstar config set <key> <v>  Set config value
  openstar config list           List all config values
  openstar config path           Show config file path

Mode commands:
  openstar mode terminal   Switch to terminal mode
  openstar mode canvas     Switch to canvas mode
  openstar mode browser    Switch to browser mode
  openstar mode pet        Switch to pet mode
  openstar mode relay      Switch to relay mode
  openstar mode swarm      Switch to swarm mode

MCP commands:
  openstar mcp list        List all MCP servers
  openstar mcp start <id>  Start MCP server
  openstar mcp stop <id>   Stop MCP server
  openstar mcp status      Show MCP server status

Pet commands:
  openstar pet             Launch desktop pet window
  openstar pet status      Show pet status
  openstar pet interact    Interact with pet
  openstar pet mood        Set pet mood

Relay commands:
  openstar relay status    Show relay status
  openstar relay metrics   Show relay metrics
  openstar relay strategy  Set routing strategy

Template commands:
  openstar template list   List templates
  openstar template search Search templates
  openstar template create Create template

Canvas commands:
  openstar canvas create   Create canvas nodes
  openstar canvas list     List canvas nodes
  openstar canvas export   Export canvas

Browser commands:
  openstar browser navigate Navigate to URL
  openstar browser extract  Extract page content

Examples:
  openstar init
  openstar start
  openstar mode canvas
  openstar mcp start pet-companion
  openstar pet interact pet
  openstar relay metrics
  openstar template list
  openstar skills load-ecc ./参考项目/ECC-main/ECC-main
  openstar skills list
  openstar agents list
  openstar run typescript-reviewer --cwd ./packages/core

Press Ctrl+C to exit
`;
  console.log(help);
}

async function handleCommand(args: string[]) {
  if (args.length === 0) {
    await showHelp();
    return;
  }

  const command = args[0].toLowerCase();

  switch (command) {
    case "init":
      await init();
      console.log("✅ OpenStar initialized successfully");
      break;

    case "start":
      await init();
      await startMcpServers(["pet-companion", "ai-relay", "canvas-designer", "web-browser"]);
      await startAcpServer();
      petEngine?.start();
      console.log("🚀 All services started");
      break;

    case "stop":
      await stopAcpServer();
      await stopMcpServers();
      petEngine?.stop();
      console.log("⏹️ All services stopped");
      break;

    case "config":
      await handleConfigCommand(args.slice(1));
      break;

    case "mode":
      if (args.length < 2) {
        console.log(`Current mode: ${currentMode}`);
      } else {
        const newMode = args[1] as Mode;
        if (["terminal", "canvas", "browser", "pet", "relay", "swarm"].includes(newMode)) {
          currentMode = newMode;
          console.log(`🔄 Mode changed to: ${newMode}`);
        } else {
          console.error(`❌ Invalid mode: ${newMode}`);
        }
      }
      break;

    case "mcp":
      await handleMcpCommand(args.slice(1));
      break;

    case "pet":
      await handlePetCommand(args.slice(1));
      break;

    case "relay":
      await handleRelayCommand(args.slice(1));
      break;

    case "template":
      await handleTemplateCommand(args.slice(1));
      break;

    case "canvas":
      await handleCanvasCommand(args.slice(1));
      break;

    case "browser":
      await handleBrowserCommand(args.slice(1));
      break;

    case "swarm":
      await handleSwarmCommand(args.slice(1));
      break;

    case "skills":
      await handleSkillsCommand(args.slice(1));
      break;

    case "agents":
      await handleAgentsCommand(args.slice(1));
      break;

    case "run":
      await handleRunCommand(args.slice(1));
      break;

    case "help":
      await showHelp();
      break;

    default:
      console.error(`❌ Unknown command: ${command}`);
      await showHelp();
  }
}

async function handleMcpCommand(args: string[]) {
  if (!mcpManager) {
    console.error("MCP Manager not initialized. Run 'openstar init' first.");
    return;
  }

  const subcommand = args[0]?.toLowerCase();

  switch (subcommand) {
    case "list":
      {
        const servers = mcpManager.loadConfig();
        console.log("MCP Servers:");
        for (const server of servers) {
          console.log(`  ${server.enabled ? "✅" : "❌"} ${server.id} - ${server.name}`);
        }
      }
      break;

    case "start":
      {
        const serverId = args[1];
        if (!serverId) {
          console.error("Usage: openstar mcp start <server-id>");
          return;
        }
        try {
          const state = await mcpManager.startServer(serverId);
          console.log(`✅ ${serverId} started - Status: ${state.status}`);
        } catch (error) {
          console.error(`❌ Failed to start ${serverId}: ${(error as Error).message}`);
        }
      }
      break;

    case "stop":
      {
        const serverId = args[1];
        if (!serverId) {
          console.error("Usage: openstar mcp stop <server-id>");
          return;
        }
        try {
          await mcpManager.stopServer(serverId);
          console.log(`⏹️ ${serverId} stopped`);
        } catch (error) {
          console.error(`❌ Failed to stop ${serverId}: ${(error as Error).message}`);
        }
      }
      break;

    case "status":
      {
        const states = mcpManager["servers"];
        console.log("MCP Server Status:");
        for (const [id, state] of states) {
          console.log(`  ${id}: ${state.status}`);
        }
      }
      break;

    default:
      console.error(`❌ Unknown MCP command: ${subcommand}`);
  }
}

function getDesktopPetPath(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFile), "..", "desktop-pet");
}

function launchDesktopPet() {
  const desktopPetPath = getDesktopPetPath();
  const child = spawn(process.execPath, ["run", "--cwd", desktopPetPath, "start"], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
  console.log("🐱 Desktop pet launched");
  process.exit(0);
}

async function handlePetCommand(args: string[]) {
  const subcommand = args[0]?.toLowerCase();

  if (!subcommand) {
    launchDesktopPet();
    return;
  }

  if (!petEngine) {
    console.error("Pet Engine not initialized. Run 'openstar init' first.");
    return;
  }

  switch (subcommand) {
    case "status":
      {
        const state = petEngine.getState();
        const stats = petEngine.getXpSystem().getStats();
        console.log(`🐱 ${state.name} (Level ${state.level.level})`);
        console.log(`   Mood: ${state.mood} ${petEngine.getCurrentEmoji()}`);
        console.log(`   XP: ${state.level.xp}/${state.level.xpToNext}`);
        console.log(`   Happiness: ${stats.happiness}%`);
        console.log(`   Energy: ${stats.energy}%`);
        console.log(`   Tasks Completed: ${stats.tasksCompleted}`);
      }
      break;

    case "interact":
      {
        const interaction = args[1];
        if (!interaction) {
          console.log("Available interactions: pet, feed, play, sleep, dance, stretch");
          return;
        }
        const result = petEngine.triggerInteraction(interaction);
        if (result) {
          console.log(`✅ Interaction successful: ${interaction}`);
        } else {
          console.error(`❌ Failed to interact: ${interaction}`);
        }
      }
      break;

    case "mood":
      {
        const mood = args[1];
        if (!mood) {
          console.log("Available moods: idle, happy, thinking, working, celebrating, sleepy, curious, sad, excited, focused");
          return;
        }
        petEngine.getStateMachine().setMood(mood as any);
        console.log(`🔄 Mood set to: ${mood} ${petEngine.getCurrentEmoji()}`);
      }
      break;

    case "name":
      {
        const name = args[1];
        if (!name) {
          console.log(`Current name: ${petEngine.getState().name}`);
        } else {
          petEngine.setPetName(name);
          console.log(`✨ Name changed to: ${name}`);
        }
      }
      break;

    case "start":
      petEngine.start();
      console.log("🐱 Pet started");
      break;

    case "stop":
      petEngine.stop();
      console.log("🐱 Pet stopped");
      break;

    default:
      console.error(`❌ Unknown pet command: ${subcommand}`);
  }
}

async function handleRelayCommand(args: string[]) {
  if (!relay) {
    console.error("Relay not initialized. Run 'openstar init' first.");
    return;
  }

  const subcommand = args[0]?.toLowerCase();

  switch (subcommand) {
    case "status":
      {
        const config = relay.getConfig();
        const stats = relay.getKeyManager().getStats();
        console.log("AI Relay Status:");
        console.log(`  Strategy: ${config.strategy}`);
        console.log(`  Default Provider: ${config.defaultProvider}`);
        console.log(`  API Keys: ${stats.totalKeys} (${stats.activeKeys} active)`);
        console.log(`  Total Cost: $${stats.totalCostUsd.toFixed(2)}`);
      }
      break;

    case "metrics":
      {
        const summary = relay.getMetrics().getSummary();
        console.log("Relay Metrics:");
        console.log(`  Total Requests: ${summary.totalRequests}`);
        console.log(`  Success Rate: ${(summary.successRate * 100).toFixed(1)}%`);
        console.log(`  Avg Latency: ${summary.avgLatencyMs}ms`);
        console.log(`  Total Cost: $${summary.totalCostUsd.toFixed(2)}`);
        console.log(`  Cache Hit Rate: ${(summary.cacheHitRate * 100).toFixed(1)}%`);
      }
      break;

    case "strategy":
      {
        const strategy = args[1];
        if (!strategy) {
          console.log(`Current strategy: ${relay.getRouter().getStrategy()}`);
          console.log("Available: round_robin, priority, least_used, latency, failover, random");
        } else {
          relay.updateConfig({ strategy: strategy as any });
          console.log(`🔄 Strategy set to: ${strategy}`);
        }
      }
      break;

    case "keys":
      {
        const keys = relay.getKeyManager().getAllKeys();
        console.log("API Keys:");
        for (const key of keys) {
          console.log(`  ${key.status === "active" ? "✅" : "❌"} ${key.id} - ${key.provider} (Priority: ${key.priority})`);
        }
      }
      break;

    case "providers":
      {
        const providers: Record<string, number> = {};
        for (const key of relay.getKeyManager().getAllKeys()) {
          providers[key.provider] = (providers[key.provider] || 0) + 1;
        }
        console.log("Providers:");
        for (const [provider, count] of Object.entries(providers)) {
          console.log(`  ${provider}: ${count} keys`);
        }
      }
      break;

    default:
      console.error(`❌ Unknown relay command: ${subcommand}`);
  }
}

async function handleConfigCommand(args: string[]) {
  const subcommand = args[0]?.toLowerCase();

  switch (subcommand) {
    case "get": {
      const key = args[1];
      if (!key) {
        console.error("Usage: openstar config get <key>");
        return;
      }
      const config = await getConfig();
      if (key in config) {
        const value = (config as Record<string, unknown>)[key];
        console.log(`${key}: ${typeof value === "string" && key === "apiKey" ? maskApiKey(value) : JSON.stringify(value)}`);
      } else {
        console.error(`❌ Unknown config key: ${key}`);
      }
      break;
    }
    case "set": {
      const key = args[1];
      const value = args.slice(2).join(" ");
      if (!key || value === undefined) {
        console.error("Usage: openstar config set <key> <value>");
        return;
      }
      const update: Record<string, unknown> = {};
      if (key === "apiKey" || key === "baseURL" || key === "defaultModel" || key === "defaultSmallModel" || key === "theme" || key === "logLevel") {
        update[key] = value;
      } else if (["timeoutMs", "maxConcurrentAgents"].includes(key)) {
        update[key] = Number(value);
      } else if (key === "dataDir") {
        update[key] = value;
      } else {
        console.error(`❌ Unknown or unsupported config key: ${key}`);
        return;
      }
      await saveAppConfig(update as Partial<AppConfig>);
      console.log(`✅ Config updated: ${key}`);
      break;
    }
    case "list": {
      const config = await getConfig();
      console.log(`Config file: ${getConfigPath()}`);
      for (const [key, value] of Object.entries(config)) {
        const display = typeof value === "string" && key === "apiKey" ? maskApiKey(value) : JSON.stringify(value);
        console.log(`  ${key}: ${display}`);
      }
      break;
    }
    case "path": {
      console.log(getConfigPath());
      break;
    }
    default:
      console.log("Config commands:");
      console.log("  get <key>      Get config value");
      console.log("  set <key> <v>  Set config value");
      console.log("  list           List all config values");
      console.log("  path           Show config file path");
  }
}

function maskApiKey(key: string): string {
  if (key.length <= 8) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

async function handleTemplateCommand(args: string[]) {
  if (!templateManager) {
    console.error("Template Manager not initialized. Run 'openstar init' first.");
    return;
  }

  const subcommand = args[0]?.toLowerCase();

  switch (subcommand) {
    case "list":
      {
        const templates = templateManager.getAllTemplates();
        console.log(`Templates (${templates.length}):`);
        for (const template of templates) {
          console.log(`  📋 ${template.name} (${template.type}) - ${template.description}`);
        }
      }
      break;

    case "search":
      {
        const query = args[1] || "";
        const templates = templateManager.searchTemplates({ query });
        console.log(`Search results for "${query}" (${templates.length}):`);
        for (const template of templates) {
          console.log(`  📋 ${template.name} - ${template.description}`);
        }
      }
      break;

    case "create":
      {
        const name = args[1];
        if (!name) {
          console.error("Usage: openstar template create <name>");
          return;
        }
        const template = templateManager.createTemplate({ name, description: "", type: "design", category: "ui-design" });
        console.log(`✅ Template created: ${template.id}`);
      }
      break;

    case "stats":
      {
        const stats = templateManager.getStats();
        console.log("Template Stats:");
        console.log(`  Total Templates: ${stats.totalTemplates}`);
        console.log(`  Total Instances: ${stats.totalInstances}`);
        console.log("  By Type:");
        for (const [type, count] of Object.entries(stats.templatesByType)) {
          console.log(`    ${type}: ${count}`);
        }
      }
      break;

    default:
      console.error(`❌ Unknown template command: ${subcommand}`);
  }
}

async function handleCanvasCommand(args: string[]) {
  if (!canvasEngine) {
    console.error("Canvas Engine not initialized. Run 'openstar init' first.");
    return;
  }

  const subcommand = args[0]?.toLowerCase();

  switch (subcommand) {
    case "create":
      {
        const type = args[1] || "rectangle";
        const node = canvasEngine.addNode({ type, x: 100, y: 100, width: 100, height: 100 });
        console.log(`✅ ${type} created: ${node.id}`);
      }
      break;

    case "list":
      {
        const state = canvasEngine.getState();
        console.log(`Nodes: ${state.nodes.length}, Connections: ${state.connections.length}`);
        for (const node of state.nodes) {
          console.log(`  🟦 ${node.type}: ${node.id} at (${node.x}, ${node.y})`);
        }
      }
      break;

    case "export":
      console.log(canvasEngine.toJSON());
      break;

    case "clear":
      canvasEngine.loadTemplate([], []);
      console.log("🗑️ Canvas cleared");
      break;

    default:
      console.error(`❌ Unknown canvas command: ${subcommand}`);
  }
}

async function handleBrowserCommand(args: string[]) {
  if (!browserEngine) {
    console.error("Browser Engine not initialized. Run 'openstar init' first.");
    return;
  }

  const subcommand = args[0]?.toLowerCase();

  switch (subcommand) {
    case "navigate":
      {
        const url = args[1];
        if (!url) {
          console.error("Usage: openstar browser navigate <url>");
          return;
        }
        browserEngine.navigate(url);
        console.log(`🌐 Navigating to: ${url}`);
      }
      break;

    case "current":
      {
        const state = browserEngine.getState();
        console.log(`URL: ${state.url}`);
        console.log(`Title: ${state.title}`);
        console.log(`Loading: ${state.loading}`);
      }
      break;

    case "extract":
      {
        const result = await browserEngine.extractText();
        console.log(result.text);
      }
      break;

    case "links":
      {
        const result = await browserEngine.extractLinks();
        console.log("Links:");
        for (const link of result.links) {
          console.log(`  🔗 ${link.text} - ${link.url}`);
        }
      }
      break;

    default:
      console.error(`❌ Unknown browser command: ${subcommand}`);
  }
}

async function handleSwarmCommand(args: string[]) {
  if (!orchestrator) {
    console.error("Orchestrator not initialized. Run 'openstar init' first.");
    return;
  }
  const subcommand = args[0]?.toLowerCase();
  switch (subcommand) {
    case "agents":
    case "list-agents": {
      const defs = orchestrator.getSubAgentManager().listDefinitions();
      console.log(`Agents: ${defs.length}`);
      for (const def of defs) {
        console.log(`  🤖 ${def.id} (${def.type}) - ${def.description}`);
      }
      break;
    }
    case "status": {
      const stats = orchestrator.getStats();
      console.log("Swarm Status:");
      console.log(`  Tasks: ${stats.totalTasks}`);
      console.log(`  Running agents: ${stats.runningAgents}/${stats.maxConcurrentAgents}`);
      console.log(`  Cluster enabled: ${stats.clusterEnabled}`);
      break;
    }
    case "task": {
      const title = args[1] || "task";
      const description = args.slice(2).join(" ") || title;
      const task = orchestrator.createTask(title, description);
      const result = await orchestrator.executeTask(task.id);
      console.log(`Task ${result.taskId}: ${result.success ? "✅" : "❌"}`);
      console.log(JSON.stringify(result.output, null, 2));
      break;
    }
    default:
      console.log("Swarm commands:");
      console.log("  list-agents - List registered agents");
      console.log("  status      - Show swarm status");
      console.log("  task        - Submit a task");
  }
}

async function handleSkillsCommand(args: string[]) {
  if (!skillRegistry) {
    console.error("Skill registry not initialized. Run 'openstar init' first.");
    return;
  }

  const subcommand = args[0]?.toLowerCase();
  switch (subcommand) {
    case "load-ecc": {
      const root = args[1];
      if (!root) {
        console.error("Usage: openstar skills load-ecc <path-to-ecc-root>");
        return;
      }
      skillRegistry.addSource({ type: "ecc", path: root });
      await skillRegistry.load();
      const skills = skillRegistry.list();
      const agents = skillRegistry.listAgents();
      if (orchestrator) {
        orchestrator.setSkillRegistry(skillRegistry);
      }
      console.log(`✅ Loaded ${skills.length} skills/commands and ${agents.length} agents from ${root}`);
      break;
    }
    case "load-dir": {
      const dir = args[1];
      if (!dir) {
        console.error("Usage: openstar skills load-dir <directory>");
        return;
      }
      skillRegistry.addSource({ type: "directory", path: dir });
      await skillRegistry.load();
      if (orchestrator) {
        orchestrator.setSkillRegistry(skillRegistry);
      }
      console.log(`✅ Loaded ${skillRegistry.list().length} skills from ${dir}`);
      break;
    }
    case "list": {
      const skills = skillRegistry.list();
      console.log(`Skills/Commands: ${skills.length}`);
      for (const skill of skills.slice(0, 50)) {
        console.log(`  📋 ${skill.id} - ${skill.name}`);
        if (skill.description) {
          console.log(`      ${skill.description.slice(0, 80)}${skill.description.length > 80 ? "..." : ""}`);
        }
      }
      if (skills.length > 50) {
        console.log(`  ... and ${skills.length - 50} more`);
      }
      break;
    }
    case "show": {
      const id = args[1];
      if (!id) {
        console.error("Usage: openstar skills show <skill-id>");
        return;
      }
      const skill = skillRegistry.get(id);
      if (!skill) {
        console.error(`❌ Skill not found: ${id}`);
        return;
      }
      console.log(`ID: ${skill.id}`);
      console.log(`Name: ${skill.name}`);
      console.log(`Version: ${skill.version}`);
      console.log(`Description: ${skill.description}`);
      console.log(`Tools: ${skill.tools.join(", ") || "none"}`);
      console.log(`Entry: ${skill.entryPoint}`);
      console.log("---");
      console.log(skill.systemPromptAddon?.slice(0, 800) || "");
      break;
    }
    default:
      console.log("Skills commands:");
      console.log("  load-ecc <path>  Load skills from ECC agent.yaml");
      console.log("  load-dir <dir>   Load skills from directory");
      console.log("  list             List loaded skills/commands");
      console.log("  show <id>        Show skill details");
  }
}

async function handleAgentsCommand(args: string[]) {
  if (!skillRegistry) {
    console.error("Skill registry not initialized. Run 'openstar init' first.");
    return;
  }
  const subcommand = args[0]?.toLowerCase();
  switch (subcommand) {
    case "list": {
      const agents = skillRegistry.listAgents();
      console.log(`Agents: ${agents.length}`);
      for (const agent of agents.slice(0, 50)) {
        console.log(`  🤖 ${agent.id} - ${agent.name}`);
        console.log(`      ${agent.description.slice(0, 80)}${agent.description.length > 80 ? "..." : ""}`);
      }
      break;
    }
    case "register": {
      if (!orchestrator) {
        console.error("Orchestrator not initialized. Run 'openstar init' first.");
        return;
      }
      const agents = skillRegistry.listAgents();
      for (const agent of agents) {
        orchestrator.registerAgentDefinition(agent);
      }
      console.log(`✅ Registered ${agents.length} agents with orchestrator`);
      break;
    }
    default:
      console.log("Agents commands:");
      console.log("  list      List agents from skill registry");
      console.log("  register  Register loaded agents into orchestrator");
  }
}

function parseRunArgs(args: string[]): { id: string; toolCalls: Array<{ tool: string; input: Record<string, unknown> }>; cwd: string } {
  const id = args[0];
  const toolCalls: Array<{ tool: string; input: Record<string, unknown> }> = [];
  let cwd = process.cwd();

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--cwd" && args[i + 1]) {
      cwd = args[i + 1];
      i++;
    } else if (arg.startsWith("--tool-")) {
      const toolName = arg.slice(7);
      const rawInput = args[i + 1];
      if (!rawInput) continue;
      try {
        toolCalls.push({ tool: toolName, input: JSON.parse(rawInput) });
      } catch {
        toolCalls.push({ tool: toolName, input: { value: rawInput } });
      }
      i++;
    }
  }

  return { id: id || "", toolCalls, cwd };
}

async function handleRunCommand(args: string[]) {
  if (!skillRegistry || !orchestrator) {
    console.error("Not initialized. Run 'openstar init' first.");
    return;
  }

  const { id, toolCalls, cwd } = parseRunArgs(args);
  if (!id) {
    console.error("Usage: openstar run <skill-id> [--cwd <dir>] [--tool-<name> <json>]");
    return;
  }

  const skill = skillRegistry.get(id);
  const agent = skillRegistry.listAgents().find((a) => a.id === id);

  if (!skill && !agent) {
    console.error(`❌ Skill or agent not found: ${id}`);
    return;
  }

  if (agent) {
    orchestrator.registerAgentDefinition(agent);
  }

  const definition = agent || {
    id: skill.id,
    name: skill.name,
    type: "specialist",
    description: skill.description,
    systemPrompt: skill.systemPromptAddon,
    capabilities: [],
    skills: [],
    mcpServers: [],
    maxConcurrentTasks: 1,
    timeoutMs: 300000,
  };

  orchestrator.registerAgentDefinition(definition);

  const result = await orchestrator.executeSkill(id, { cwd, toolCalls });
  console.log(`Result: ${result.success ? "✅" : "❌"}`);
  console.log(JSON.stringify(result.output, null, 2));
}

async function main() {
  const args = process.argv.slice(2);

  try {
    await handleCommand(args);
  } catch (error) {
    console.error(`❌ Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

main();
