import {
  AgentRegistry as AgentRegistryClass,
  type AgentRegistry,
} from "../../core/src/system/agent.js";
import {
  ToolRegistry as ToolRegistryClass,
  type ToolContext,
  type ToolRegistry,
} from "../../core/src/system/tool-registry.js";
import { ulid } from "ulid";

export const TaskStatusSchema = {
  pending: "pending",
  running: "running",
  waiting: "waiting",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
} as const;
export type TaskStatus =
  (typeof TaskStatusSchema)[keyof typeof TaskStatusSchema];

export const TaskPrioritySchema = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
} as const;
export type TaskPriority =
  (typeof TaskPrioritySchema)[keyof typeof TaskPrioritySchema];

export interface Task<Input = unknown, Output = unknown> {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly priority: TaskPriority;
  readonly status: TaskStatus;
  readonly input: Input;
  readonly createdAt: number;
  readonly startedAt?: number;
  readonly completedAt?: number;
  readonly result?: Output;
  readonly error?: string;
  readonly dependencies: string[];
  readonly assignedWorker?: string;
}

export type TaskExecutor<Input, Output> = (
  input: Input,
  context: ToolContext,
  signal: AbortSignal,
) => Promise<Output>;

export interface WorkerState {
  readonly id: string;
  readonly name: string;
  readonly status: "idle" | "busy" | "offline";
  readonly currentTask?: string;
  readonly tasksCompleted: number;
  readonly tasksFailed: number;
  readonly memoryUsage: number;
  readonly lastActive: number;
}

export class AgentWorker {
  readonly id: string;
  readonly name: string;

  private status: "idle" | "busy" | "offline" = "idle";
  private currentTask?: string;
  private completed = 0;
  private failed = 0;
  private lastActive = Date.now();

  constructor(name: string) {
    this.id = ulid();
    this.name = name;
  }

  getState(): WorkerState {
    return {
      id: this.id,
      name: this.name,
      status: this.status,
      currentTask: this.currentTask,
      tasksCompleted: this.completed,
      tasksFailed: this.failed,
      memoryUsage: 0,
      lastActive: this.lastActive,
    };
  }

  setStatus(status: "idle" | "busy" | "offline"): void {
    this.status = status;
    this.lastActive = Date.now();
  }

  assignTask(taskId: string): void {
    this.currentTask = taskId;
    this.setStatus("busy");
  }

  completeTask(success: boolean): void {
    if (success) this.completed += 1;
    else this.failed += 1;
    this.currentTask = undefined;
    this.setStatus("idle");
  }
}

export interface SwarmConfig {
  readonly maxWorkers: number;
  readonly maxConcurrency: number;
  readonly taskTimeout: number;
  readonly enableAutoScale: boolean;
  readonly workingDirectory: string;
  readonly environment: Record<string, string>;
}

export const defaultSwarmConfig: SwarmConfig = {
  maxWorkers: 4,
  maxConcurrency: 2,
  taskTimeout: 300_000,
  enableAutoScale: true,
  workingDirectory: process.cwd(),
  environment: {},
};

interface TaskWaiter {
  resolve: (task: Task) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class TaskTimeoutError extends Error {}
class TaskCancelledError extends Error {}

export class SwarmManager {
  private readonly workers = new Map<string, AgentWorker>();
  private readonly tasks = new Map<string, Task>();
  private readonly executors = new Map<
    string,
    TaskExecutor<unknown, unknown>
  >();
  private readonly controllers = new Map<string, AbortController>();
  private readonly waiters = new Map<string, Set<TaskWaiter>>();
  private taskQueue: string[] = [];
  private readonly config: SwarmConfig;
  private activeExecutions = 0;
  private scheduleRequested = false;

  constructor(
    config: Partial<SwarmConfig>,
    private readonly toolRegistry: ToolRegistry,
    private readonly agentRegistry: AgentRegistry,
  ) {
    const maxWorkers = Math.max(
      1,
      Math.floor(config.maxWorkers ?? defaultSwarmConfig.maxWorkers),
    );
    const maxConcurrency = Math.max(
      1,
      Math.min(
        maxWorkers,
        Math.floor(config.maxConcurrency ?? defaultSwarmConfig.maxConcurrency),
      ),
    );
    this.config = {
      ...defaultSwarmConfig,
      ...config,
      maxWorkers,
      maxConcurrency,
      taskTimeout: Math.max(
        1,
        Math.floor(config.taskTimeout ?? defaultSwarmConfig.taskTimeout),
      ),
      workingDirectory:
        config.workingDirectory ?? defaultSwarmConfig.workingDirectory,
      environment: {
        ...(config.environment ?? defaultSwarmConfig.environment),
      },
    };
    this.initWorkers();
  }

  private initWorkers(): void {
    for (let index = 0; index < this.config.maxWorkers; index += 1) {
      const worker = new AgentWorker(`worker-${index + 1}`);
      this.workers.set(worker.id, worker);
    }
  }

