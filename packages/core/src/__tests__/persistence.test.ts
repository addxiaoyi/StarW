import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Persistence, generateId } from "../persistence";
import fs from "fs";
import path from "path";
import os from "os";

describe("Persistence Layer", () => {
  let tmpDir: string;
  let persistence: Persistence;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `openstar-persist-${Date.now()}-${Math.floor(Math.random() * 10000)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    persistence = new Persistence({ dbPath: path.join(tmpDir, "test.db") });
  });

  afterEach(() => {
    persistence.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should create and retrieve a session", () => {
    const session = persistence.saveSession({
      id: generateId(),
      agent_id: "coordinator",
      status: "active",
      model: "gpt-4o",
      working_directory: "/tmp",
      metadata: "{}",
      created_at: Date.now(),
      completed_at: null,
    });

    const retrieved = persistence.getSession(session.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(session.id);
    expect(retrieved!.agent_id).toBe("coordinator");
  });

  it("should list sessions", () => {
    for (let i = 0; i < 3; i++) {
      persistence.saveSession({
        id: generateId(),
        agent_id: "a",
        status: "active",
        model: null,
        working_directory: null,
        metadata: "{}",
        created_at: Date.now(),
        completed_at: null,
      });
    }
    expect(persistence.listSessions().length).toBe(3);
  });

  it("should save and retrieve tasks", () => {
    const task = persistence.saveTask({
      id: generateId(),
      session_id: null,
      parent_task_id: null,
      title: "Test Task",
      description: "A test",
      priority: "high",
      status: "pending",
      agent_id: null,
      input: "{}",
      output: "{}",
      error: null,
      progress: 0,
      created_at: Date.now(),
      started_at: null,
      completed_at: null,
      metadata: "{}",
    });

    const retrieved = persistence.getTask(task.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.title).toBe("Test Task");
    expect(retrieved!.priority).toBe("high");
  });

  it("should save checkpoints", () => {
    const sessionId = generateId();
    persistence.saveSession({
      id: sessionId,
      agent_id: "a",
      status: "active",
      model: null,
      working_directory: null,
      metadata: "{}",
      created_at: Date.now(),
      completed_at: null,
    });

    persistence.saveCheckpoint({
      id: generateId(),
      session_id: sessionId,
      task_id: null,
      label: "checkpoint-1",
      snapshot: JSON.stringify({ state: "initial" }),
      created_at: Date.now(),
    });

    const checkpoints = persistence.getCheckpoints(sessionId);
    expect(checkpoints.length).toBe(1);
    expect(checkpoints[0].label).toBe("checkpoint-1");
  });

  it("should append and retrieve events", () => {
    const sessionId = generateId();
    persistence.saveSession({
      id: sessionId,
      agent_id: "a",
      status: "active",
      model: null,
      working_directory: null,
      metadata: "{}",
      created_at: Date.now(),
      completed_at: null,
    });

    for (let i = 0; i < 5; i++) {
      persistence.appendEvent({
        id: generateId(),
        session_id: sessionId,
        actor_id: "agent-1",
        event_type: "node_completed",
        payload: JSON.stringify({ index: i }),
        timestamp: Date.now() + i,
      });
    }

    const events = persistence.getEvents(sessionId);
    expect(events.length).toBe(5);
  });

  it("should return correct stats", () => {
    persistence.saveSession({
      id: generateId(),
      agent_id: "a",
      status: "active",
      model: null,
      working_directory: null,
      metadata: "{}",
      created_at: Date.now(),
      completed_at: null,
    });
    persistence.saveTask({
      id: generateId(),
      session_id: null,
      parent_task_id: null,
      title: "T",
      description: "D",
      priority: "normal",
      status: "completed",
      agent_id: null,
      input: "{}",
      output: "{}",
      error: null,
      progress: 100,
      created_at: Date.now(),
      started_at: null,
      completed_at: null,
      metadata: "{}",
    });

    const stats = persistence.getStats();
    expect(stats.totalSessions).toBe(1);
    expect(stats.totalTasks).toBe(1);
    expect(stats.tasksByStatus.completed).toBe(1);
  });

  it("should generate unique IDs", () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(100);
  });
});
