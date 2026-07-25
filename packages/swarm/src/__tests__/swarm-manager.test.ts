import { describe, expect, it, vi } from "vitest";
import { createSwarmManager, TaskPrioritySchema } from "../swarm-manager.js";

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

describe("SwarmManager", () => {
  it("executes submitted tasks and exposes a bounded context", async () => {
    const manager = createSwarmManager({
      maxWorkers: 1,
      maxConcurrency: 1,
      workingDirectory: "/workspace",
      environment: { NODE_ENV: "test" },
    });
    const executor = vi.fn(async (input: number, context) => {
      expect(context.workingDirectory).toBe("/workspace");
      expect(context.environment).toEqual({ NODE_ENV: "test" });
      return input * 2;
    });

    const taskId = manager.submit("double", 21, executor);
    const task = await manager.waitForTask(taskId);

    expect(task.status).toBe("completed");
    expect(task.result).toBe(42);
    expect(executor).toHaveBeenCalledOnce();
    expect(manager.getStats()).toMatchObject({ completedTasks: 1, runningTasks: 0 });
  });

  it("honors priority for queued tasks", async () => {
    const manager = createSwarmManager({ maxWorkers: 1, maxConcurrency: 1 });
    const order: string[] = [];
    let releaseFirst = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = manager.submit("first", null, async () => {
      order.push("first:start");
      await firstGate;
      order.push("first:end");
      return "first";
    });
    await delay(5);
    const low = manager.submit("low", null, async () => {
      order.push("low");
      return "low";
    }, { priority: TaskPrioritySchema.low });
    const critical = manager.submit("critical", null, async () => {
      order.push("critical");
      return "critical";
    }, { priority: TaskPrioritySchema.critical });

    releaseFirst();
    await Promise.all([manager.waitForTask(first), manager.waitForTask(low), manager.waitForTask(critical)]);
    expect(order).toEqual(["first:start", "first:end", "critical", "low"]);
  });

  it("waits for dependencies and propagates dependency failure", async () => {
    const manager = createSwarmManager({ maxWorkers: 2, maxConcurrency: 2 });
    const dependency = manager.submit("dependency", 1, async () => 2);
    const dependent = manager.submit("dependent", 3, async (input) => input + 1, { dependencies: [dependency] });
    expect((await manager.waitForTask(dependent)).result).toBe(4);

    const failed = manager.submit("failed", null, async () => {
      throw new Error("boom");
    });
    const blocked = manager.submit("blocked", null, async () => "never", { dependencies: [failed] });
    const blockedTask = await manager.waitForTask(blocked);
    expect(blockedTask.status).toBe("failed");
    expect(blockedTask.error).toMatch(/Dependency/);
  });

  it("fails timed-out tasks and returns the worker to idle", async () => {
    const manager = createSwarmManager({ maxWorkers: 1, maxConcurrency: 1, taskTimeout: 20 });
    const taskId = manager.submit("slow", null, async (_input, _context, signal) => {
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      return "late";
    });
    const task = await manager.waitForTask(taskId, 500);
    expect(task.status).toBe("failed");
    expect(task.error).toMatch(/timed out/);
    expect(manager.listWorkers()[0].status).toBe("idle");
  });

  it("cancels running tasks through AbortSignal", async () => {
    const manager = createSwarmManager({ maxWorkers: 1, maxConcurrency: 1, taskTimeout: 1000 });
    const taskId = manager.submit("cancel", null, async (_input, _context, signal) => {
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      return "ignored";
    });
    await delay(5);
    expect(manager.cancelTask(taskId)).toBe(true);
    const task = await manager.waitForTask(taskId);
    expect(task.status).toBe("cancelled");
    await delay(5);
    expect(manager.listWorkers()[0].status).toBe("idle");
  });
});
