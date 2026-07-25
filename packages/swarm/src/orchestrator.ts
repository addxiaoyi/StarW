import type {
  Task,
  SwarmConfig,
  OrchestrationResult,
  TaskAssignment,
} from "./types";
import type {
  AgentDefinition,
  AgentInstance,
  ChatMessage as CoreChatMessage,
  SkillDefinition,
  SkillRegistry,
} from "@openstar/core";
import { SubAgentManager } from "./subagent";
import { ProxyClusterManager } from "./proxy_cluster";
import { decomposeTask, canDecomposeFurther, calculateTaskComplexity } from "./task_decomposer";
import { generateTaskId, tools, RuleEngine } from "@openstar/core";
import type { Relay, ChatCompletionRequest } from "@openstar/relay";

type RelayChatMessage = ChatCompletionRequest["messages"][number];

export interface OrchestratorOptions {
  config?: Partial<SwarmConfig>;
  agentDefinitions?: AgentDefinition[];
  clusterConfig?: {
    nodeId: string;
    enabled: boolean;
  };
  toolRegistry?: tools.ToolRegistry;
  skillRegistry?: SkillRegistry;
  relay?: Relay;
  ruleEngine?: RuleEngine;
}

export interface ExecuteTaskOptions {
  autoDecompose?: boolean;
  maxDecompositionDepth?: number;
  preferredAgentId?: string;
  onProgress?: (task: Task) => void;
  onSubtaskComplete?: (subtask: Task, result: OrchestrationResult) => void;
}

export interface ToolCallStep {
  tool: string;
  arguments: Record<string, unknown>;
  success: boolean;
  resultSummary: string;
  durationMs: number;
  timestamp: number;
}

export class AgentOrchestrator {
  private config: SwarmConfig;
  private subAgentManager: SubAgentManager;
  private clusterManager: ProxyClusterManager | null = null;
  private toolRegistry: tools.ToolRegistry;
  private skillRegistry: SkillRegistry | null = null;
  private relay: Relay | null = null;
  private ruleEngine: RuleEngine | null = null;
  private tasks: Map<string, Task> = new Map();
  private taskQueue: string[] = [];
  private assignments: Map<string, TaskAssignment> = new Map();
  private running = false;
  private results: Map<string, OrchestrationResult> = new Map();

  constructor(options: OrchestratorOptions = {}) {
    const defaultConfig: SwarmConfig = {
      maxConcurrentAgents: 4,
      maxTaskRetries: 2,
      taskTimeoutMs: 600000,
      enableParallelExecution: true,
      defaultAgentId: "primary",
    };

    this.config = { ...defaultConfig, ...options.config };
    this.subAgentManager = new SubAgentManager();
    this.toolRegistry = options.toolRegistry ?? tools.getToolRegistry();
    this.relay = options.relay ?? null;
    this.ruleEngine = options.ruleEngine ?? null;
    tools.registerBuiltins(this.toolRegistry);

    if (options.skillRegistry) {
      this.skillRegistry = options.skillRegistry;
      this.syncSkillAgents();
    }

    if (options.agentDefinitions) {
      for (const def of options.agentDefinitions) {
        this.subAgentManager.registerDefinition(def);
      }
    }

    if (options.clusterConfig?.enabled) {
      this.clusterManager = new ProxyClusterManager({
        nodeId: options.clusterConfig.nodeId,
      });
    }
  }

  getSubAgentManager(): SubAgentManager {
    return this.subAgentManager;
  }

  getClusterManager(): ProxyClusterManager | null {
    return this.clusterManager;
  }

  getConfig(): SwarmConfig {
    return { ...this.config };
  }

