import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";

import { Persistence } from "../persistence/index.js";

describe("Persistence integration", () => {
  let p: Persistence;
  const dbPath = `./.tmp-test-state-${Date.now()}.db`;

  beforeAll(() => {
    p = new Persistence({ dbPath });
  });

  afterAll(() => {
    try {
      p.close();
    } catch {
      /* ignore */
    }
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
  });

  it("round-trips a session", () => {
    p.saveSession({
      id: "s1",
      agent_id: "a",
      status: "active",
      model: "gpt",
      working_directory: null,
      metadata: "{}",
      created_at: Date.now(),
      completed_at: null,
    });
    const s = p.getSession("s1");
    expect(s).not.toBeNull();
    expect(s!.agent_id).toBe("a");
  });

  it("records tasks and reports stats", () => {
    p.saveTask({
      id: "t1",
      session_id: "s1",
      parent_task_id: null,
      title: "Task",
      description: "",
      priority: "normal",
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
    const stats = p.getStats();
    expect(stats.totalSessions).toBe(1);
    expect(stats.totalTasks).toBe(1);
  });

  it("appends events to the activity journal", () => {
    p.appendEvent({
      id: "e1",
      session_id: "s1",
      actor_id: "tester",
      event_type: "task.created",
      payload: "{}",
      timestamp: Date.now(),
    });
    const events = p.getEvents("s1");
    expect(events.length).toBe(1);
    expect(events[0].event_type).toBe("task.created");
  });
});
