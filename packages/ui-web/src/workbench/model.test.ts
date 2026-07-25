import { describe, expect, test } from "vitest";
import {
  addTerminalSession,
  closeTerminalSession,
  createWorkbench,
  selectTerminalSession,
} from "./model";

describe("workbench session model", () => {
  test("starts with one selected terminal session", () => {
    const state = createWorkbench(100);

    expect(state.sessions).toHaveLength(1);
    expect(state.activeSessionId).toBe("terminal-100");
    expect(state.sessions[0].cwd).toBe(".");
    expect(state.sessions[0].branch).toBe("");
  });

  test("adds and selects a new terminal without mutating the old state", () => {
    const state = createWorkbench(100);
    const next = addTerminalSession(state, 200);

    expect(state.sessions).toHaveLength(1);
    expect(next.sessions).toHaveLength(2);
    expect(next.activeSessionId).toBe("terminal-200");
    expect(next.sessions[1].title).toBe("Terminal 2");
  });

  test("selects an existing session and ignores an unknown id", () => {
    const state = addTerminalSession(createWorkbench(100), 200);

    expect(selectTerminalSession(state, "terminal-100").activeSessionId).toBe(
      "terminal-100",
    );
    expect(selectTerminalSession(state, "missing")).toBe(state);
  });

  test("closing the active session selects its nearest sibling", () => {
    const state = addTerminalSession(createWorkbench(100), 200);
    const next = closeTerminalSession(state, "terminal-200", 300);

    expect(next.sessions.map((session) => session.id)).toEqual([
      "terminal-100",
    ]);
    expect(next.activeSessionId).toBe("terminal-100");
  });

  test("closing the final session immediately creates a clean replacement", () => {
    const next = closeTerminalSession(
      createWorkbench(100),
      "terminal-100",
      300,
    );

    expect(next.sessions).toHaveLength(1);
    expect(next.activeSessionId).toBe("terminal-300");
  });
});
