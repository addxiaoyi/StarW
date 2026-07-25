import type {
  McpServerConfig,
  McpServerState,
  McpServerStatus,
  McpTool,
  McpResource,
} from "@openstar/core";
import { getMcpConfigPath, getDataDir } from "@openstar/core";
import path from "node:path";
import fs from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";

export interface McpManagerOptions {
  configPath?: string;
  autoStart?: boolean;
}

export class McpManager {
  private servers: Map<string, McpServerState> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private configPath: string;
  private autoStart: boolean;

  constructor(options: McpManagerOptions = {}) {
    this.configPath = options.configPath || getMcpConfigPath();
    this.autoStart = options.autoStart ?? true;
  }

  loadConfig(): McpServerConfig[] {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, "utf8");
        const config = JSON.parse(raw);
        const servers = config.mcpServers || {};
        return Object.entries(servers).map(([id, server]: [string, any]) => ({
          id,
          name: id,
          command: server.command,
          args: server.args || [],
          env: server.env || {},
          cwd: server.cwd,
          transport: server.transport || "stdio",
          url: server.url,
          timeoutMs: server.timeoutMs || 30000,
          enabled: server.enabled !== false,
        }));
      }
    } catch {
      // ignore
    }

    return this.getDefaultServers();
  }

  saveConfig(servers: McpServerConfig[]): void {
    const dir = path.dirname(this.configPath);
    fs.mkdirSync(dir, { recursive: true });

    const mcpServers: Record<string, any> = {};
    for (const server of servers) {
      mcpServers[server.id] = {
        command: server.command,
        args: server.args,
        env: server.env,
        cwd: server.cwd,
        transport: server.transport,
        url: server.url,
        timeoutMs: server.timeoutMs,
      };
    }

    fs.writeFileSync(
      this.configPath,
      JSON.stringify({ mcpServers }, null, 2) + "\n"
    );
  }

  getDefaultServers(): McpServerConfig[] {
    const openstarDir = getDataDir();
    return [
      {
        id: "terminal-session",
        name: "Terminal Session Manager",
        command: "node",
        args: [path.join(openstarDir, "mcp-servers", "terminal-session.js")],
        env: {},
        transport: "stdio",
        enabled: true,
        timeoutMs: 30000,
      },
      {
        id: "command-executor",
        name: "Command Executor with Approval",
        command: "node",
        args: [path.join(openstarDir, "mcp-servers", "command-executor.js")],
        env: {},
        transport: "stdio",
        enabled: true,
        timeoutMs: 60000,
      },
      {
        id: "performance-monitor",
        name: "Performance Monitor",
        command: "node",
        args: [path.join(openstarDir, "mcp-servers", "performance-monitor.js")],
        env: {},
        transport: "stdio",
        enabled: true,
        timeoutMs: 10000,
      },
      {
        id: "pet-companion",
        name: "Pet Companion",
        command: "node",
        args: [path.join(openstarDir, "mcp-servers", "pet-companion.js")],
        env: {},
        transport: "stdio",
        enabled: true,
        timeoutMs: 15000,
      },
      {
        id: "ai-relay",
        name: "AI Relay Hub",
        command: "node",
        args: [path.join(openstarDir, "mcp-servers", "ai-relay.js")],
        env: {},
        transport: "stdio",
        enabled: true,
        timeoutMs: 120000,
      },
      {
        id: "canvas-designer",
        name: "Canvas Designer",
        command: "node",
        args: [path.join(openstarDir, "mcp-servers", "canvas-designer.js")],
        env: {},
        transport: "stdio",
        enabled: true,
        timeoutMs: 60000,
      },
      {
        id: "web-browser",
        name: "Web Browser",
        command: "node",
        args: [path.join(openstarDir, "mcp-servers", "web-browser.js")],
        env: {},
        transport: "stdio",
        enabled: true,
        timeoutMs: 60000,
      },
    ];
  }

  async startServer(serverId: string): Promise<McpServerState> {
    const config = this.loadConfig().find((s) => s.id === serverId);
    if (!config) {
      throw new Error(`MCP server ${serverId} not found`);
    }

    if (!config.enabled) {
      throw new Error(`MCP server ${serverId} is disabled`);
    }

    const existing = this.servers.get(serverId);
    if (existing && existing.status === "running") {
      return existing;
    }

    const state: McpServerState = {
      config,
      status: "starting",
      tools: [],
      resources: [],
    };

    this.servers.set(serverId, state);

    try {
      const child = spawn(config.command, config.args, {
        cwd: config.cwd,
        env: { ...process.env, ...config.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.processes.set(serverId, child);

      state.status = "running";
      state.connectedAt = Date.now();

      child.on("exit", (code) => {
        state.status = "stopped";
        if (code !== 0 && code !== null) {
          state.error = `Process exited with code ${code}`;
        }
        this.processes.delete(serverId);
      });

      child.on("error", (err) => {
        state.status = "error";
        state.error = err.message;
      });
    } catch (err) {
      state.status = "error";
      state.error = err instanceof Error ? err.message : String(err);
    }

    return state;
  }

  async stopServer(serverId: string): Promise<boolean> {
    const child = this.processes.get(serverId);
    const state = this.servers.get(serverId);

    if (!state) return false;

    if (child && !child.killed) {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 5000);
    }

    state.status = "stopped";
    this.processes.delete(serverId);
    return true;
  }

  getServerState(serverId: string): McpServerState | undefined {
    return this.servers.get(serverId);
  }

  listServers(): McpServerState[] {
    const configs = this.loadConfig();
    const result: McpServerState[] = [];

    for (const config of configs) {
      const state = this.servers.get(config.id);
      if (state) {
        result.push(state);
      } else {
        result.push({
          config,
          status: "stopped",
          tools: [],
          resources: [],
        });
      }
    }

    return result;
  }

  addServer(config: McpServerConfig): void {
    const servers = this.loadConfig();
    const existing = servers.findIndex((s) => s.id === config.id);
    if (existing >= 0) {
      servers[existing] = config;
    } else {
      servers.push(config);
    }
    this.saveConfig(servers);
  }

  removeServer(serverId: string): boolean {
    this.stopServer(serverId);
    const servers = this.loadConfig().filter((s) => s.id !== serverId);
    this.saveConfig(servers);
    this.servers.delete(serverId);
    return true;
  }

  enableServer(serverId: string, enabled: boolean): boolean {
    const servers = this.loadConfig();
    const server = servers.find((s) => s.id === serverId);
    if (!server) return false;
    server.enabled = enabled;
    this.saveConfig(servers);
    return true;
  }

  async startAll(): Promise<void> {
    if (!this.autoStart) return;

    const servers = this.loadConfig().filter((s) => s.enabled);
    for (const server of servers) {
      try {
        await this.startServer(server.id);
      } catch {
        // ignore individual server startup errors
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const serverId of this.processes.keys()) {
      await this.stopServer(serverId);
    }
  }

  getStats() {
    const configs = this.loadConfig();
    const running = Array.from(this.servers.values()).filter(
      (s) => s.status === "running"
    ).length;

    return {
      totalConfigured: configs.length,
      enabled: configs.filter((s) => s.enabled).length,
      running,
      errors: Array.from(this.servers.values()).filter((s) => s.status === "error")
        .length,
    };
  }
}

export let defaultMcpManager: McpManager | null = null;

export function initMcpManager(options?: McpManagerOptions): McpManager {
  defaultMcpManager = new McpManager(options);
  return defaultMcpManager;
}

export function getMcpManager(): McpManager {
  if (!defaultMcpManager) {
    defaultMcpManager = new McpManager();
  }
  return defaultMcpManager;
}
