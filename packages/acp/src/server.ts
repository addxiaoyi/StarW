import {
  ACP_PROTOCOL_VERSION,
  AcpErrorCode,
  type AcpRequest,
  type AcpResponse,
  type AcpEvent,
  type AcpServerConfig,
  type AcpConnection,
  type AcpInitializeParams,
  type AcpPromptParams,
} from "./types";
import { AcpSessionManager } from "./session_manager";
import type { AgentOrchestrator } from "@openstar/swarm";
import type { SkillRegistry } from "@openstar/core";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { getConfig, saveAppConfig } from "@openstar/core";

const MAX_FILE_SIZE = 64 * 1024;
const PROJECT_ROOT = process.cwd();

function resolveSafePath(inputPath: string): string {
  const normalized = path.normalize(inputPath || ".").replace(/^(\.\.[/\\])+/, "");
  const resolved = path.resolve(PROJECT_ROOT, normalized);

  if (resolved !== PROJECT_ROOT && !resolved.startsWith(PROJECT_ROOT + path.sep)) {
    throw new Error("Access denied: path is outside the project root");
  }

  const homeDir = os.homedir();
  if (resolved !== homeDir && !resolved.startsWith(homeDir + path.sep)) {
    throw new Error("Access denied: path is outside the user home directory");
  }

  return resolved;
}

function maskApiKey(apiKey: string): string {
  if (!apiKey) return "";
  const last4 = apiKey.length >= 4 ? apiKey.slice(-4) : "";
  return `sk-****${last4}`;
}

export type RequestHandler = (
  params: Record<string, unknown>,
  connection: AcpConnection
) => Promise<unknown> | unknown;

export type EventHandler = (event: AcpEvent) => void;

export interface AcpServerOptions {
  config?: Partial<AcpServerConfig>;
  sessionManager?: AcpSessionManager;
  orchestrator?: AgentOrchestrator;
  skillRegistry?: SkillRegistry;
}

export class AcpServer {
  private config: AcpServerConfig;
  private sessionManager: AcpSessionManager;
  private orchestrator: AgentOrchestrator | null = null;
  private skillRegistry: SkillRegistry | null = null;
  private connections: Map<string, AcpConnection> = new Map();
  private handlers: Map<string, RequestHandler> = new Map();
  private eventListeners: Map<string, Set<EventHandler>> = new Map();
  private requestId = 0;

  constructor(options: AcpServerOptions = {}) {
    this.config = {
      serverName: "openstar-acp",
      serverVersion: "0.1.0",
      protocolVersion: ACP_PROTOCOL_VERSION,
      capabilities: {
        sessions: true,
        tools: true,
        models: true,
        resources: false,
        roots: true,
        mcpServers: true,
        skills: true,
      },
      ...options.config,
    };

    this.sessionManager = options.sessionManager || new AcpSessionManager();
    this.orchestrator = options.orchestrator || null;
    this.skillRegistry = options.skillRegistry ?? this.orchestrator?.getSkillRegistry() ?? null;

    this.registerDefaultHandlers();
  }

  setSkillRegistry(registry: SkillRegistry): void {
    this.skillRegistry = registry;
  }

  getConfig(): AcpServerConfig {
    return { ...this.config };
  }

  getSessionManager(): AcpSessionManager {
    return this.sessionManager;
  }

  setOrchestrator(orchestrator: AgentOrchestrator): void {
    this.orchestrator = orchestrator;
  }

  registerHandler(method: string, handler: RequestHandler): void {
    this.handlers.set(method, handler);
  }

  addEventListener(connectionId: string, handler: EventHandler): void {
    if (!this.eventListeners.has(connectionId)) {
      this.eventListeners.set(connectionId, new Set());
    }
    this.eventListeners.get(connectionId)!.add(handler);
  }

  removeEventListener(connectionId: string, handler: EventHandler): boolean {
    const listeners = this.eventListeners.get(connectionId);
    if (!listeners) return false;
    return listeners.delete(handler);
  }

