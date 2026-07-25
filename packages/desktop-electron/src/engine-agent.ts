import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  AgentRunAbortedError,
  EmbeddedAgentRuntime,
  type AgentModelDelta,
  type AgentModelResponse,
  type AgentRunResult,
  type AgentRuntimeEvent,
  type AgentRuntimeMessage,
  type AgentToolCall,
  type AgentToolExecutionResult,
} from "../../core/src/system/agent-runtime.js";

export interface DesktopAgentDefinition {
  name: string;
  type: string;
  description: string;
  instructions?: string;
  provider?: string;
  model?: string;
  tools?: string[];
  permission?: {
    canEdit?: boolean;
    canExecute?: boolean;
    canAccessNetwork?: boolean;
    canUseMcp?: boolean;
    allowedDirectories?: string[];
    deniedPatterns?: string[];
  };
}

export interface DesktopAgentSession {
  id: string;
  agent: string;
  status: "idle" | "pending" | "running" | "completed" | "failed" | "cancelled";
  createdAt: number;
  updatedAt: number;
  name: string;
  prompt: string;
  parentSessionId?: string;
  branchFromMessageIndex?: number;
  provider?: string;
  model?: string;
  taskId?: string;
  messages: AgentRuntimeMessage[];
  events: AgentRuntimeEvent[];
  result?: AgentRunResult;
  error?: string;
}

interface DesktopAgentManagerOptions {
  dataDir: string;
  workspace: () => string;
  getAgent: (name: string) => DesktopAgentDefinition | undefined;
  listToolNames: () => string[];
  getToolSchemas: (names: string[]) => Array<Record<string, unknown>>;
  callModel: (request: {
    messages: AgentRuntimeMessage[];
    tools: Array<Record<string, unknown>>;
    sessionId: string;
    agent: string;
    provider?: string;
    model?: string;
    signal?: AbortSignal;
    onDelta?: (delta: AgentModelDelta) => void;
  }) => Promise<AgentModelResponse>;
  executeTool: (request: {
    name: string;
    input: Record<string, unknown>;
    agentType: string;
    sessionId: string;
    signal?: AbortSignal;
  }) => Promise<AgentToolExecutionResult>;
  emit: (event: string, payload: unknown) => void;
}

const MAX_SESSIONS = 100;
const MAX_EVENTS = 500;
const MAX_INSTRUCTION_BYTES = 64 * 1024;
const MAX_PERSISTED_TEXT = 256 * 1024;

function trimText(value: string, limit = MAX_PERSISTED_TEXT): string {
  if (Buffer.byteLength(value) <= limit) return value;
  return `${Buffer.from(value).subarray(0, limit).toString()}\n[truncated]`;
}

function safeJsonValue(value: unknown): unknown {
  if (typeof value === "string") return trimText(value, 64 * 1024);
  if (Array.isArray(value)) return value.slice(0, 100).map(safeJsonValue);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([key, item]) => [key, safeJsonValue(item)]),
    );
  }
  return value;
}

function diskSession(session: DesktopAgentSession): DesktopAgentSession {
  return {
    ...session,
    messages: session.messages.map((message) => ({
      ...message,
      content: trimText(message.content),
    })),
    events: session.events.slice(-MAX_EVENTS).map((event) => ({
      ...event,
      message: event.message
        ? {
            ...event.message,
            content: trimText(event.message.content, 64 * 1024),
          }
        : undefined,
      toolResult: event.toolResult
        ? {
            ...event.toolResult,
            output: safeJsonValue(event.toolResult.output),
          }
        : undefined,
    })),
    result: session.result
      ? {
          ...session.result,
          content: trimText(session.result.content),
          messages: session.result.messages.map((message) => ({
            ...message,
            content: trimText(message.content),
          })),
        }
      : undefined,
  };
}

function loadInstructionFile(workspace: string, name: string): string {
  try {
    const absolute = path.join(workspace, name);
    const stat = fs.statSync(absolute);
    if (!stat.isFile()) return "";
    return fs.readFileSync(absolute, "utf8").slice(0, MAX_INSTRUCTION_BYTES);
  } catch {
    return "";
  }
}

