import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { StarCore } from "../../core/src/system/starcore.js";
import type { AgentRuntimeMessage } from "../../core/src/system/agent-runtime.js";
import {
  createRelay,
  type ChatCompletionDelta,
  type ChatCompletionRequest,
} from "../../relay/src/index.js";
import {
  createSwarmManager,
  type SwarmManager,
} from "../../swarm/src/swarm-manager.js";
import {
  getDesktopDataDir,
  loadDesktopConfig,
  toPublicDesktopConfig,
  toRelayProviders,
  updateDesktopConfig,
  type DesktopConfig,
  type ProviderId,
} from "./engine-config.js";
import { DesktopAgentManager } from "./engine-agent.js";
import { DesktopAgentDefinitionManager } from "./engine-agent-registry.js";
import { DesktopMcpManager } from "./engine-mcp.js";
import { DesktopSkillManager } from "./engine-skills.js";
import { normalizeAgentOrchestrationPlan } from "./engine-orchestration.js";
import {
  DesktopApprovalManager,
  DesktopCommandExecutor,
  DesktopMutationJournal,
} from "./engine-security.js";
import { classifyCommandRisk } from "../../core/src/system/secure-tools.js";
import { fileEntry, safeRelativePath } from "./engine-files.js";
import {
  booleanParam,
  isRecord,
  normalizeAgentToolCalls,
  normalizeToolResult,
  numberParam,
  stringParam,
} from "./engine-input.js";

interface EngineRequest {
  id?: string;
  method?: string;
  params?: Record<string, unknown>;
}

interface ChatMessage {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  createdAt: number;
  model?: string;
  provider?: string;
  usage?: Record<string, number>;
  finishReason?: string;
}

