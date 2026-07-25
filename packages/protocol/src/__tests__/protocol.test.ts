import { describe, it, expect } from "vitest";
import { createMessage, createActivityEvent } from "../messages";
import { validate, AgentMessageSchema, TaskPayloadSchema } from "../validation";

describe("Protocol Message", () => {
  it("should create a valid agent message", () => {
    const msg = createMessage("task", "agent-1", "agent-2", { taskId: "123" });
    expect(msg.type).toBe("task");
    expect(msg.from).toBe("agent-1");
    expect(msg.to).toBe("agent-2");
    expect(msg.timestamp).toBeGreaterThan(0);
  });

  it("should create an activity event with sequence", () => {
    const event = createActivityEvent("session-1", "actor-1", "node_completed", { node: "a" }, 5);
    expect(event.sessionId).toBe("session-1");
    expect(event.actorId).toBe("actor-1");
    expect(event.eventType).toBe("node_completed");
    expect(event.sequence).toBe(5);
  });
});

describe("Protocol Validation", () => {
  it("should validate valid agent message", () => {
    const msg = createMessage("status", "a", "b", {});
    const result = validate(AgentMessageSchema, msg);
    expect(result.success).toBe(true);
  });

  it("should reject invalid agent message", () => {
    const result = validate(AgentMessageSchema, { type: "invalid", from: "a" });
    expect(result.success).toBe(false);
  });

  it("should validate task payload", () => {
    const result = validate(TaskPayloadSchema, {
      taskId: "t1",
      title: "Test",
      description: "Desc",
    });
    expect(result.success).toBe(true);
  });

  it("should reject task payload with bad priority", () => {
    const result = validate(TaskPayloadSchema, {
      taskId: "t1",
      title: "Test",
      description: "Desc",
      priority: "super",
    });
    expect(result.success).toBe(false);
  });
});