export function agentToolNames(
  agent: DesktopAgentDefinition,
  available: string[],
): string[] {
  const defaults =
    agent.type === "plan"
      ? ["read", "grep"]
      : ["read", "write", "edit", "bash", "grep"];
  const requested = agent.tools?.length ? agent.tools : defaults;
  const permissionFiltered = requested.filter((name) => {
    if (["write", "edit"].includes(name) && agent.permission?.canEdit === false)
      return false;
    if (name === "bash" && agent.permission?.canExecute === false) return false;
    return true;
  });
  const availableSet = new Set(available);
  const explicitlyAllows = (name: string): boolean =>
    !agent.tools?.length ||
    agent.tools.includes(name) ||
    (name.startsWith("mcp__") && agent.tools.includes("mcp:*")) ||
    (name.startsWith("skill__") && agent.tools.includes("skill:*"));
  const dynamic = available.filter((name) => {
    if (!explicitlyAllows(name)) return false;
    if (name.startsWith("skill__")) return true;
    if (name.startsWith("mcp__")) return agent.permission?.canUseMcp !== false;
    if (name === "delegate_agent")
      return ["general", "custom"].includes(agent.type);
    return false;
  });
  return [
    ...new Set([
      ...permissionFiltered.filter((name) => availableSet.has(name)),
      ...dynamic,
    ]),
  ];
}