  setConfig(config: Partial<SwarmConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getSkillRegistry(): SkillRegistry | null {
    return this.skillRegistry;
  }

  setSkillRegistry(registry: SkillRegistry): void {
    this.skillRegistry = registry;
    this.syncSkillAgents();
  }

  getRuleEngine(): RuleEngine | null {
    return this.ruleEngine;
  }

  setRuleEngine(engine: RuleEngine | null): void {
    this.ruleEngine = engine;
  }

  private syncSkillAgents(): void {
    if (!this.skillRegistry) return;
    for (const agent of this.skillRegistry.listAgents()) {
      this.subAgentManager.registerDefinition(agent);
    }
  }

  registerAgentDefinition(definition: AgentDefinition): void {
    this.subAgentManager.registerDefinition(definition);
  }

  getSkill(id: string): SkillDefinition | undefined {
    return this.skillRegistry?.get(id);
  }

  listSkills(): SkillDefinition[] {
    return this.skillRegistry?.list() ?? [];
  }

  listAgentDefinitions(): AgentDefinition[] {
    return this.subAgentManager.listDefinitions();
  }

  async executeSkill(
    skillId: string,
    input: Record<string, unknown> = {},
    options: { cwd?: string; preferredAgentId?: string; autoDecompose?: boolean } = {}
  ): Promise<OrchestrationResult> {
    const skill = this.skillRegistry?.get(skillId);
    const agent = this.skillRegistry?.listAgents().find((a) => a.id === skillId);

    const definition = agent || (skill ? this.skillToAgent(skill) : null);
    if (!definition) {
      return {
        taskId: "",
        success: false,
        output: {},
        error: `Skill or agent not found: ${skillId}`,
        agentId: "none",
        durationMs: 0,
      };
    }

    this.subAgentManager.registerDefinition(definition);

    const task = this.createTask(definition.name, definition.description, {
      input: {
        cwd: input.cwd ?? options.cwd ?? process.cwd(),
        ...input,
      },
    });

    return this.executeTask(task.id, {
      preferredAgentId: options.preferredAgentId ?? definition.id,
      autoDecompose: options.autoDecompose,
    });
  }

  private skillToAgent(skill: SkillDefinition): AgentDefinition {
    return {
      id: skill.id,
      name: skill.name,
      type: "specialist",
      description: skill.description,
      systemPrompt: skill.systemPromptAddon,
      capabilities: skill.tags.map((tag) => ({
        name: tag,
        description: `Tag: ${tag}`,
        version: "1.0.0",
        tags: [],
      })),
      skills: [],
      mcpServers: [],
      maxConcurrentTasks: 1,
      timeoutMs: 300000,
    };
  }

  createTask(
    title: string,
    description: string,
    options: Partial<Task> = {}
  ): Task {
    const now = Date.now();
    const task: Task = {
      id: generateTaskId(),
      title,
      description,
      priority: options.priority || "normal",
      status: "pending",
      parentTaskId: options.parentTaskId,
      subtaskIds: options.subtaskIds || [],
      requiredCapabilities: options.requiredCapabilities || [],
      input: options.input || {},
      output: {},
      createdAt: now,
      progress: 0,
      dependencies: options.dependencies || [],
      metadata: options.metadata || {},
    };

    if (this.ruleEngine) {
      const sessionCheck = this.ruleEngine.evaluateSession({ title, description });
      const sceneCheck = this.ruleEngine.evaluateScene({ title, description });

      task.metadata = {
        ...task.metadata,
        ruleCheck: {
          session: sessionCheck,
          scene: sceneCheck,
        },
      };

      if (sessionCheck.action === "block") {
        task.status = "blocked";
        task.error = sessionCheck.reason;
      }

      if (sceneCheck.agentId) {
        (task.metadata as Record<string, unknown>).sceneAgentId = sceneCheck.agentId;
      }

      for (const cap of sceneCheck.capabilities) {
        if (!task.requiredCapabilities.includes(cap)) {
          task.requiredCapabilities.push(cap);
        }
      }
    }

    this.tasks.set(task.id, task);
    return task;
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  listTasks(filters?: {
    status?: Task["status"];
    priority?: Task["priority"];
    parentTaskId?: string;
  }): Task[] {
    let result = Array.from(this.tasks.values());

    if (filters?.status) {
      result = result.filter((t) => t.status === filters.status);
    }
    if (filters?.priority) {
      result = result.filter((t) => t.priority === filters.priority);
    }
    if (filters?.parentTaskId) {
      result = result.filter((t) => t.parentTaskId === filters.parentTaskId);
    }

    return result.sort((a, b) => {
      const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
      const prioDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (prioDiff !== 0) return prioDiff;
      return a.createdAt - b.createdAt;
    });
  }

  async executeTask(
    taskId: string,
    options: ExecuteTaskOptions = {}
  ): Promise<OrchestrationResult> {
    const {
      autoDecompose = false,
      maxDecompositionDepth = 2,
      preferredAgentId,
      onProgress,
      onSubtaskComplete,
    } = options;

    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (task.status === "blocked") {
      const result: OrchestrationResult = {
        taskId: task.id,
        success: false,
        output: {},
        error: task.error || "Task blocked by rule engine",
        agentId: "none",
        durationMs: 0,
      };
      this.results.set(task.id, result);
      return result;
    }

    if (this.ruleEngine) {
      const sessionCheck = this.ruleEngine.evaluateSession({
        title: task.title,
        description: task.description,
      });
      if (sessionCheck.action === "block") {
        task.status = "blocked";
        task.error = sessionCheck.reason;
        task.completedAt = Date.now();
        const result: OrchestrationResult = {
          taskId: task.id,
          success: false,
          output: {},
          error: sessionCheck.reason,
          agentId: "none",
          durationMs: 0,
        };
        this.results.set(task.id, result);
        if (onProgress) onProgress(task);
        return result;
      }
    }

    const complexity = calculateTaskComplexity(task);

    if (autoDecompose && canDecomposeFurther(task, 0, maxDecompositionDepth) && complexity > 3) {
      return this.executeWithDecomposition(task, {
        maxDepth: maxDecompositionDepth,
        onProgress,
        onSubtaskComplete,
        preferredAgentId,
      });
    }

    return this.executeSingleTask(task, preferredAgentId, onProgress);
  }

  private async executeWithDecomposition(
    task: Task,
    options: {
      maxDepth: number;
      preferredAgentId?: string;
      onProgress?: (task: Task) => void;
      onSubtaskComplete?: (subtask: Task, result: OrchestrationResult) => void;
    }
  ): Promise<OrchestrationResult> {
    const { maxDepth, preferredAgentId, onProgress, onSubtaskComplete } = options;
    const startTime = Date.now();

    const plan = decomposeTask(task.description, {
      priority: task.priority,
      parentTaskId: task.id,
    });

    task.subtaskIds = plan.subtasks.map((t) => t.id);
    task.status = "running";
    for (const subtask of plan.subtasks) {
      this.tasks.set(subtask.id, subtask);
    }

    if (onProgress) onProgress(task);

    const subtaskResults: OrchestrationResult[] = [];

    if (this.config.enableParallelExecution) {
      const independentGroups = this.groupIndependentSubtasks(plan.subtasks);

      for (const group of independentGroups) {
        const promises = group.map((subtask) =>
          this.executeSingleSubtask(subtask, preferredAgentId, onSubtaskComplete)
        );

        const groupResults = await Promise.all(promises);
        subtaskResults.push(...groupResults);
      }
    } else {
      for (const subtask of plan.subtasks) {
        const result = await this.executeSingleSubtask(subtask, preferredAgentId, onSubtaskComplete);
        subtaskResults.push(result);
      }
    }

    const allSuccess = subtaskResults.every((r) => r.success);

    task.status = allSuccess ? "completed" : "failed";
    task.completedAt = Date.now();
    task.progress = 100;
    task.output = {
      subtaskResults: subtaskResults.map((r) => r.output),
      strategy: plan.strategy,
      subtaskCount: plan.subtasks.length,
    };

    if (!allSuccess) {
      const failed = subtaskResults.find((r) => !r.success);
      task.error = failed?.error || "One or more subtasks failed";
    }

    if (onProgress) onProgress(task);

    const result: OrchestrationResult = {
      taskId: task.id,
      success: allSuccess,
      output: task.output,
      error: task.error,
      agentId: "swarm-orchestrator",
      durationMs: Date.now() - startTime,
    };

    this.results.set(task.id, result);
    return result;
  }

  private async executeSingleSubtask(
    subtask: Task,
    preferredAgentId?: string,
    onComplete?: (subtask: Task, result: OrchestrationResult) => void
  ): Promise<OrchestrationResult> {
    const result = await this.executeSingleTask(subtask, preferredAgentId);

    if (onComplete) {
      onComplete(subtask, result);
    }

    return result;
  }

  private groupIndependentSubtasks(subtasks: Task[]): Task[][] {
    const groups: Task[][] = [];
    const completedIds = new Set<string>();

    let remaining = [...subtasks];

    while (remaining.length > 0) {
      const currentGroup: Task[] = [];
      const nextRemaining: Task[] = [];

      for (const task of remaining) {
        const depsMet = task.dependencies.every((dep) => {
          const depTask = subtasks.find((t) => t.title === dep);
          return !depTask || completedIds.has(depTask.id);
        });

        if (depsMet && currentGroup.length < this.config.maxConcurrentAgents) {
          currentGroup.push(task);
        } else {
          nextRemaining.push(task);
        }
      }

      if (currentGroup.length === 0 && nextRemaining.length > 0) {
        currentGroup.push(nextRemaining.shift()!);
      }

      groups.push(currentGroup);
      for (const t of currentGroup) {
        completedIds.add(t.id);
      }
      remaining = nextRemaining;
    }

    return groups;
  }

  private async executeSingleTask(
    task: Task,
    preferredAgentId?: string,
    onProgress?: (task: Task) => void
  ): Promise<OrchestrationResult> {
    const startTime = Date.now();

    task.status = "queued";
    if (onProgress) onProgress(task);

    const agentDef = this.selectAgent(task, preferredAgentId);
    if (!agentDef) {
      const result: OrchestrationResult = {
        taskId: task.id,
        success: false,
        output: {},
        error: "No suitable agent found for task",
        agentId: "none",
        durationMs: Date.now() - startTime,
      };
      task.status = "failed";
      task.error = result.error;
      task.completedAt = Date.now();
      this.results.set(task.id, result);
      return result;
    }

    const instance = this.subAgentManager.spawnAgent({
      definition: agentDef,
      taskId: task.id,
      sessionId: task.id,
    });

    task.status = "assigned";
    task.assignedAgentId = instance.instanceId;
    task.startedAt = Date.now();
    if (onProgress) onProgress(task);

    this.assignments.set(task.id, {
      taskId: task.id,
      agentId: instance.instanceId,
      assignedAt: Date.now(),
    });

    try {
      task.status = "running";
      task.progress = 10;
      if (onProgress) onProgress(task);

      const output = await this.executeAgentWork(task, agentDef);

      task.status = output.success ? "completed" : "failed";
      task.progress = 100;
      task.output = output;
      task.completedAt = Date.now();

      if (!output.success) {
        task.error = output.error || "Agent execution failed";
        this.subAgentManager.setError(instance.instanceId, task.error);
        this.applyCompletionRuleCheck(task);

        const result: OrchestrationResult = {
          taskId: task.id,
          success: false,
          output: output,
          error: task.error,
          agentId: agentDef.id,
          durationMs: Date.now() - startTime,
        };

        this.results.set(task.id, result);
        if (onProgress) onProgress(task);

        return result;
      }

      this.subAgentManager.updateStatus(instance.instanceId, "completed");
      this.applyCompletionRuleCheck(task);

      const result: OrchestrationResult = {
        taskId: task.id,
        success: true,
        output,
        agentId: agentDef.id,
        durationMs: Date.now() - startTime,
      };

      this.results.set(task.id, result);
      if (onProgress) onProgress(task);

      return result;
    } catch (error) {
      task.status = "failed";
      task.error = error instanceof Error ? error.message : String(error);
      task.completedAt = Date.now();

      this.subAgentManager.setError(instance.instanceId, task.error);
      this.applyCompletionRuleCheck(task);

      const result: OrchestrationResult = {
        taskId: task.id,
        success: false,
        output: {},
        error: task.error,
        agentId: agentDef.id,
        durationMs: Date.now() - startTime,
      };

      this.results.set(task.id, result);
      if (onProgress) onProgress(task);

      return result;
    }
  }

  private applyCompletionRuleCheck(task: Task): void {
    if (!this.ruleEngine) return;
    const check = this.ruleEngine.evaluateSession({
      title: task.title,
      description: task.description,
    });
    task.metadata = {
      ...task.metadata,
      completionRuleCheck: check,
    };
  }

  private selectAgent(
    task: Task,
    preferredAgentId?: string
  ): AgentDefinition | null {
    const sceneAgentId = (task.metadata?.sceneAgentId as string) || undefined;

    if (preferredAgentId) {
      const preferred = this.subAgentManager.getDefinition(preferredAgentId);
      if (preferred) return preferred;
    }

    if (sceneAgentId) {
      const sceneAgent = this.subAgentManager.getDefinition(sceneAgentId);
      if (sceneAgent) return sceneAgent;
    }

    if (this.clusterManager) {
      const node = this.clusterManager.assignTask(task, "capability-match");
      if (node) {
        const remoteAgentDef: AgentDefinition = {
          id: `remote-${node.id}`,
          name: `Remote Agent on ${node.id}`,
          type: "worker",
          description: `Remote worker on node ${node.address}`,
          capabilities: node.agentTypes.map((t) => ({
            name: t,
            description: `Capability ${t}`,
            version: "1.0.0",
            tags: [],
          })),
          skills: [],
          mcpServers: [],
          maxConcurrentTasks: 1,
          timeoutMs: 300000,
        };
        return remoteAgentDef;
      }
    }

    return this.subAgentManager.findBestAgentForTask(task.requiredCapabilities);
  }

  private buildToolSchemas(): Array<Record<string, unknown>> {
    return this.toolRegistry.list().map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object",
          properties: this.buildParameterProperties(tool.parameters ?? {}),
          required: Object.entries(tool.parameters ?? {})
            .filter(([, p]) => p.required !== false)
            .map(([name]) => name),
        },
      },
    }));
  }

  private buildParameterProperties(
    parameters: Record<string, tools.ToolParameter>
  ): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    for (const [name, param] of Object.entries(parameters)) {
      properties[name] = {
        type: param.type,
        description: param.description,
      };
    }
    return properties;
  }

  private buildSystemPrompt(
    agentDef: AgentDefinition,
    toolSchemas: Array<Record<string, unknown>>
  ): string {
    const toolDescriptions = toolSchemas
      .map((t) => {
        const fn = (t as { function: { name: string; description: string } }).function;
        return `- ${fn.name}: ${fn.description}`;
      })
      .join("\n");

    return [
      `You are ${agentDef.name}. ${agentDef.description}`,
      agentDef.systemPrompt || "",
      "",
      "You have access to the following tools:",
      toolDescriptions || "(no tools available)",
      "",
      "When you need to act, respond with one or more tool calls. " +
        "When you are done, return a final plain text answer.",
      "Always prefer using tools to accomplish the user's request rather than asking follow-up questions.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  private buildUserPrompt(task: Task): string {
    const context = Object.entries(task.input || {})
      .filter(([key]) => key !== "toolCalls")
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join("\n");

    return [`Task: ${task.title}`, `Description: ${task.description}`, context ? `Context:\n${context}` : ""]
      .filter(Boolean)
      .join("\n");
  }

  private parseToolArguments(args: string): Record<string, unknown> {
    try {
      return JSON.parse(args) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private serializeToolResult(result: Record<string, unknown>, maxLength = 4000): string {
    const payload = {
      success: result.success,
      output: result.output,
      error: result.error,
    };
    const text = JSON.stringify(payload);
    if (text.length <= maxLength) return text;
    const truncated = text.slice(0, maxLength);
    return `${truncated}\n...[truncated ${text.length - maxLength} chars]`;
  }

  private summarizeToolResult(result: Record<string, unknown>, maxLength = 1000): string {
    if (result.success === false) {
      return String(result.error || "执行失败");
    }
    const payload = result.output;
    const text = typeof payload === "string" ? payload : JSON.stringify(payload);
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}\n...[truncated ${text.length - maxLength} chars]`;
  }

  private async executeSingleToolCall(
    call: { tool: string; input: Record<string, unknown> },
    task: Task,
    agentDef: AgentDefinition
  ): Promise<Record<string, unknown> & { success: boolean; error?: string }> {
    const context: tools.ToolContext = {
      cwd: (task.input.cwd as string | undefined) ?? process.cwd(),
      workdir: task.input.workdir as string | undefined,
      timeoutMs: agentDef.timeoutMs,
      env: task.input.env as Record<string, string> | undefined,
    };

    const result = await this.toolRegistry.execute(call.tool, call.input, context);
    return { tool: call.tool, input: call.input, ...result };
  }

  private async executeLlmAgentLoop(
    task: Task,
    agentDef: AgentDefinition
  ): Promise<Record<string, unknown> & { success: boolean; error?: string }> {
    if (!this.relay) {
      return {
        success: false,
        error: "Relay not configured. Add an API key to enable LLM agent loop.",
        agent: agentDef.name,
        taskTitle: task.title,
        timestamp: Date.now(),
      };
    }

    const toolSchemas = this.buildToolSchemas();
    const messages: RelayChatMessage[] = [
      { role: "system", content: this.buildSystemPrompt(agentDef, toolSchemas) },
      { role: "user", content: this.buildUserPrompt(task) },
    ];

    const maxIterations = 8;
    const executedResults: Array<Record<string, unknown>> = [];
    const toolCallSteps: ToolCallStep[] = [];
    let finalContent = "";

    if (!task.metadata) task.metadata = {};

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const request: ChatCompletionRequest = {
        model: agentDef.model || (task.input.model as string) || "gpt-4o-mini",
        messages,
        temperature: 0.2,
        maxTokens: 4096,
        tools: toolSchemas.length > 0 ? toolSchemas : undefined,
      };

      let response;
      try {
        response = await this.relay.chatCompletion(request);
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
          agent: agentDef.name,
          taskTitle: task.title,
          timestamp: Date.now(),
          results: executedResults,
          toolCalls: toolCallSteps,
        };
      }

      const choice = response.choices[0];
      const message = choice?.message;
      if (!message) {
        return {
          success: false,
          error: "LLM returned an empty message",
          agent: agentDef.name,
          taskTitle: task.title,
          timestamp: Date.now(),
          results: executedResults,
          toolCalls: toolCallSteps,
        };
      }

      if (message.tool_calls && message.tool_calls.length > 0) {
        messages.push({
          role: "assistant",
          content: message.content || "",
          tool_calls: message.tool_calls,
        });

        for (const toolCall of message.tool_calls) {
          const fn = (toolCall as { function: { name: string; arguments: string } }).function;
          const args = this.parseToolArguments(fn.arguments);

          if (this.ruleEngine) {
            const guard = this.ruleEngine.evaluateTool(fn.name, args, {
              cwd: (task.input.cwd as string) || process.cwd(),
              sessionId: task.id,
            });

            if (guard.action === "block") {
              const blockedResult = {
                tool: fn.name,
                input: args,
                success: false,
                error: `[Guard BLOCK] ${guard.reason}`,
                risk: guard.risk,
              };
              executedResults.push(blockedResult);
              toolCallSteps.push({
                tool: fn.name,
                arguments: args,
                success: false,
                resultSummary: blockedResult.error,
                durationMs: 0,
                timestamp: Date.now(),
              });
              (task.metadata as Record<string, unknown>).toolCalls = [...toolCallSteps];

              messages.push({
                role: "tool",
                content: this.serializeToolResult(blockedResult),
                tool_call_id: (toolCall as { id: string }).id,
              });
              continue;
            }
          }

          const stepStart = Date.now();
          const toolResult = await this.executeSingleToolCall(
            { tool: fn.name, input: args },
            task,
            agentDef
          );
          const durationMs = Date.now() - stepStart;
          executedResults.push(toolResult);

          toolCallSteps.push({
            tool: fn.name,
            arguments: args,
            success: toolResult.success !== false,
            resultSummary: this.summarizeToolResult(toolResult),
            durationMs,
            timestamp: Date.now(),
          });
          (task.metadata as Record<string, unknown>).toolCalls = [...toolCallSteps];

          messages.push({
            role: "tool",
            content: this.serializeToolResult(toolResult),
            tool_call_id: (toolCall as { id: string }).id,
          });
        }
      } else {
        finalContent = message.content || "";
        break;
      }
    }

    if (toolCallSteps.length > 0) {
      const marker = `<!--TOOL_CALLS:${JSON.stringify(toolCallSteps)}-->`;
      finalContent = finalContent ? `${finalContent}\n${marker}` : marker;
    }

    const allSuccess = executedResults.length === 0 || executedResults.every((r) => r.success !== false);
    const firstError = executedResults.find((r) => r.success === false);

    return {
      success: allSuccess,
      error: firstError?.error as string | undefined,
      agent: agentDef.name,
      taskTitle: task.title,
      timestamp: Date.now(),
      results: executedResults,
      toolCalls: toolCallSteps,
      content: finalContent,
    };
  }

  private async executeAgentWork(
    task: Task,
    agentDef: AgentDefinition
  ): Promise<Record<string, unknown> & { success: boolean; error?: string }> {
    const toolCalls = task.input.toolCalls as Array<{ tool: string; input: Record<string, unknown> }> | undefined;

    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return this.executeLlmAgentLoop(task, agentDef);
    }

    const context: tools.ToolContext = {
      cwd: (task.input.cwd as string | undefined) ?? process.cwd(),
      workdir: task.input.workdir as string | undefined,
      timeoutMs: agentDef.timeoutMs,
      env: task.input.env as Record<string, string> | undefined,
    };

    const results: Array<Record<string, unknown>> = [];

    for (const call of toolCalls) {
      if (!call || typeof call !== "object") continue;
      const name = (call as Record<string, unknown>).tool as string;
      const input = ((call as Record<string, unknown>).input as Record<string, unknown>) ?? {};

      if (!name || typeof name !== "string") {
        results.push({ tool: name, success: false, error: "Missing tool name" });
        continue;
      }

      const result = await this.toolRegistry.execute(name, input, context);
      results.push({ tool: name, input, ...result });

      if (!result.success && !task.input.continueOnError) {
        break;
      }
    }

    const allSuccess = results.length > 0 && results.every((r) => r.success !== false);
    const firstError = results.find((r) => r.success === false);

    return {
      success: allSuccess,
      error: firstError?.error as string | undefined,
      agent: agentDef.name,
      taskTitle: task.title,
      timestamp: Date.now(),
      results,
    };
  }

  async suggestCommand(
    prompt: string
  ): Promise<{ success: boolean; command: string; error?: string }> {
    if (!this.relay) {
      return { success: false, command: "", error: "Relay not configured" };
    }

    try {
      const response = await this.relay.chatCompletion({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a shell expert. Given a user request, output only the bash command, no explanation.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        maxTokens: 256,
      });

      const command = response.choices[0]?.message?.content?.trim() || "";
      return { success: true, command };
    } catch (err) {
      return {
        success: false,
        command: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.processQueue();
  }

  stop(): void {
    this.running = false;
  }

  private processQueue(): void {
    if (!this.running) return;

    const runningCount = this.subAgentManager.getRunningCount();
    if (runningCount >= this.config.maxConcurrentAgents) {
      setTimeout(() => this.processQueue(), 100);
      return;
    }

    const pendingTasks = this.listTasks({ status: "pending" });
    if (pendingTasks.length === 0) {
      setTimeout(() => this.processQueue(), 100);
      return;
    }

    const availableSlots = this.config.maxConcurrentAgents - runningCount;
    const tasksToStart = pendingTasks.slice(0, availableSlots);

    for (const task of tasksToStart) {
      this.executeTask(task.id).catch(() => {
        // error is stored in result map
      });
    }

    setTimeout(() => this.processQueue(), 100);
  }

  getResult(taskId: string): OrchestrationResult | undefined {
    return this.results.get(taskId);
  }

  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
      return false;
    }

    task.status = "cancelled";
    task.completedAt = Date.now();

    const assignment = this.assignments.get(taskId);
    if (assignment) {
      this.subAgentManager.terminateAgent(assignment.agentId);
    }

    for (const subtaskId of task.subtaskIds) {
      this.cancelTask(subtaskId);
    }

    return true;
  }

  getStats() {
    const tasks = Array.from(this.tasks.values());
    const statusCounts: Record<string, number> = {};

    for (const task of tasks) {
      statusCounts[task.status] = (statusCounts[task.status] || 0) + 1;
    }

    return {
      totalTasks: tasks.length,
      statusCounts,
      runningAgents: this.subAgentManager.getRunningCount(),
      maxConcurrentAgents: this.config.maxConcurrentAgents,
      clusterEnabled: this.clusterManager !== null,
    };
  }
}

export let defaultOrchestrator: AgentOrchestrator | null = null;

export function initOrchestrator(options?: OrchestratorOptions): AgentOrchestrator {
  defaultOrchestrator = new AgentOrchestrator(options);
  return defaultOrchestrator;
}

export function getOrchestrator(): AgentOrchestrator {
  if (!defaultOrchestrator) {
    defaultOrchestrator = new AgentOrchestrator();
  }
  return defaultOrchestrator;
}