  submit<Input, Output>(
    name: string,
    input: Input,
    executor: TaskExecutor<Input, Output>,
    options?: {
      priority?: TaskPriority;
      description?: string;
      dependencies?: string[];
      assignedWorker?: string;
    },
  ): string {
    if (!name.trim()) throw new Error("Task name is required");
    if (typeof executor !== "function")
      throw new TypeError("Task executor must be a function");
    if (options?.assignedWorker && !this.workers.has(options.assignedWorker)) {
      throw new Error(`Worker "${options.assignedWorker}" does not exist`);
    }

    const dependencies = [...new Set(options?.dependencies ?? [])];
    const taskId = ulid();
    if (dependencies.includes(taskId))
      throw new Error("A task cannot depend on itself");

    const task: Task<Input, Output> = {
      id: taskId,
      name: name.trim(),
      description: options?.description,
      priority: options?.priority ?? TaskPrioritySchema.normal,
      status: dependencies.length > 0 ? "waiting" : "pending",
      input,
      createdAt: Date.now(),
      dependencies,
      assignedWorker: options?.assignedWorker,
    };

    this.tasks.set(taskId, task as Task);
    this.executors.set(taskId, executor as TaskExecutor<unknown, unknown>);
    this.enqueueTask(taskId);
    this.requestSchedule();
    return taskId;
  }

  private enqueueTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const insertIndex = this.taskQueue.findIndex((id) => {
      const queued = this.tasks.get(id);
      return Boolean(queued && queued.priority < task.priority);
    });
    if (insertIndex === -1) this.taskQueue.push(taskId);
    else this.taskQueue.splice(insertIndex, 0, taskId);
  }

  private requestSchedule(): void {
    if (this.scheduleRequested) return;
    this.scheduleRequested = true;
    queueMicrotask(() => {
      this.scheduleRequested = false;
      this.dispatchTasks();
    });
  }

  private dispatchTasks(): void {
    while (this.activeExecutions < this.config.maxConcurrency) {
      const worker = [...this.workers.values()].find(
        (candidate) => candidate.getState().status === "idle",
      );
      if (!worker) return;
      const taskId = this.findRunnableTask(worker.id);
      if (!taskId) return;
      const task = this.tasks.get(taskId);
      if (!task) continue;
      this.taskQueue = this.taskQueue.filter((id) => id !== taskId);
      void this.executeTask(task, worker);
    }
  }

  private findRunnableTask(workerId: string): string | undefined {
    for (const taskId of [...this.taskQueue]) {
      const task = this.tasks.get(taskId);
      if (!task || (task.status !== "pending" && task.status !== "waiting"))
        continue;
      if (task.assignedWorker && task.assignedWorker !== workerId) continue;

      const dependencyFailure = task.dependencies
        .map((dependencyId) => this.tasks.get(dependencyId))
        .find(
          (dependency) =>
            !dependency ||
            dependency.status === "failed" ||
            dependency.status === "cancelled",
        );
      if (
        dependencyFailure !== undefined ||
        task.dependencies.some((dependencyId) => !this.tasks.has(dependencyId))
      ) {
        const failedDependency = task.dependencies.find((dependencyId) => {
          const dependency = this.tasks.get(dependencyId);
          return (
            !dependency ||
            dependency.status === "failed" ||
            dependency.status === "cancelled"
          );
        });
        this.taskQueue = this.taskQueue.filter((id) => id !== taskId);
        this.updateTask(taskId, "failed", {
          error: `Dependency "${failedDependency ?? "unknown"}" did not complete successfully`,
          completedAt: Date.now(),
        });
        this.executors.delete(taskId);
        this.notifyWaiters(taskId);
        continue;
      }

      const dependenciesComplete = task.dependencies.every(
        (dependencyId) => this.tasks.get(dependencyId)?.status === "completed",
      );
      if (!dependenciesComplete) {
        if (task.status !== "waiting") this.updateTask(taskId, "waiting");
        continue;
      }

      if (task.status !== "pending") this.updateTask(taskId, "pending");
      return taskId;
    }
    return undefined;
  }

