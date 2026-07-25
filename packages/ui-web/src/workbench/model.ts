export type SessionHealth = "ready" | "busy" | "error";

export interface TerminalSession {
  id: string;
  title: string;
  cwd: string;
  branch: string;
  health: SessionHealth;
  createdAt: number;
  updatedAt: number;
}

export interface WorkbenchState {
  sessions: TerminalSession[];
  activeSessionId: string;
}

function makeSession(
  now: number,
  position: number,
  cwd = ".",
  branch = "",
): TerminalSession {
  return {
    id: `terminal-${now}`,
    title: position === 1 ? "OpenStar" : `Terminal ${position}`,
    cwd,
    branch,
    health: "ready",
    createdAt: now,
    updatedAt: now,
  };
}

export function createWorkbench(
  now = Date.now(),
  cwd = ".",
  branch = "",
): WorkbenchState {
  const session = makeSession(now, 1, cwd, branch);
  return { sessions: [session], activeSessionId: session.id };
}

export function addTerminalSession(
  state: WorkbenchState,
  now = Date.now(),
  cwd = state.sessions[0]?.cwd || ".",
  branch = state.sessions[0]?.branch || "",
): WorkbenchState {
  const session = makeSession(now, state.sessions.length + 1, cwd, branch);
  return {
    sessions: [...state.sessions, session],
    activeSessionId: session.id,
  };
}

export function selectTerminalSession(
  state: WorkbenchState,
  id: string,
): WorkbenchState {
  const exists = state.sessions.some((session) => session.id === id);
  if (!exists || state.activeSessionId === id) return state;
  return { ...state, activeSessionId: id };
}

export function closeTerminalSession(
  state: WorkbenchState,
  id: string,
  now = Date.now(),
): WorkbenchState {
  const index = state.sessions.findIndex((session) => session.id === id);
  if (index === -1) return state;

  const sessions = state.sessions.filter((session) => session.id !== id);
  if (sessions.length === 0) return createWorkbench(now);
  if (state.activeSessionId !== id) return { ...state, sessions };

  const active = sessions[Math.min(index, sessions.length - 1)];
  return { sessions, activeSessionId: active.id };
}
