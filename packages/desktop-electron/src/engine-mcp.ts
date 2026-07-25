import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type { DesktopMcpServerConfig } from "./engine-config.js";

interface McpConnection {
  config: DesktopMcpServerConfig;
  client: Client;
  transport: StdioClientTransport;
  connectedAt: number;
  tools: Array<Record<string, unknown>>;
  error?: string;
}

export interface DesktopMcpServerStatus {
  id: string;
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
  status: "connected" | "disconnected" | "error";
  connectedAt?: number;
  toolCount: number;
  tools: Array<Record<string, unknown>>;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeSegment(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "tool";
}

export function createMcpAgentToolName(
  serverId: string,
  toolName: string,
): string {
  const hash = crypto
    .createHash("sha1")
    .update(`${serverId}\0${toolName}`)
    .digest("hex")
    .slice(0, 8);
  return `mcp__${safeSegment(serverId).slice(0, 20)}__${safeSegment(toolName).slice(0, 25)}_${hash}`;
}

export interface DesktopMcpAgentTool {
  name: string;
  serverId: string;
  toolName: string;
  description: string;
  parameters: Record<string, unknown>;
  readOnly: boolean;
}

function safeTool(tool: unknown): Record<string, unknown> {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) return {};
  const value = tool as Record<string, unknown>;
  return {
    name: typeof value.name === "string" ? value.name : "",
    description: typeof value.description === "string" ? value.description : "",
    inputSchema: isRecord(value.inputSchema) ? value.inputSchema : {},
    annotations: isRecord(value.annotations) ? value.annotations : {},
  };
}

export class DesktopMcpManager {
  private configured: DesktopMcpServerConfig[] = [];
  private readonly connections = new Map<string, McpConnection>();
  private readonly errors = new Map<string, string>();

  configure(servers: DesktopMcpServerConfig[]): void {
    const nextIds = new Set(servers.map((server) => server.id));
    for (const id of this.connections.keys()) {
      if (!nextIds.has(id)) void this.disconnect(id);
    }
    this.configured = servers.map((server) => ({
      ...server,
      args: [...server.args],
      env: server.env ? { ...server.env } : undefined,
    }));
  }

  async sync(): Promise<DesktopMcpServerStatus[]> {
    const enabled = this.configured.filter((server) => server.enabled);
    const enabledIds = new Set(enabled.map((server) => server.id));
    for (const id of this.connections.keys()) {
      if (!enabledIds.has(id)) await this.disconnect(id);
    }
    for (const server of enabled) {
      const existing = this.connections.get(server.id);
      const changed =
        existing && JSON.stringify(existing.config) !== JSON.stringify(server);
      if (changed) await this.disconnect(server.id);
      if (!this.connections.has(server.id)) {
        try {
          await this.connect(server.id);
        } catch {
          // The concrete failure is retained in status().
        }
      }
    }
    return this.status();
  }

  async connect(id: string): Promise<DesktopMcpServerStatus> {
    const server = this.configured.find((candidate) => candidate.id === id);
    if (!server) throw new Error(`MCP server is not configured: ${id}`);
    if (!server.enabled) throw new Error(`MCP server is disabled: ${id}`);
    if (this.connections.has(id)) {
      return this.status().find((item) => item.id === id)!;
    }

    this.errors.delete(id);
    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      cwd: server.cwd,
      env: {
        ...getDefaultEnvironment(),
        ...server.env,
      },
      stderr: "pipe",
    });
    const client = new Client(
      { name: "openstar-desktop", version: "0.1.0" },
      { capabilities: {} },
    );
    const stderr: string[] = [];
    transport.stderr?.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) stderr.push(text);
    });

    try {
      await client.connect(transport);
      const listed = await client.listTools();
      const tools = Array.isArray(listed.tools)
        ? listed.tools.map(safeTool)
        : [];
      this.connections.set(id, {
        config: server,
        client,
        transport,
        connectedAt: Date.now(),
        tools,
      });
      return this.status().find((item) => item.id === id)!;
    } catch (error) {
      try {
        await transport.close();
      } catch {
        // Preserve the original connection error.
      }
      const message = [
        error instanceof Error ? error.message : String(error),
        stderr.join("\n"),
      ]
        .filter(Boolean)
        .join("\n");
      this.errors.set(id, message);
      throw new Error(message);
    }
  }

  async disconnect(id: string): Promise<boolean> {
    const connection = this.connections.get(id);
    if (!connection) return false;
    this.connections.delete(id);
    try {
      await connection.client.close();
    } catch {
      try {
        await connection.transport.close();
      } catch {
        // The process may already have exited.
      }
    }
    return true;
  }

  async callTool(
    serverId: string,
    name: string,
    args: Record<string, unknown> = {},
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<unknown> {
    const connection = this.connections.get(serverId);
    if (!connection)
      throw new Error(`MCP server is not connected: ${serverId}`);
    return connection.client.callTool({ name, arguments: args }, undefined, {
      signal: options?.signal,
      timeout: options?.timeoutMs ?? 120_000,
      maxTotalTimeout: options?.timeoutMs ?? 120_000,
    });
  }

  agentTools(): DesktopMcpAgentTool[] {
    const result: DesktopMcpAgentTool[] = [];
    for (const [serverId, connection] of this.connections) {
      for (const raw of connection.tools) {
        const toolName = typeof raw.name === "string" ? raw.name : "";
        if (!toolName) continue;
        const annotations = isRecord(raw.annotations) ? raw.annotations : {};
        result.push({
          name: createMcpAgentToolName(serverId, toolName),
          serverId,
          toolName,
          description:
            typeof raw.description === "string"
              ? raw.description
              : `MCP tool ${toolName}`,
          parameters: isRecord(raw.inputSchema)
            ? raw.inputSchema
            : { type: "object", properties: {} },
          readOnly: annotations.readOnlyHint === true,
        });
      }
    }
    return result;
  }

  getAgentTool(name: string): DesktopMcpAgentTool | undefined {
    return this.agentTools().find((tool) => tool.name === name);
  }

  agentToolSchemas(names?: string[]): Array<Record<string, unknown>> {
    const allowed = names ? new Set(names) : undefined;
    return this.agentTools()
      .filter((tool) => !allowed || allowed.has(tool.name))
      .map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: `[MCP ${tool.serverId}/${tool.toolName}] ${tool.description}`,
          parameters: tool.parameters,
        },
      }));
  }

  async callAgentTool(
    name: string,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<unknown> {
    const tool = this.getAgentTool(name);
    if (!tool) throw new Error(`MCP Agent tool does not exist: ${name}`);
    return this.callTool(tool.serverId, tool.toolName, args, options);
  }

  status(): DesktopMcpServerStatus[] {
    return this.configured.map((server) => {
      const connection = this.connections.get(server.id);
      const error = this.errors.get(server.id);
      return {
        id: server.id,
        name: server.name,
        command: server.command,
        args: [...server.args],
        enabled: server.enabled,
        status: connection ? "connected" : error ? "error" : "disconnected",
        connectedAt: connection?.connectedAt,
        toolCount: connection?.tools.length ?? 0,
        tools: connection?.tools ?? [],
        error,
      };
    });
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.connections.keys()].map((id) => this.disconnect(id)),
    );
  }
}