  private async executeTask(task: Task, worker: AgentWorker): Promise<void> {
    const executor = this.executors.get(task.id);
    if (!executor) {
      this.updateTask(task.id, "failed", {
        error: "Task executor is unavailable",
        completedAt: Date.now(),
      });
      this.notifyWaiters(task.id);
      this.requestSchedule();
      return;
    }

    const controller = new AbortController();
    this.controllers.set(task.id, controller);
    this.activeExecutions += 1;
    worker.assignTask(task.id);
    this.updateTask(task.id, "running", {
      startedAt: Date.now(),
      assignedWorker: worker.id,
    });

    const context: ToolContext = {
      agentId: worker.id,
      agentType: "worker",
      sessionId: task.id,
      workingDirectory: this.config.workingDirectory,
      environment: { ...this.config.environment },
    };

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort("timeout");
        reject(
          new TaskTimeoutError(
            `Task timed out after ${this.config.taskTimeout}ms`,
          ),
        );
      }, this.config.taskTimeout);
    });
    const cancelledPromise = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => {
          if (controller.signal.reason !== "timeout")
            reject(new TaskCancelledError("Task was cancelled"));
        },
        { once: true },
      );
    });

    try {
      const result = await Promise.race([
        executor(task.input, context, controller.signal),
        timeoutPromise,
        cancelledPromise,
      ]);
      if (this.tasks.get(task.id)?.status !== "cancelled") {
        this.updateTask(task.id, "completed", {
          result,
          completedAt: Date.now(),
        });
      }
    } catch (error) {
      if (this.tasks.get(task.id)?.status !== "cancelled") {
        this.updateTask(task.id, "failed", {
          error: error instanceof Error ? error.message : String(error),
          completedAt: Date.now(),
        });
      }
    } finally {
      if (timeout) clearTimeout(timeout);
      this.controllers.delete(task.id);
      this.executors.delete(task.id);
      this.activeExecutions = Math.max(0, this.activeExecutions - 1);
      worker.completeTask(this.tasks.get(task.id)?.status === "completed");
      this.notifyWaiters(task.id);
      this.requestSchedule();
    }
  }

  private updateTask(
    taskId: string,
    status: TaskStatus,
    extra: Partial<Task> = {},
  ): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    Object.assign(task, { status, ...extra });
  }

  private snapshot(task: Task): Task {
    return { ...task, dependencies: [...task.dependencies] };
  }

  getTask(taskId: string): Task | undefined {
    const task = this.tasks.get(taskId);
    return task ? this.snapshot(task) : undefined;
  }

  listTasks(filter?: { status?: TaskStatus; assignedWorker?: string }): Task[] {
    return [...this.tasks.values()]
      .filter((task) => !filter?.status || task.status === filter.status)
      .filter(
        (task) =>
          !filter?.assignedWorker ||
          task.assignedWorker === filter.assignedWorker,
      )
      .map((task) => this.snapshot(task));
  }

  async waitForTask(
    taskId: string,
    timeoutMs = this.config.taskTimeout + 1000,
  ): Promise<Task> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task "${taskId}" does not exist`);
    if (isTerminal(task.status)) return this.snapshot(task);

    return new Promise<Task>((resolve, reject) => {
      const waiter: TaskWaiter = {
        resolve,
        reject,
        timer: setTimeout(
          () => {
            this.waiters.get(taskId)?.delete(waiter);
            reject(new Error(`Timed out waiting for task "${taskId}"`));
          },
          Math.max(1, timeoutMs),
        ),
      };
      const taskWaiters = this.waiters.get(taskId) ?? new Set<TaskWaiter>();
      taskWaiters.add(waiter);
      this.waiters.set(taskId, taskWaiters);
    });
  }

  private notifyWaiters(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task || !isTerminal(task.status)) return;
    const taskWaiters = this.waiters.get(taskId);
    if (!taskWaiters) return;
    this.waiters.delete(taskId);
    for (const waiter of taskWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(this.snapshot(task));
    }
  }

  getWorker(workerId: string): WorkerState | undefined {
    return this.workers.get(workerId)?.getState();
  }

  listWorkers(): WorkerState[] {
    return [...this.workers.values()].map((worker) => worker.getState());
  }

  getStats() {
    const tasks = [...this.tasks.values()];
    const workers = this.listWorkers();
    return {
      totalTasks: tasks.length,
      pendingTasks: tasks.filter(
        (task) => task.status === "pending" || task.status === "waiting",
      ).length,
      runningTasks: tasks.filter((task) => task.status === "running").length,
      completedTasks: tasks.filter((task) => task.status === "completed")
        .length,
      failedTasks: tasks.filter((task) => task.status === "failed").length,
      cancelledTasks: tasks.filter((task) => task.status === "cancelled")
        .length,
      activeWorkers: workers.filter((worker) => worker.status === "busy")
        .length,
      idleWorkers: workers.filter((worker) => worker.status === "idle").length,
    };
  }

  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || isTerminal(task.status)) return false;
    const wasRunning = task.status === "running";
    this.taskQueue = this.taskQueue.filter((id) => id !== taskId);
    this.updateTask(taskId, "cancelled", {
      completedAt: Date.now(),
      error: "Task was cancelled",
    });
    this.controllers.get(taskId)?.abort("cancelled");
    if (!wasRunning) {
      this.executors.delete(taskId);
      this.notifyWaiters(taskId);
      this.requestSchedule();
    }
    return true;
  }

  cleanup(completedOnly = true): number {
    let count = 0;
    for (const [id, task] of this.tasks) {
      const removable = completedOnly
        ? task.status === "completed"
        : isTerminal(task.status);
      if (!removable) continue;
      this.tasks.delete(id);
      this.executors.delete(id);
      this.controllers.delete(id);
      this.taskQueue = this.taskQueue.filter((taskId) => taskId !== id);
      count += 1;
    }
    return count;
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  getAgentRegistry(): AgentRegistry {
    return this.agentRegistry;
  }
}

function isTerminal(status: TaskStatus): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

export const createSwarmManager = (
  config?: Partial<SwarmConfig>,
  toolRegistry?: ToolRegistry,
  agentRegistry?: AgentRegistry,
): SwarmManager =>
  new SwarmManager(
    config ?? {},
    toolRegistry ?? new ToolRegistryClass(),
    agentRegistry ?? new AgentRegistryClass(),
  );