  connect(connectionId?: string): AcpConnection {
    const id = connectionId || `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const connection: AcpConnection = {
      id,
      connectedAt: Date.now(),
      initialized: false,
    };

    this.connections.set(id, connection);
    return connection;
  }

  disconnect(connectionId: string): boolean {
    this.eventListeners.delete(connectionId);
    return this.connections.delete(connectionId);
  }

  getConnection(connectionId: string): AcpConnection | undefined {
    return this.connections.get(connectionId);
  }

  async handleRequest(
    connectionId: string,
    request: AcpRequest
  ): Promise<AcpResponse> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return this.createErrorResponse(
        request.id,
        AcpErrorCode.InvalidRequest,
        "Connection not found"
      );
    }

    if (request.method !== "initialize" && !connection.initialized) {
      return this.createErrorResponse(
        request.id,
        AcpErrorCode.InvalidRequest,
        "Server not initialized. Call 'initialize' first."
      );
    }

    const handler = this.handlers.get(request.method);
    if (!handler) {
      return this.createErrorResponse(
        request.id,
        AcpErrorCode.MethodNotFound,
        `Method '${request.method}' not found`
      );
    }

    try {
      const params = (request.params || {}) as Record<string, unknown>;
      const result = await handler(params, connection);
      return this.createResponse(request.id, result);
    } catch (error) {
      return this.createErrorResponse(
        request.id,
        AcpErrorCode.InternalError,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  sendEvent(connectionId: string, event: AcpEvent): void {
    const listeners = this.eventListeners.get(connectionId);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch {
          // ignore listener errors
        }
      }
    }
  }

  broadcastEvent(event: AcpEvent): void {
    for (const connectionId of this.connections.keys()) {
      this.sendEvent(connectionId, event);
    }
  }

  private createResponse(id: string | number, result: unknown): AcpResponse {
    return {
      jsonrpc: "2.0",
      id,
      result,
    };
  }

  private createErrorResponse(
    id: string | number | null,
    code: AcpErrorCode,
    message: string,
    data?: unknown
  ): AcpResponse {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message,
        data,
      },
    };
  }

  private registerDefaultHandlers(): void {
    this.registerHandler("initialize", (params, connection) => {
      const initParams = params as AcpInitializeParams;

      if (initParams.protocol_version !== this.config.protocolVersion) {
        throw new Error(
          `Protocol version mismatch. Server: ${this.config.protocolVersion}, Client: ${initParams.protocol_version}`
        );
      }

      connection.initialized = true;
      connection.clientInfo = initParams.client_info;

      return {
        protocol_version: this.config.protocolVersion,
        server_info: {
          name: this.config.serverName,
          version: this.config.serverVersion,
        },
        capabilities: this.config.capabilities,
      };
    });

    this.registerHandler("ping", () => {
      return { pong: true, timestamp: Date.now() };
    });

    this.registerHandler("sessions/list", () => {
      return {
        sessions: this.sessionManager.listSessions(),
      };
    });

    this.registerHandler("sessions/create", (params) => {
      const name = (params.name as string) || "New Session";
      const session = this.sessionManager.createSession(name);
      return { session };
    });

    this.registerHandler("sessions/delete", (params) => {
      const id = params.session_id as string;
      if (!id) {
        throw new Error("session_id is required");
      }
      const deleted = this.sessionManager.deleteSession(id);
      if (!deleted) {
        throw new Error("Session not found");
      }
      return { deleted: true };
    });

    this.registerHandler("sessions/rename", (params) => {
      const id = params.session_id as string;
      const name = params.name as string;
      if (!id || !name) {
        throw new Error("session_id and name are required");
      }
      const session = this.sessionManager.renameSession(id, name);
      if (!session) {
        throw new Error("Session not found");
      }
      return { session };
    });

    this.registerHandler("sessions/load", (params) => {
      const id = params.session_id as string;
      if (!id) {
        throw new Error("session_id is required");
      }
      const result = this.sessionManager.loadSession(id);
      if (!result) {
        throw new Error("Session not found");
      }
      return result;
    });

    this.registerHandler("sessions/prompt", (params, connection) => {
      const promptParams = params as AcpPromptParams;
      const { session_id, messages } = promptParams;

      if (!session_id) {
        throw new Error("session_id is required");
      }

      const session = this.sessionManager.getSession(session_id);
      if (!session) {
        throw new Error("Session not found");
      }

      for (const msg of messages) {
        this.sessionManager.addMessage(session_id, msg);
      }

      const controller = this.sessionManager.startPrompt(session_id);
      if (!controller) {
        throw new Error("Failed to start prompt");
      }

      if (this.orchestrator) {
        const task = this.orchestrator.createTask(
          `ACP Prompt - ${session.name}`,
          messages.map((m) => m.content.map((c) => c.text || "").join("\n")).join("\n"),
          {
            requiredCapabilities: ["general"],
            input: {
              model: promptParams.model,
            },
          }
        );

        this.orchestrator.executeTask(task.id).then((result) => {
          if (result.success) {
            const output = result.output;
            const text =
              typeof output?.content === "string"
                ? output.content
                : JSON.stringify(output, null, 2);
            this.sessionManager.addMessage(session_id, {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text,
                },
              ],
            });
          } else {
            this.sessionManager.addMessage(session_id, {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: `Error: ${result.error}`,
                },
              ],
            });
          }

          this.sessionManager.finishPrompt(session_id);

          this.sendEvent(connection.id, {
            jsonrpc: "2.0",
            method: "sessions/message",
            params: {
              session_id,
              message: this.sessionManager.listMessages(session_id, 1)?.[0],
            },
          });
        });
      } else {
        this.sessionManager.addMessage(session_id, {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Received: " + messages.map((m) => m.content.map((c) => c.text || "").join(" ")).join(" "),
            },
          ],
        });
        this.sessionManager.finishPrompt(session_id);
      }

      return {
        session_id,
        status: "started",
      };
    });

    this.registerHandler("sessions/stop", (params) => {
      const id = params.session_id as string;
      if (!id) {
        throw new Error("session_id is required");
      }
      const cancelled = this.sessionManager.cancelPrompt(id);
      return { cancelled };
    });

    this.registerHandler("sessions/cancel", (params) => {
      const id = params.session_id as string;
      if (!id) {
        throw new Error("session_id is required");
      }
      const cancelled = this.sessionManager.cancelPrompt(id);
      return { cancelled };
    });

    this.registerHandler("sessions/list_messages", (params) => {
      const id = params.session_id as string;
      const limit = params.limit as number | undefined;
      const before = params.before as string | undefined;

      if (!id) {
        throw new Error("session_id is required");
      }

      const messages = this.sessionManager.listMessages(id, limit, before);
      if (!messages) {
        throw new Error("Session not found");
      }

      return { messages };
    });

    this.registerHandler("models/list", () => {
      return {
        models: [
          {
            id: "default",
            name: "Default Model",
            provider: "openstar",
            capabilities: ["text", "tools"],
          },
        ],
      };
    });

    this.registerHandler("tools/list", () => {
      return {
        tools: [
          {
            name: "execute_command",
            description: "Execute a terminal command",
            input_schema: {
              type: "object",
              properties: {
                command: { type: "string", description: "The command to execute" },
                timeout: { type: "number", description: "Timeout in milliseconds" },
              },
              required: ["command"],
            },
          },
        ],
      };
    });

    this.registerHandler("tools/call", (params) => {
      const name = params.name as string;
      const arguments_ = params.arguments as Record<string, unknown>;

      return {
        tool: name,
        result: {
          success: true,
          output: `Called tool ${name} with args: ${JSON.stringify(arguments_)}`,
        },
      };
    });

    this.registerHandler("roots/list", () => {
      return {
        roots: [
          {
            uri: "file://" + process.cwd(),
            name: "Current Directory",
          },
        ],
      };
    });

    this.registerHandler("mcp_servers/list", () => {
      return {
        servers: [],
      };
    });

    this.registerHandler("skills/list", () => {
      const registry = this.skillRegistry ?? this.orchestrator?.getSkillRegistry();
      const skills = registry?.list() ?? [];
      const agents = registry?.listAgents() ?? [];
      return {
        skills: skills.map((s) => ({
          id: s.id,
          name: s.name,
          version: s.version,
          description: s.description,
          tags: s.tags,
          type: "skill",
        })),
        agents: agents.map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          capabilities: a.capabilities.map((c) => c.name),
          type: "agent",
        })),
      };
    });

    this.registerHandler("skills/execute", async (params) => {
      const skillId = params.skill_id as string;
      const input = (params.input as Record<string, unknown>) ?? {};
      if (!skillId) {
        throw new Error("skill_id is required");
      }

      const orchestrator = this.orchestrator;
      if (!orchestrator) {
        throw new Error("Orchestrator not available");
      }

      const registry = this.skillRegistry ?? orchestrator.getSkillRegistry();
      const exists = registry?.get(skillId) || registry?.listAgents().find((a) => a.id === skillId);
      if (!exists) {
        throw new Error(`Skill or agent not found: ${skillId}`);
      }

      const result = await orchestrator.executeSkill(skillId, input);
      return {
        task_id: result.taskId,
        success: result.success,
        output: result.output,
        error: result.error,
        duration_ms: result.durationMs,
      };
    });

    this.registerHandler("registry/skills", () => {
      const registry = this.skillRegistry ?? this.orchestrator?.getSkillRegistry();
      return {
        skills: (registry?.listSkills() ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          version: s.version,
          description: s.description,
          author: s.author,
          tags: s.tags,
          entryPoint: s.entryPoint,
          type: "skill" as const,
        })),
      };
    });

    this.registerHandler("registry/commands", () => {
      const registry = this.skillRegistry ?? this.orchestrator?.getSkillRegistry();
      return {
        commands: (registry?.listCommands() ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          version: c.version,
          description: c.description,
          author: c.author,
          tags: c.tags,
          entryPoint: c.entryPoint,
          type: "command" as const,
        })),
      };
    });

    this.registerHandler("registry/agents", () => {
      const registry = this.skillRegistry ?? this.orchestrator?.getSkillRegistry();
      return {
        agents: (registry?.listAgents() ?? []).map((a) => ({
          id: a.id,
          name: a.name,
          agentType: a.type,
          description: a.description,
          capabilities: a.capabilities.map((c) => c.name),
          skills: a.skills,
          type: "agent" as const,
        })),
      };
    });

    this.registerHandler("rules/list", () => {
      const engine = this.orchestrator?.getRuleEngine();
      if (!engine) {
        return { rules: [] };
      }
      return { rules: engine.listRules() };
    });

    this.registerHandler("rules/reload", async () => {
      const engine = this.orchestrator?.getRuleEngine();
      if (!engine) {
        throw new Error("Rule engine not available");
      }
      const rules = await engine.reloadFromDisk();
      return { rules };
    });

    this.registerHandler("terminal/suggest", async (params) => {
      const prompt = params.prompt as string;
      if (!prompt || typeof prompt !== "string") {
        throw new Error("prompt is required");
      }

      const orchestrator = this.orchestrator;
      if (!orchestrator) {
        throw new Error("Orchestrator not available");
      }

      const result = await orchestrator.suggestCommand(prompt);
      if (!result.success) {
        throw new Error(result.error || "Failed to generate suggestion");
      }

      return { command: result.command };
    });

    this.registerHandler("files/list", async (params) => {
      const rawPath = (params.path as string) || ".";
      const resolved = resolveSafePath(rawPath);

      const stats = await fs.stat(resolved);
      if (!stats.isDirectory()) {
        throw new Error("Path is not a directory");
      }

      const entries = await fs.readdir(resolved, { withFileTypes: true });
      const mapped = entries
        .map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? "directory" : "file" as "directory" | "file",
          path: path.relative(PROJECT_ROOT, path.join(resolved, entry.name)),
        }))
        .sort((a, b) => {
          if (a.type === b.type) return a.name.localeCompare(b.name);
          return a.type === "directory" ? -1 : 1;
        });

      return { entries: mapped };
    });

    this.registerHandler("files/read", async (params) => {
      const rawPath = params.path as string;
      if (!rawPath) {
        throw new Error("path is required");
      }

      const resolved = resolveSafePath(rawPath);
      const stats = await fs.stat(resolved);

      if (stats.isDirectory()) {
        throw new Error("Cannot read a directory");
      }
      if (!stats.isFile()) {
        throw new Error("Path is not a regular file");
      }
      if (stats.size > MAX_FILE_SIZE) {
        throw new Error(`File is too large (${stats.size} bytes, max ${MAX_FILE_SIZE} bytes)`);
      }

      const content = await fs.readFile(resolved, "utf8");
      return { content };
    });

    this.registerHandler("config/get", async () => {
      const config = await getConfig();
      return {
        ...config,
        apiKey: maskApiKey(config.apiKey),
      };
    });

    this.registerHandler("config/set", async (params) => {
      const updates: Partial<import("@openstar/core").AppConfig> = {};

      if (params.apiKey !== undefined) {
        if (typeof params.apiKey !== "string") {
          throw new Error("apiKey must be a string");
        }
        updates.apiKey = params.apiKey;
      }

      if (params.baseURL !== undefined) {
        if (typeof params.baseURL !== "string") {
          throw new Error("baseURL must be a string");
        }
        if (params.baseURL) {
          try {
            new URL(params.baseURL);
          } catch {
            throw new Error(`Invalid baseURL: ${params.baseURL}`);
          }
        }
        updates.baseURL = params.baseURL;
      }

      if (params.defaultModel !== undefined) {
        if (typeof params.defaultModel !== "string") {
          throw new Error("defaultModel must be a string");
        }
        updates.defaultModel = params.defaultModel;
      }

      if (params.theme !== undefined) {
        if (!["dark", "light", "auto"].includes(params.theme as string)) {
          throw new Error("theme must be one of: dark, light, auto");
        }
        updates.theme = params.theme as "dark" | "light" | "auto";
      }

      await saveAppConfig(updates);
      return { success: true };
    });
  }

  getStats() {
    return {
      connections: this.connections.size,
      sessions: this.sessionManager.getStats().totalSessions,
      activePrompts: this.sessionManager.getStats().activePrompts,
      handlers: this.handlers.size,
    };
  }
}

export let defaultAcpServer: AcpServer | null = null;

export function initAcpServer(options?: AcpServerOptions): AcpServer {
  defaultAcpServer = new AcpServer(options);
  return defaultAcpServer;
}

export function getAcpServer(): AcpServer {
  if (!defaultAcpServer) {
    defaultAcpServer = new AcpServer();
  }
  return defaultAcpServer;
}