function systemPrompt(
  agent: DesktopAgentDefinition,
  workspace: string,
  tools: string[],
): string {
  const projectInstructions = ["AGENTS.md", "CLAUDE.md"]
    .map((name) => {
      const content = loadInstructionFile(workspace, name);
      return content ? `## ${name}\n${content}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
  return [
    `You are the embedded OpenStar ${agent.name} coding agent.`,
    agent.description,
    agent.instructions ?? "",
    `Workspace: ${workspace}`,
    `Available tools: ${tools.join(", ") || "none"}.`,
    "Use tools to inspect facts before answering. Do not claim a file or command change unless the corresponding tool succeeded.",
    "Keep work inside the configured workspace. Prefer exact, minimal edits and verify important changes.",
    agent.type === "plan"
      ? "This is a read-only planning agent. Do not attempt writes, edits, or command execution."
      : "You may read, write, edit, search, and execute commands when required by the task.",
    projectInstructions,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export class DesktopAgentManager {
  private readonly options: DesktopAgentManagerOptions;
  private readonly sessionsPath: string;
  private sessions: DesktopAgentSession[];
  private controllers = new Map<string, AbortController>();
  private taskSessions = new Map<string, string>();

  constructor(options: DesktopAgentManagerOptions) {
    this.options = options;
    this.sessionsPath = path.join(options.dataDir, "agent-sessions.json");
    this.sessions = this.load();
  }

  private load(): DesktopAgentSession[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.sessionsPath, "utf8"));
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (item): item is DesktopAgentSession =>
            typeof item === "object" &&
            item !== null &&
            typeof item.id === "string" &&
            typeof item.agent === "string" &&
            Array.isArray(item.messages) &&
            Array.isArray(item.events),
        )
        .map((session) => {
          const migrated = {
            ...session,
            name:
              typeof session.name === "string" && session.name.trim()
                ? session.name.trim()
                : `${session.agent}: ${session.prompt || "session"}`.slice(
                    0,
                    80,
                  ),
          };
          return ["pending", "running"].includes(session.status)
            ? {
                ...migrated,
                status: "failed" as const,
                error:
                  "Agent run was interrupted by the previous application shutdown",
                updatedAt: Date.now(),
              }
            : migrated;
        })
        .slice(0, MAX_SESSIONS);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error(
          `[agent-sessions] ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return [];
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.sessionsPath), { recursive: true });
    const temporary = `${this.sessionsPath}.${process.pid}.tmp`;
    const serialized = this.sessions.slice(0, MAX_SESSIONS).map(diskSession);
    fs.writeFileSync(
      temporary,
      `${JSON.stringify(serialized, null, 2)}\n`,
      "utf8",
    );
    fs.renameSync(temporary, this.sessionsPath);
  }

  private requireSession(id: string): DesktopAgentSession {
    const session = this.sessions.find((item) => item.id === id);
    if (!session) throw new Error(`Agent session does not exist: ${id}`);
    return session;
  }

  create(input: {
    agent: string;
    prompt?: string;
    name?: string;
    provider?: string;
    model?: string;
    parentSessionId?: string;
    branchFromMessageIndex?: number;
    messages?: AgentRuntimeMessage[];
  }): DesktopAgentSession {
    const agent = this.options.getAgent(input.agent);
    if (!agent) throw new Error(`Agent does not exist: ${input.agent}`);
    const now = Date.now();
    const session: DesktopAgentSession = {
      id: crypto.randomUUID(),
      agent: agent.name,
      status: "idle",
      createdAt: now,
      updatedAt: now,
      name:
        input.name?.trim() ||
        `${agent.name}: ${input.prompt?.trim() || "session"}`.slice(0, 80),
      prompt: input.prompt?.trim() ?? "",
      parentSessionId: input.parentSessionId,
      branchFromMessageIndex: input.branchFromMessageIndex,
      provider: input.provider ?? agent.provider,
      model: input.model ?? agent.model,
      messages:
        input.messages?.map((message) => structuredClone(message)) ?? [],
      events: [],
    };
    this.sessions.unshift(session);
    this.sessions = this.sessions.slice(0, MAX_SESSIONS);
    this.save();
    this.options.emit("agent.session.created", {
      session: this.publicSession(session, true),
    });
    return session;
  }

  bindTask(sessionId: string, taskId: string): void {
    const session = this.requireSession(sessionId);
    session.taskId = taskId;
    session.status = "pending";
    session.updatedAt = Date.now();
    this.taskSessions.set(taskId, sessionId);
    this.save();
  }

  list(): Record<string, unknown>[] {
    return this.sessions.map((session) => this.publicSession(session));
  }

  get(id: string): Record<string, unknown> {
    return this.publicSession(this.requireSession(id), true);
  }

  rename(id: string, name: string): Record<string, unknown> {
    const session = this.requireSession(id);
    const value = name.trim().slice(0, 120);
    if (!value) throw new Error("Session name is required");
    session.name = value;
    session.updatedAt = Date.now();
    this.save();
    this.options.emit("agent.session.renamed", { sessionId: id, name: value });
    return this.publicSession(session, true);
  }

  remove(id: string): boolean {
    if (this.controllers.has(id))
      throw new Error("Cannot delete a running Agent session");
    const index = this.sessions.findIndex((session) => session.id === id);
    if (index < 0) return false;
    this.sessions.splice(index, 1);
    this.save();
    this.options.emit("agent.session.deleted", { sessionId: id });
    return true;
  }

  branch(id: string, messageIndex?: number): DesktopAgentSession {
    const source = this.requireSession(id);
    const maximum = source.messages.length - 1;
    const through =
      messageIndex === undefined
        ? maximum
        : Math.max(-1, Math.min(maximum, Math.floor(messageIndex)));
    return this.create({
      agent: source.agent,
      name: `${source.name} (branch)`.slice(0, 120),
      prompt: source.prompt,
      provider: source.provider,
      model: source.model,
      parentSessionId: source.id,
      branchFromMessageIndex: through,
      messages: source.messages.slice(0, through + 1),
    });
  }

  activeCount(agent?: string): number {
    return this.sessions.filter(
      (session) =>
        (!agent || session.agent === agent) &&
        ["pending", "running"].includes(session.status),
    ).length;
  }

  tools(agentName: string): string[] {
    const agent = this.options.getAgent(agentName);
    if (!agent) throw new Error(`Agent does not exist: ${agentName}`);
    return agentToolNames(agent, this.options.listToolNames());
  }

  async run(
    sessionId: string,
    prompt: string,
    options?: {
      provider?: string;
      model?: string;
      maxIterations?: number;
      signal?: AbortSignal;
    },
  ): Promise<AgentRunResult> {
    const session = this.requireSession(sessionId);
    if (
      ["pending", "running"].includes(session.status) &&
      this.controllers.has(sessionId)
    ) {
      throw new Error(`Agent session is already running: ${sessionId}`);
    }
    const agent = this.options.getAgent(session.agent);
    if (!agent) throw new Error(`Agent does not exist: ${session.agent}`);
    const tools = this.tools(agent.name);
    const controller = new AbortController();
    const abortFromParent = () =>
      controller.abort(options?.signal?.reason ?? "parent_cancelled");
    if (options?.signal?.aborted) abortFromParent();
    else
      options?.signal?.addEventListener("abort", abortFromParent, {
        once: true,
      });
    this.controllers.set(sessionId, controller);
    session.status = "running";
    session.prompt = prompt.trim();
    session.provider = options?.provider ?? session.provider ?? agent.provider;
    session.model = options?.model ?? session.model ?? agent.model;
    session.error = undefined;
    session.updatedAt = Date.now();
    this.save();
    this.options.emit("agent.started", {
      sessionId,
      agent: agent.name,
      tools,
      taskId: session.taskId,
    });

    const runtime = new EmbeddedAgentRuntime({
      sessionId,
      agent: agent.name,
      systemPrompt: systemPrompt(agent, this.options.workspace(), tools),
      tools: this.options.getToolSchemas(tools),
      initialMessages: session.messages.filter(
        (message) => message.role !== "system",
      ),
      maxIterations: options?.maxIterations,
      maxContextChars: 180_000,
      maxToolResultChars: 48_000,
      signal: controller.signal,
      callModel: ({ messages, tools: schemas, signal, onDelta }) =>
        this.options.callModel({
          sessionId,
          agent: agent.name,
          messages,
          tools: schemas,
          provider: session.provider,
          model: session.model,
          signal,
          onDelta,
        }),
      executeTool: async (name, input, toolCall) => {
        if (!tools.includes(name)) {
          return {
            success: false,
            output: null,
            error: `Tool is not allowed for ${agent.name}: ${name}`,
          };
        }
        return this.options.executeTool({
          name,
          input,
          agentType: agent.type,
          sessionId,
          signal: controller.signal,
        });
      },
      onEvent: (event) => {
        if (event.type === "model_delta") {
          this.options.emit("agent.event", event);
          return;
        }
        session.events.push(event);
        session.events = session.events.slice(-MAX_EVENTS);
        session.updatedAt = Date.now();
        this.save();
        this.options.emit("agent.event", event);
      },
    });

    try {
      const result = await runtime.prompt(prompt);
      session.messages = result.messages;
      session.result = result;
      session.status = "completed";
      session.updatedAt = Date.now();
      this.save();
      this.options.emit("agent.completed", {
        sessionId,
        taskId: session.taskId,
        result,
      });
      return result;
    } catch (error) {
      const cancelled =
        error instanceof AgentRunAbortedError || controller.signal.aborted;
      session.messages = runtime.getMessages();
      session.status = cancelled ? "cancelled" : "failed";
      session.error = error instanceof Error ? error.message : String(error);
      session.updatedAt = Date.now();
      this.save();
      this.options.emit(cancelled ? "agent.cancelled" : "agent.failed", {
        sessionId,
        taskId: session.taskId,
        error: session.error,
      });
      throw error;
    } finally {
      options?.signal?.removeEventListener("abort", abortFromParent);
      this.controllers.delete(sessionId);
      if (session.taskId) this.taskSessions.delete(session.taskId);
    }
  }

  delegationDepth(sessionId: string): number {
    let current = this.requireSession(sessionId);
    let depth = 0;
    const seen = new Set<string>();
    while (current.parentSessionId) {
      if (seen.has(current.id))
        throw new Error("Agent session lineage contains a cycle");
      seen.add(current.id);
      const parent = this.sessions.find(
        (session) => session.id === current.parentSessionId,
      );
      if (!parent) break;
      depth += 1;
      current = parent;
    }
    return depth;
  }

  cancel(sessionId: string): boolean {
    const controller = this.controllers.get(sessionId);
    if (!controller) return false;
    controller.abort();
    this.options.emit("agent.cancel.requested", { sessionId });
    return true;
  }

  cancelTask(taskId: string): boolean {
    const sessionId = this.taskSessions.get(taskId);
    return sessionId ? this.cancel(sessionId) : false;
  }

  close(): void {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.taskSessions.clear();
  }

  private publicSession(
    session: DesktopAgentSession,
    detailed = false,
  ): Record<string, unknown> {
    return {
      id: session.id,
      agent: session.agent,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      name: session.name,
      prompt: session.prompt,
      parentSessionId: session.parentSessionId,
      branchFromMessageIndex: session.branchFromMessageIndex,
      provider: session.provider,
      model: session.model,
      taskId: session.taskId,
      error: session.error,
      result: session.result
        ? {
            content: session.result.content,
            iterations: session.result.iterations,
            toolExecutions: session.result.toolExecutions,
            contextCompactions: session.result.contextCompactions,
            finishReason: session.result.finishReason,
            durationMs: session.result.durationMs,
            usage: session.result.usage,
          }
        : undefined,
      events: session.events.slice(detailed ? -MAX_EVENTS : -20),
      ...(detailed ? { messages: session.messages } : {}),
    };
  }
}