interface ChatSession {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

interface RunningCommand {
  process: ChildProcessWithoutNullStreams;
  startedAt: number;
  command: string;
  cwd: string;
  outputBytes: number;
  stdout: string[];
  stderr: string[];
  timer?: ReturnType<typeof setTimeout>;
}

const MAX_COMMAND_OUTPUT_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILE_ENTRIES = 2000;
const sessionsPath = path.join(getDesktopDataDir(), "chat-sessions.json");

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function emit(event: string, payload: unknown): void {
  send({ event, payload });
}

function loadSessions(): ChatSession[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(sessionsPath, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ChatSession => {
      return (
        isRecord(item) &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        Array.isArray(item.messages)
      );
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(
        `[chat-sessions] ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return [];
  }
}

function saveSessions(sessions: ChatSession[]): void {
  fs.mkdirSync(path.dirname(sessionsPath), { recursive: true });
  const temporary = `${sessionsPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(sessions, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, sessionsPath);
}

function publicSession(session: ChatSession): Record<string, unknown> {
  return {
    id: session.id,
    name: session.name,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
  };
}

function publicMessage(message: ChatMessage): Record<string, unknown> {
  return {
    id: message.id,
    role: message.role,
    content: [{ type: "text", text: message.content }],
    created_at: message.createdAt,
    model: message.model,
    provider: message.provider,
    usage: message.usage,
    finish_reason: message.finishReason,
  };
}

function currentGitBranch(workspace: string): string {
  const result = spawnSync("git", ["branch", "--show-current"], {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
    timeout: 5000,
  });
  return result.status === 0 ? String(result.stdout).trim() : "";
}

async function redirectLogsToStderr<T>(callback: () => Promise<T>): Promise<T> {
  const originalLog = console.log;
  console.log = (...values: unknown[]) => console.error(...values);
  try {
    return await callback();
  } finally {
    console.log = originalLog;
  }
}

let config: DesktopConfig = loadDesktopConfig();
let relay = createRelay({ providers: toRelayProviders(config) });
let swarm: SwarmManager = createSwarmManager({
  maxWorkers: config.swarm.maxWorkers,
  maxConcurrency: config.swarm.maxConcurrency,
  taskTimeout: config.swarm.taskTimeoutMs,
  workingDirectory: config.workspace,
});
const core = new StarCore({
  workingDirectory: config.workspace,
  enableSwarm: true,
});
const mcp = new DesktopMcpManager();
const skills = new DesktopSkillManager(() => config.workspace);
const approvals = new DesktopApprovalManager(emit);
const commandExecutor = new DesktopCommandExecutor(emit);
const mutations = new DesktopMutationJournal(getDesktopDataDir(), emit);
const runningCommands = new Map<string, RunningCommand>();
const runningChats = new Map<string, AbortController>();
const runningMcpCalls = new Map<string, AbortController>();
let sessions = loadSessions();
let mutationTail: Promise<void> = Promise.resolve();

async function withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = mutationTail;
  let release!: () => void;
  mutationTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

await redirectLogsToStderr(() => core.initialize());
const agentDefinitions = new DesktopAgentDefinitionManager(
  getDesktopDataDir(),
  () => core.listAgents(),
  emit,
);
const agentHarness = new DesktopAgentManager({
  dataDir: getDesktopDataDir(),
  workspace: () => config.workspace,
  getAgent: (name) => agentDefinitions.get(name),
  listToolNames: () => [
    ...core.listTools().map((tool) => tool.name),
    ...mcp.agentTools().map((tool) => tool.name),
    ...skills.list().map((tool) => tool.name),
    "delegate_agent",
  ],
  getToolSchemas: (names) => {
    const allowed = new Set(names);
    return [
      ...(core.getToolSchemas(names) as Array<Record<string, unknown>>),
      ...mcp.agentToolSchemas(names),
      ...skills
        .list()
        .filter((tool) => allowed.has(tool.name))
        .map((tool) => tool.schema),
      ...(allowed.has("delegate_agent")
        ? [
            {
              type: "function",
              function: {
                name: "delegate_agent",
                description:
                  "Delegate an independent subtask to another registered Agent and wait for its result.",
                parameters: {
                  type: "object",
                  properties: {
                    agent: { type: "string" },
                    prompt: { type: "string" },
                  },
                  required: ["agent", "prompt"],
                  additionalProperties: false,
                },
              },
            },
          ]
        : []),
    ];
  },
  callModel: agentModelCompletion,
  executeTool: async ({ name, input, agentType, sessionId, signal }) => {
    const result = await executeTool(name, input, agentType, sessionId, signal);
    return {
      success: result.success === true,
      output: result.output,
      error: typeof result.error === "string" ? result.error : undefined,
      durationMs:
        typeof result.duration_ms === "number" ? result.duration_ms : undefined,
    };
  },
  emit,
});
mcp.configure(config.mcp.servers);
void mcp.sync().then((servers) => emit("mcp.status", { servers }));

function reloadRuntimeConfiguration(next: DesktopConfig): void {
  config = next;
  relay = createRelay({ providers: toRelayProviders(config) });
  swarm = createSwarmManager({
    maxWorkers: config.swarm.maxWorkers,
    maxConcurrency: config.swarm.maxConcurrency,
    taskTimeout: config.swarm.taskTimeoutMs,
    workingDirectory: config.workspace,
  });
  mcp.configure(config.mcp.servers);
}

function providerState(): Record<string, boolean> {
  return Object.fromEntries(
    (["openai", "anthropic", "kimi"] as ProviderId[]).map((id) => [
      id,
      Boolean(config.providers[id].enabled && config.providers[id].apiKey),
    ]),
  );
}

function runtimeStatus(): Record<string, unknown> {
  const mcpServers = mcp.status();
  const swarmStats = swarm.getStats();
  return {
    ...core.getStatus(),
    workspace: config.workspace,
    branch: currentGitBranch(config.workspace),
    platform: process.platform,
    providers: providerState(),
    selectedProvider: config.selectedProvider,
    skillsLoaded: core.listTools().length,
    agentsActive: swarmStats.activeWorkers,
    mcpsConnected: mcpServers.filter((server) => server.status === "connected")
      .length,
    swarm: {
      enabled: true,
      ...swarmStats,
      workers: swarm.listWorkers(),
    },
  };
}

async function executeCommand(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const command = stringParam(params, "command").trim();
  if (!command) throw new Error("Command is required");
  const commandId =
    stringParam(params, "commandId").trim() || crypto.randomUUID();
  const cwd = safeRelativePath(
    config.workspace,
    stringParam(params, "cwd", "."),
  );
  const timeoutMs = Math.max(
    1000,
    Math.min(numberParam(params, "timeoutMs", 120_000), 600_000),
  );
  const risk = classifyCommandRisk(command);
  if (risk.risk === "high" || risk.risk === "critical") {
    const approved = await approvals.request(`command:${commandId}`, {
      tool: "command.execute",
      action: "execute_command",
      risk: risk.risk,
      summary: risk.reason,
      command,
    });
    if (!approved) throw new Error("Command approval was denied");
  }
  const result = await commandExecutor.execute(
    {
      command,
      cwd,
      environment: {},
      timeoutMs,
      maxOutputBytes: Math.max(
        1024,
        Math.min(
          numberParam(params, "maxOutputBytes", 512 * 1024),
          MAX_COMMAND_OUTPUT_BYTES,
        ),
      ),
      sandbox: ["auto", "docker", "process", "off"].includes(
        stringParam(params, "sandbox"),
      )
        ? (stringParam(params, "sandbox") as
            "auto" | "docker" | "process" | "off")
        : "process",
      networkDisabled: booleanParam(params, "networkDisabled", false),
    },
    commandId,
  );
  const success = result.exitCode === 0 && !result.truncated;
  return {
    commandId,
    success,
    stdout: result.stdout,
    stderr: result.stderr,
    output: [result.stdout, result.stderr].filter(Boolean).join(""),
    error: success
      ? undefined
      : result.stderr || `Command exited with code ${result.exitCode}`,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    cwd,
    backend: result.backend,
    truncated: result.truncated,
  };
}

function cancelCommand(params: Record<string, unknown>): boolean {
  const commandId = stringParam(params, "commandId");
  const cancelled = commandExecutor.cancel(commandId);
  if (cancelled) emit("command.cancelled", { commandId });
  return cancelled;
}

function validateToolInput(
  name: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...input };
  if (
    ["read", "write", "edit"].includes(name) &&
    typeof next.path === "string"
  ) {
    next.path = safeRelativePath(config.workspace, next.path);
  }
  if (name === "grep" && typeof next.path === "string") {
    next.path = safeRelativePath(config.workspace, next.path);
  }
  return next;
}

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  agentType = "build",
  sessionId = crypto.randomUUID(),
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  emit("tool.started", { name, input });
  if (name === "delegate_agent") {
    const raw = await delegateAgent(sessionId, input, signal);
    const normalized = {
      success: true,
      output: { content: raw.content, result: raw, raw },
      duration_ms: Date.now() - startedAt,
    };
    emit("tool.finished", { name, ...normalized });
    return normalized;
  }
  if (name.startsWith("mcp__")) {
    const tool = mcp.getAgentTool(name);
    if (!tool) throw new Error(`MCP Agent tool does not exist: ${name}`);
    if (!tool.readOnly) {
      const approved = await approvals.request(sessionId, {
        tool: name,
        action: "mcp_tool_call",
        risk: "high",
        summary: `MCP tool ${tool.serverId}/${tool.toolName} is not marked read-only`,
      });
      if (!approved) throw new Error("MCP tool approval was denied");
    }
    const raw = await mcp.callAgentTool(name, input, {
      signal,
      timeoutMs: 120_000,
    });
    const normalized = {
      success: !(isRecord(raw) && raw.isError === true),
      output: { content: JSON.stringify(raw), result: raw, raw },
      duration_ms: Date.now() - startedAt,
    };
    emit("tool.finished", { name, ...normalized });
    return normalized;
  }
  if (name.startsWith("skill__")) {
    const raw = skills.execute(name, input);
    const normalized = {
      success: true,
      output: { content: JSON.stringify(raw), result: raw, raw },
      duration_ms: Date.now() - startedAt,
    };
    emit("tool.finished", { name, ...normalized });
    return normalized;
  }
  const invoke = () =>
    core.executeTool(name, validateToolInput(name, input), {
      workingDirectory: config.workspace,
      agentType,
      agentId: agentType,
      sessionId,
      signal,
      outputLimitBytes: 128 * 1024,
      sandbox: "auto",
      requestApproval: (request) => approvals.request(sessionId, request),
      executeCommand: (request) =>
        commandExecutor.execute(request, `${sessionId}:${crypto.randomUUID()}`),
      recordMutation: async (mutation) => mutations.record(sessionId, mutation),
    });
  const result = ["write", "edit"].includes(name)
    ? await withMutationLock(invoke)
    : await invoke();
  const normalized = normalizeToolResult(result);
  normalized.duration_ms = Date.now() - startedAt;
  emit("tool.finished", { name, ...normalized });
  return normalized;
}

function configuredProvider(
  requestedProvider?: string,
  requestedModel?: string,
): { provider: ProviderId; model: string } {
  const provider =
    (requestedProvider as ProviderId | undefined) || config.selectedProvider;
  if (!["openai", "anthropic", "kimi"].includes(provider)) {
    throw new Error(`Unsupported provider: ${String(provider)}`);
  }
  const providerConfig = config.providers[provider];
  if (!providerConfig.enabled)
    throw new Error(`Provider is disabled: ${provider}`);
  if (!providerConfig.apiKey) {
    throw new Error(`Provider API key is not configured: ${provider}`);
  }
  const model = requestedModel?.trim() || providerConfig.model.trim();
  if (!model) throw new Error(`Provider model is not configured: ${provider}`);
  return { provider, model };
}

async function agentModelCompletion(request: {
  sessionId: string;
  agent: string;
  messages: AgentRuntimeMessage[];
  tools: Array<Record<string, unknown>>;
  provider?: string;
  model?: string;
  signal?: AbortSignal;
  onDelta?: (delta: {
    type: "content" | "tool_call" | "finish" | "usage";
    content?: string;
    toolCall?: ChatCompletionDelta["toolCall"];
    finishReason?: string;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  }) => void;
}) {
  const { provider, model } = configuredProvider(
    request.provider,
    request.model,
  );
  emit("agent.model.started", { provider, model });
  const response = await relay.chatCompletionStream(
    {
      model,
      messages: request.messages,
      tools: request.tools,
      temperature: 0.2,
      maxTokens: 4096,
      signal: request.signal,
    },
    provider,
    (delta) => {
      const normalized = {
        type: delta.type,
        content: delta.content,
        toolCall: delta.toolCall,
        finishReason: delta.finishReason,
        usage: delta.usage
          ? {
              promptTokens: delta.usage.prompt_tokens,
              completionTokens: delta.usage.completion_tokens,
              totalTokens: delta.usage.total_tokens,
            }
          : undefined,
      };
      request.onDelta?.(normalized);
      emit("agent.model.delta", {
        sessionId: request.sessionId,
        agent: request.agent,
        provider,
        model,
        delta: normalized,
      });
    },
  );
  const choice = response.choices[0];
  const result = {
    id: response.id,
    model: response.model,
    content: choice?.message.content ?? "",
    toolCalls: normalizeAgentToolCalls(choice?.message.tool_calls),
    finishReason: choice?.finish_reason,
    usage: response.usage
      ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : undefined,
  };
  emit("agent.model.finished", {
    provider,
    model: result.model,
    toolCalls: result.toolCalls.length,
    finishReason: result.finishReason,
  });
  return result;
}

async function chatCompletion(
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const requestedProvider = stringParam(params, "provider") || undefined;
  const requestedModel = stringParam(params, "model") || undefined;
  const { provider, model } = configuredProvider(
    requestedProvider,
    requestedModel,
  );
  const rawMessages = Array.isArray(params.messages) ? params.messages : [];
  const messages = rawMessages
    .filter(isRecord)
    .map((message) => ({
      role: ["system", "user", "assistant", "tool"].includes(
        String(message.role),
      )
        ? (message.role as ChatCompletionRequest["messages"][number]["role"])
        : "user",
      content:
        typeof message.content === "string"
          ? message.content
          : String(message.content ?? ""),
    }))
    .filter((message) => message.content);
  if (messages.length === 0)
    throw new Error("At least one chat message is required");
  const sessionId = stringParam(params, "sessionId") || undefined;
  const stream = booleanParam(params, "stream", false);
  emit("chat.started", { provider, model, sessionId, stream });
  const request = {
    model,
    messages,
    temperature: numberParam(params, "temperature", 0.7),
    maxTokens: numberParam(params, "maxTokens", 4096),
    signal,
  };
  const response = stream
    ? await relay.chatCompletionStream(request, provider, (delta) => {
        emit("chat.delta", {
          sessionId,
          provider,
          model,
          delta,
          content: delta.content,
        });
      })
    : await relay.chatCompletion(request, provider);
  const content = response.choices[0]?.message.content ?? "";
  const result = {
    id: response.id,
    provider,
    model: response.model,
    content,
    usage: response.usage,
    finishReason: response.choices[0]?.finish_reason,
  };
  emit("chat.finished", { ...result, sessionId });
  return result;
}

async function promptSession(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const sessionId = stringParam(params, "session_id");
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) throw new Error(`Chat session does not exist: ${sessionId}`);
  const incoming = Array.isArray(params.messages) ? params.messages : [];
  const userText = incoming
    .filter(isRecord)
    .filter((message) => message.role === "user")
    .flatMap((message) =>
      Array.isArray(message.content) ? message.content : [],
    )
    .filter(isRecord)
    .map((content) => (typeof content.text === "string" ? content.text : ""))
    .filter(Boolean)
    .join("\n");
  if (!userText) throw new Error("User message is required");

  const userMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: "user",
    content: userText,
    createdAt: Date.now(),
  };
  session.messages.push(userMessage);
  session.updatedAt = Date.now();
  saveSessions(sessions);
  emit("session.message", {
    sessionId,
    message: publicMessage(userMessage),
  });

  const history = session.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  const systemPrompt = stringParam(params, "system_prompt");
  if (systemPrompt) history.unshift({ role: "system", content: systemPrompt });
  const controller = new AbortController();
  const existing = runningChats.get(sessionId);
  if (existing) existing.abort();
  runningChats.set(sessionId, controller);
  let result: Record<string, unknown>;
  try {
    result = (await chatCompletion(
      {
        messages: history,
        provider: params.provider,
        model: params.model,
        sessionId,
        stream: true,
      },
      controller.signal,
    )) as Record<string, unknown>;
  } catch (error) {
    if (controller.signal.aborted) {
      emit("chat.cancelled", { sessionId });
      return { cancelled: true };
    }
    throw error;
  } finally {
    if (runningChats.get(sessionId) === controller)
      runningChats.delete(sessionId);
  }
  if (result.cancelled === true) return { cancelled: true };
  const assistant: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: typeof result.content === "string" ? result.content : "",
    createdAt: Date.now(),
    model: typeof result.model === "string" ? result.model : undefined,
    provider: typeof result.provider === "string" ? result.provider : undefined,
    usage: isRecord(result.usage)
      ? (result.usage as Record<string, number>)
      : undefined,
    finishReason:
      typeof result.finishReason === "string" ? result.finishReason : undefined,
  };
  session.messages.push(assistant);
  session.updatedAt = Date.now();
  saveSessions(sessions);
  emit("session.message", {
    sessionId,
    message: publicMessage(assistant),
  });
  return { message: publicMessage(assistant) };
}

async function delegateAgent(
  parentSessionId: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const agent = stringParam(input, "agent").trim();
  const prompt = stringParam(input, "prompt").trim();
  if (!agent || !prompt)
    throw new Error("delegate_agent requires agent and prompt");
  if (!agentDefinitions.get(agent))
    throw new Error(`Delegated Agent does not exist: ${agent}`);
  if (agentHarness.delegationDepth(parentSessionId) >= 3) {
    throw new Error("Maximum Agent delegation depth reached");
  }
  const parent = agentHarness.get(parentSessionId);
  const child = agentHarness.create({
    agent,
    prompt,
    provider: typeof parent.provider === "string" ? parent.provider : undefined,
    model: typeof parent.model === "string" ? parent.model : undefined,
    parentSessionId,
    name: `${agent}: delegated by ${String(parent.agent)}`.slice(0, 120),
  });
  emit("agent.delegation.started", {
    parentSessionId,
    childSessionId: child.id,
    agent,
    prompt,
  });
  try {
    const result = await agentHarness.run(child.id, prompt, {
      provider: child.provider,
      model: child.model,
      maxIterations: 12,
      signal,
    });
    emit("agent.delegation.completed", {
      parentSessionId,
      childSessionId: child.id,
      agent,
      result,
    });
    return {
      parentSessionId,
      childSessionId: child.id,
      agent,
      content: result.content,
      iterations: result.iterations,
      toolExecutions: result.toolExecutions,
      usage: result.usage,
    };
  } catch (error) {
    emit("agent.delegation.failed", {
      parentSessionId,
      childSessionId: child.id,
      agent,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function orchestrateAgents(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const plan = normalizeAgentOrchestrationPlan(params.tasks);
  for (const step of plan) {
    if (!agentDefinitions.get(step.agent)) {
      throw new Error(`Agent does not exist: ${step.agent}`);
    }
  }
  const provider = stringParam(params, "provider") || undefined;
  const model = stringParam(params, "model") || undefined;
  const parentSessionId = stringParam(params, "parentSessionId") || undefined;
  const maxIterations = Math.max(
    1,
    Math.min(numberParam(params, "maxIterations", 12), 64),
  );
  const taskIds = new Map<string, string>();
  const sessionsByStep = new Map<string, string>();
  emit("agent.orchestration.started", { plan, parentSessionId });

  for (const step of plan) {
    const child = agentHarness.create({
      agent: step.agent,
      prompt: step.prompt,
      provider,
      model,
      parentSessionId,
      name: `${step.id}: ${step.agent}`,
    });
    sessionsByStep.set(step.id, child.id);
    const dependencies = step.dependsOn.map((id) => taskIds.get(id)!);
    const taskId = swarm.submit(
      `${step.agent}: ${step.prompt.slice(0, 80)}`,
      { step, childSessionId: child.id },
      async (taskInput, _context, taskSignal) => {
        emit("agent.orchestration.step.started", {
          stepId: taskInput.step.id,
          childSessionId: taskInput.childSessionId,
        });
        const result = await agentHarness.run(
          taskInput.childSessionId,
          taskInput.step.prompt,
          { provider, model, maxIterations, signal: taskSignal },
        );
        emit("agent.orchestration.step.completed", {
          stepId: taskInput.step.id,
          childSessionId: taskInput.childSessionId,
          result,
        });
        return {
          stepId: taskInput.step.id,
          childSessionId: taskInput.childSessionId,
          result,
        };
      },
      { dependencies, description: step.prompt },
    );
    taskIds.set(step.id, taskId);
    agentHarness.bindTask(child.id, taskId);
  }

  const terminal = await Promise.all(
    [...taskIds.entries()].map(async ([stepId, taskId]) => ({
      stepId,
      task: await swarm.waitForTask(taskId),
    })),
  );
  const results = terminal.map(({ stepId, task }) => ({
    stepId,
    taskId: task.id,
    sessionId: sessionsByStep.get(stepId),
    status: task.status,
    result: task.result,
    error: task.error,
  }));
  emit("agent.orchestration.completed", { results, parentSessionId });
  return { results };
}

async function submitAgentTask(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const prompt = stringParam(params, "prompt").trim();
  if (!prompt) throw new Error("Agent prompt is required");
  const provider = stringParam(params, "provider") || undefined;
  const model = stringParam(params, "model") || undefined;
  const maxIterations = Math.max(
    1,
    Math.min(numberParam(params, "maxIterations", 12), 64),
  );
  let sessionId =
    stringParam(params, "sessionId") || stringParam(params, "session_id");
  let agentName = stringParam(params, "agent", "general");
  if (sessionId) {
    const existing = agentHarness.get(sessionId);
    agentName = String(existing.agent);
  } else {
    const session = agentHarness.create({
      agent: agentName,
      prompt,
      provider,
      model,
    });
    sessionId = session.id;
  }

  const taskId = swarm.submit(
    `${agentName}: ${prompt.slice(0, 80)}`,
    { sessionId, prompt, provider, model, maxIterations },
    async (input) => {
      emit("swarm.task.started", {
        taskId,
        agent: agentName,
        sessionId: input.sessionId,
      });
      try {
        const result = await agentHarness.run(input.sessionId, input.prompt, {
          provider: input.provider,
          model: input.model,
          maxIterations: input.maxIterations,
        });
        emit("swarm.task.finished", {
          taskId,
          agent: agentName,
          sessionId: input.sessionId,
          result,
        });
        return { sessionId: input.sessionId, ...result };
      } catch (error) {
        emit("swarm.task.failed", {
          taskId,
          agent: agentName,
          sessionId: input.sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    { description: prompt },
  );
  agentHarness.bindTask(sessionId, taskId);
  emit("swarm.task.submitted", {
    taskId,
    agent: agentName,
    sessionId,
    prompt,
  });
  return { taskId, sessionId };
}

async function submitSwarmTask(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const name = stringParam(params, "name", "OpenStar task").trim();
  const kind = stringParam(params, "kind", "chat");
  const input = isRecord(params.input) ? params.input : {};
  let taskId = "";
  if (kind === "tool") {
    const tool = stringParam(input, "tool");
    const toolInput = isRecord(input.input) ? input.input : {};
    taskId = swarm.submit(name, { tool, toolInput }, async (taskInput) => {
      emit("swarm.task.started", { taskId, kind, name });
      const result = await executeTool(taskInput.tool, taskInput.toolInput);
      emit("swarm.task.finished", { taskId, kind, name, result });
      if (!result.success) {
        throw new Error(
          typeof result.error === "string" ? result.error : "Tool task failed",
        );
      }
      return result;
    });
  } else {
    const prompt = stringParam(input, "prompt").trim();
    if (!prompt) throw new Error("Swarm chat task requires input.prompt");
    taskId = swarm.submit(name, { prompt }, async (taskInput) => {
      emit("swarm.task.started", { taskId, kind, name });
      const result = await chatCompletion({
        messages: [{ role: "user", content: taskInput.prompt }],
        provider: input.provider,
        model: input.model,
      });
      emit("swarm.task.finished", { taskId, kind, name, result });
      return result;
    });
  }
  emit("swarm.task.submitted", { taskId, kind, name });
  return { taskId };
}

async function listFiles(params: Record<string, unknown>): Promise<unknown> {
  const requested = stringParam(params, "path", ".");
  const absolute = safeRelativePath(config.workspace, requested);
  const stat = await fsp.lstat(absolute);
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${requested}`);
  const entries = await fsp.readdir(absolute);
  const result: Record<string, unknown>[] = [];
  for (const name of entries.slice(0, MAX_FILE_ENTRIES)) {
    const child = path.join(absolute, name);
    try {
      result.push(fileEntry(child, config.workspace));
    } catch {
      // Ignore entries that disappear during enumeration.
    }
  }
  result.sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
    return String(left.name).localeCompare(String(right.name));
  });
  return { entries: result, path: requested, workspace: config.workspace };
}

async function readWorkspaceFile(
  params: Record<string, unknown>,
): Promise<unknown> {
  const requested = stringParam(params, "path");
  const absolute = safeRelativePath(config.workspace, requested);
  const stat = await fsp.stat(absolute);
  if (!stat.isFile()) throw new Error(`Not a file: ${requested}`);
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error("File exceeds the 5 MiB desktop preview limit");
  }
  return {
    path: requested,
    content: await fsp.readFile(absolute, "utf8"),
    size: stat.size,
    modifiedAt: stat.mtimeMs,
  };
}

async function writeWorkspaceFile(
  params: Record<string, unknown>,
): Promise<unknown> {
  const requested = stringParam(params, "path");
  const content = stringParam(params, "content");
  if (Buffer.byteLength(content) > MAX_FILE_BYTES) {
    throw new Error("File content exceeds the 5 MiB desktop write limit");
  }
  const absolute = safeRelativePath(config.workspace, requested);
  const expectedModifiedAt =
    typeof params.expectedModifiedAt === "number"
      ? params.expectedModifiedAt
      : undefined;
  if (expectedModifiedAt !== undefined) {
    const current = await fsp.stat(absolute);
    if (Math.abs(current.mtimeMs - expectedModifiedAt) > 1) {
      throw new Error(
        `FILE_MODIFIED_EXTERNALLY: ${requested} changed after it was opened`,
      );
    }
  }
  await fsp.mkdir(path.dirname(absolute), { recursive: true });
  await fsp.writeFile(absolute, content, "utf8");
  const written = await fsp.stat(absolute);
  emit("file.changed", { path: requested, modifiedAt: written.mtimeMs });
  return {
    path: requested,
    bytes: Buffer.byteLength(content),
    modifiedAt: written.mtimeMs,
  };
}

async function createWorkspaceEntry(
  params: Record<string, unknown>,
): Promise<unknown> {
  const requested = stringParam(params, "path");
  const kind = stringParam(params, "kind", "file");
  const absolute = safeRelativePath(config.workspace, requested);
  if (fs.existsSync(absolute))
    throw new Error(`Path already exists: ${requested}`);
  if (kind === "directory") {
    await fsp.mkdir(absolute, { recursive: false });
  } else {
    await fsp.mkdir(path.dirname(absolute), { recursive: true });
    await fsp.writeFile(absolute, stringParam(params, "content"), "utf8");
  }
  const after = kind === "directory" ? "" : stringParam(params, "content");
  mutations.record("files-ui", {
    path: absolute,
    before: null,
    after,
  });
  const stat = await fsp.stat(absolute);
  emit("file.changed", { path: requested, modifiedAt: stat.mtimeMs });
  return fileEntry(absolute, config.workspace);
}

async function renameWorkspaceEntry(
  params: Record<string, unknown>,
): Promise<unknown> {
  const requested = stringParam(params, "path");
  const nextPath = stringParam(params, "newPath");
  const absolute = safeRelativePath(config.workspace, requested);
  const target = safeRelativePath(config.workspace, nextPath);
  if (fs.existsSync(target))
    throw new Error(`Target already exists: ${nextPath}`);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.rename(absolute, target);
  emit("file.changed", { path: requested, deleted: true });
  const stat = await fsp.stat(target);
  emit("file.changed", { path: nextPath, modifiedAt: stat.mtimeMs });
  return fileEntry(target, config.workspace);
}

async function deleteWorkspaceEntry(
  params: Record<string, unknown>,
): Promise<unknown> {
  const requested = stringParam(params, "path");
  const absolute = safeRelativePath(config.workspace, requested);
  const stat = await fsp.lstat(absolute);
  if (stat.isDirectory()) {
    const children = await fsp.readdir(absolute);
    if (children.length && !booleanParam(params, "recursive", false)) {
      throw new Error(
        "Directory is not empty; recursive confirmation is required",
      );
    }
    await fsp.rm(absolute, { recursive: true, force: false });
  } else {
    const before = await fsp.readFile(absolute, "utf8");
    mutations.record("files-ui", { path: absolute, before, after: "" });
    await fsp.rm(absolute, { force: false });
  }
  emit("file.changed", { path: requested, deleted: true });
  return { deleted: true, path: requested };
}

function cancelChatSession(params: Record<string, unknown>): boolean {
  const sessionId = stringParam(params, "session_id");
  const controller = runningChats.get(sessionId);
  if (!controller) return false;
  controller.abort();
  runningChats.delete(sessionId);
  return true;
}

async function handle(request: EngineRequest): Promise<void> {
  const id = request.id;
  const method = request.method ?? "";
  const params = request.params ?? {};

  try {
    let result: unknown;
    switch (method) {
      case "ping":
        result = { ok: true };
        break;
      case "status":
      case "runtime.status":
        result = runtimeStatus();
        break;
      case "skills":
      case "skills/list":
      case "registry/skills":
      case "registry/commands":
        result = {
          skills: [
            ...core.listTools().map((tool) => ({
              id: tool.name,
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
              type: "core-tool",
              enabled: true,
            })),
            ...skills.list().map((tool) => ({
              id: tool.id,
              name: tool.name,
              title: tool.title,
              description: tool.description,
              source: tool.source,
              type: "workspace-skill",
              enabled: true,
            })),
          ],
          commands: core.listTools().map((tool) => ({
            id: tool.name,
            name: tool.name,
            description: tool.description,
            type: "command",
          })),
          agents: [],
        };
        break;
      case "tool.execute":
      case "skills/execute": {
        const name =
          stringParam(params, "name") || stringParam(params, "skill_id");
        const input = isRecord(params.input) ? params.input : {};
        result = await executeTool(name, input);
        break;
      }
      case "command.execute":
        result = await executeCommand(params);
        break;
      case "command.cancel":
        result = { cancelled: cancelCommand(params) };
        break;
      case "approvals/list":
        result = { approvals: approvals.list() };
        break;
      case "approvals/resolve":
        result = {
          resolved: approvals.resolve(
            stringParam(params, "id"),
            booleanParam(params, "approved"),
          ),
        };
        break;
      case "sandbox.status":
        result = await commandExecutor.status();
        break;
      case "changes/list":
        result = {
          changes: mutations.list(
            stringParam(params, "sessionId") || undefined,
          ),
        };
        break;
      case "changes/rollback":
        result = {
          change: await mutations.rollback(stringParam(params, "id")),
        };
        break;
      case "files/list":
        result = await listFiles(params);
        break;
      case "files/read":
        result = await readWorkspaceFile(params);
        break;
      case "files/write":
        result = await writeWorkspaceFile(params);
        break;
      case "files/create":
        result = await createWorkspaceEntry(params);
        break;
      case "files/rename":
      case "files/move":
        result = await renameWorkspaceEntry(params);
        break;
      case "files/delete":
        result = await deleteWorkspaceEntry(params);
        break;
      case "config/get":
        result = toPublicDesktopConfig(config);
        break;
      case "config/set": {
        const next = updateDesktopConfig(params);
        reloadRuntimeConfiguration(next);
        const servers = await mcp.sync();
        emit("config.changed", toPublicDesktopConfig(config));
        emit("mcp.status", { servers });
        result = toPublicDesktopConfig(config);
        break;
      }
      case "chat.complete":
        result = await chatCompletion(params);
        break;
      case "sessions/create": {
        const now = Date.now();
        const session: ChatSession = {
          id: crypto.randomUUID(),
          name: stringParam(params, "name", "New Session"),
          createdAt: now,
          updatedAt: now,
          messages: [],
        };
        sessions.unshift(session);
        saveSessions(sessions);
        result = { session: publicSession(session) };
        break;
      }
      case "sessions/list":
        result = { sessions: sessions.map(publicSession) };
        break;
      case "sessions/list_messages": {
        const session = sessions.find(
          (item) => item.id === stringParam(params, "session_id"),
        );
        if (!session) throw new Error("Chat session does not exist");
        const total = session.messages.length;
        const limit = Math.max(
          1,
          Math.min(200, Math.floor(numberParam(params, "limit", 100))),
        );
        const requestedBefore = Math.floor(
          numberParam(params, "before", total),
        );
        const end = Math.max(0, Math.min(total, requestedBefore));
        const start = Math.max(0, end - limit);
        result = {
          messages: session.messages.slice(start, end).map(publicMessage),
          total,
          start,
          end,
          hasMore: start > 0,
        };
        break;
      }
      case "sessions/branch": {
        const sourceId = stringParam(params, "session_id");
        const source = sessions.find((item) => item.id === sourceId);
        if (!source) throw new Error("Chat session does not exist");
        const messageId = stringParam(params, "message_id");
        const messageIndex = messageId
          ? source.messages.findIndex((message) => message.id === messageId)
          : source.messages.length - 1;
        if (messageId && messageIndex < 0)
          throw new Error("Chat message does not exist");
        const now = Date.now();
        const session: ChatSession = {
          id: crypto.randomUUID(),
          name: stringParam(params, "name") || `${source.name} · branch`,
          createdAt: now,
          updatedAt: now,
          messages: source.messages
            .slice(0, Math.max(0, messageIndex + 1))
            .map((message) => ({
              ...message,
              id: crypto.randomUUID(),
            })),
        };
        sessions.unshift(session);
        saveSessions(sessions);
        result = { session: publicSession(session) };
        break;
      }
      case "sessions/rename": {
        const session = sessions.find(
          (item) => item.id === stringParam(params, "session_id"),
        );
        if (!session) throw new Error("Chat session does not exist");
        const name = stringParam(params, "name").trim();
        if (!name) throw new Error("Session name is required");
        session.name = name.slice(0, 120);
        session.updatedAt = Date.now();
        saveSessions(sessions);
        result = { session: publicSession(session) };
        break;
      }
      case "sessions/delete": {
        const sessionId = stringParam(params, "session_id");
        cancelChatSession({ session_id: sessionId });
        const index = sessions.findIndex((item) => item.id === sessionId);
        if (index < 0) throw new Error("Chat session does not exist");
        sessions.splice(index, 1);
        saveSessions(sessions);
        result = { deleted: true };
        break;
      }
      case "sessions/prompt":
        result = await promptSession(params);
        break;
      case "sessions/cancel":
        result = { cancelled: cancelChatSession(params) };
        break;
      case "agents":
      case "agents/list":
      case "registry/agents": {
        const agentSessions = agentHarness.list();
        result = {
          agents: agentDefinitions.list().map((agent) => ({
            ...agent,
            id: agent.name,
            status: agentHarness.activeCount(agent.name) ? "running" : "idle",
            tools: agentHarness.tools(agent.name),
            sessions: agentSessions.filter(
              (session) => session.agent === agent.name,
            ).length,
            tasks: swarm
              .listTasks()
              .filter((task) => task.name.startsWith(`${agent.name}:`)).length,
          })),
        };
        break;
      }
      case "agent.definitions.list":
        result = { agents: agentDefinitions.list() };
        break;
      case "agent.definitions.create":
        result = { agent: agentDefinitions.create(params) };
        break;
      case "agent.definitions.update":
        result = {
          agent: agentDefinitions.update(stringParam(params, "name"), params),
        };
        break;
      case "agent.definitions.delete":
        result = {
          deleted: agentDefinitions.remove(stringParam(params, "name")),
        };
        break;
      case "agent.tools": {
        const agent = stringParam(params, "agent", "general");
        const names = agentHarness.tools(agent);
        result = {
          agent,
          names,
          schemas: core.getToolSchemas(names),
        };
        break;
      }
      case "agent.sessions.create": {
        const session = agentHarness.create({
          agent: stringParam(params, "agent", "general"),
          provider: stringParam(params, "provider") || undefined,
          model: stringParam(params, "model") || undefined,
        });
        result = { session: agentHarness.get(session.id) };
        break;
      }
      case "agent.sessions.list":
        result = { sessions: agentHarness.list() };
        break;
      case "agent.sessions.get":
        result = {
          session: agentHarness.get(
            stringParam(params, "sessionId") || stringParam(params, "id"),
          ),
        };
        break;
      case "agent.sessions.prompt":
        result = await submitAgentTask({
          ...params,
          sessionId:
            stringParam(params, "sessionId") || stringParam(params, "id"),
        });
        break;
      case "agent.sessions.rename":
        result = {
          session: agentHarness.rename(
            stringParam(params, "sessionId") || stringParam(params, "id"),
            stringParam(params, "name"),
          ),
        };
        break;
      case "agent.sessions.delete":
        result = {
          deleted: agentHarness.remove(
            stringParam(params, "sessionId") || stringParam(params, "id"),
          ),
        };
        break;
      case "agent.sessions.branch": {
        const branch = agentHarness.branch(
          stringParam(params, "sessionId") || stringParam(params, "id"),
          typeof params.messageIndex === "number"
            ? params.messageIndex
            : undefined,
        );
        result = { session: agentHarness.get(branch.id) };
        break;
      }
      case "agent.sessions.retry": {
        const branch = agentHarness.branch(
          stringParam(params, "sessionId") || stringParam(params, "id"),
          typeof params.messageIndex === "number"
            ? params.messageIndex
            : undefined,
        );
        result = await submitAgentTask({
          sessionId: branch.id,
          prompt: stringParam(
            params,
            "prompt",
            branch.prompt || "Continue from this branch",
          ),
          provider: params.provider,
          model: params.model,
        });
        break;
      }
      case "agent.sessions.cancel":
        result = {
          cancelled: agentHarness.cancel(
            stringParam(params, "sessionId") || stringParam(params, "id"),
          ),
        };
        break;
      case "agent.run":
        result = await submitAgentTask(params);
        break;
      case "agent.orchestrate":
        result = await orchestrateAgents(params);
        break;
      case "swarm.status":
        result = {
          stats: swarm.getStats(),
          workers: swarm.listWorkers(),
          tasks: swarm.listTasks(),
        };
        break;
      case "swarm.submit":
        result = await submitSwarmTask(params);
        break;
      case "swarm.task":
        result = { task: swarm.getTask(stringParam(params, "taskId")) ?? null };
        break;
      case "swarm.cancel": {
        const taskId = stringParam(params, "taskId");
        const agentCancelled = agentHarness.cancelTask(taskId);
        result = {
          cancelled: swarm.cancelTask(taskId),
          agentCancelled,
        };
        break;
      }
      case "mcp-status":
      case "mcp.status": {
        const servers = mcp.status();
        result = {
          available: true,
          connected: servers.filter((server) => server.status === "connected")
            .length,
          total: servers.length,
          servers,
        };
        break;
      }
      case "mcp.sync":
        result = { servers: await mcp.sync() };
        break;
      case "mcp.connect":
        result = await mcp.connect(stringParam(params, "serverId"));
        break;
      case "mcp.disconnect":
        result = {
          disconnected: await mcp.disconnect(stringParam(params, "serverId")),
        };
        break;
      case "mcp.call": {
        const callId = stringParam(params, "callId") || crypto.randomUUID();
        const controller = new AbortController();
        const existing = runningMcpCalls.get(callId);
        if (existing) existing.abort();
        runningMcpCalls.set(callId, controller);
        emit("mcp.call.started", {
          callId,
          serverId: stringParam(params, "serverId"),
          name: stringParam(params, "name"),
        });
        try {
          result = await mcp.callTool(
            stringParam(params, "serverId"),
            stringParam(params, "name"),
            isRecord(params.arguments) ? params.arguments : {},
            {
              signal: controller.signal,
              timeoutMs: numberParam(params, "timeoutMs", 120_000),
            },
          );
          emit("mcp.call.finished", { callId });
        } catch (error) {
          if (controller.signal.aborted) {
            emit("mcp.call.cancelled", { callId });
            throw new Error("MCP call was cancelled");
          }
          throw error;
        } finally {
          if (runningMcpCalls.get(callId) === controller)
            runningMcpCalls.delete(callId);
        }
        break;
      }
      case "mcp.cancel": {
        const callId = stringParam(params, "callId");
        const controller = runningMcpCalls.get(callId);
        if (controller) {
          controller.abort();
          runningMcpCalls.delete(callId);
        }
        result = { cancelled: Boolean(controller) };
        break;
      }
      case "terminal/suggest": {
        const prompt = stringParam(params, "prompt").trim();
        if (!prompt) throw new Error("Suggestion prompt is required");
        const suggestion = (await chatCompletion({
          messages: [
            {
              role: "system",
              content:
                "Return exactly one shell command for the user's request. No markdown or explanation.",
            },
            { role: "user", content: prompt },
          ],
        })) as Record<string, unknown>;
        result = { command: String(suggestion.content ?? "").trim() };
        break;
      }
      default:
        throw new Error(`Unknown method: ${method}`);
    }
    send({ id, result });
  } catch (error) {
    send({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const input = readline.createInterface({
  input: process.stdin,
  terminal: false,
});
input.on("line", (line) => {
  const value = line.trim();
  if (!value) return;
  try {
    void handle(JSON.parse(value) as EngineRequest);
  } catch {
    // Invalid JSON does not terminate the engine.
  }
});
input.on("close", () => {
  for (const running of runningCommands.values()) running.process.kill();
  for (const controller of runningChats.values()) controller.abort();
  for (const controller of runningMcpCalls.values()) controller.abort();
  runningChats.clear();
  runningMcpCalls.clear();
  approvals.close();
  commandExecutor.close();
  agentHarness.close();
  void Promise.all([
    redirectLogsToStderr(() => core.close()),
    mcp.close(),
  ]).finally(() => process.exit(0));
});

send({ id: null, result: { ready: true } });
