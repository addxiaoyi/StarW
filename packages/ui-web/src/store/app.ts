import { createSignal, createEffect } from "solid-js";
import type { AppState, ViewMode, Session, Message } from "../types";

export interface Toast {
  id: string;
  type: "success" | "error" | "info" | "warning";
  title: string;
  message?: string;
  duration?: number;
}

const [toasts, setToasts] = createSignal<Toast[]>([]);

export function addToast(toast: Omit<Toast, "id">): string {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const item: Toast = { ...toast, id };
  setToasts((prev) => [...prev, item]);
  if (toast.duration !== 0) {
    const duration = toast.duration ?? 4000;
    setTimeout(() => removeToast(id), duration);
  }
  return id;
}

export function removeToast(id: string) {
  setToasts((prev) => prev.filter((t) => t.id !== id));
}

export const toast = {
  success: (title: string, message?: string, duration?: number) =>
    addToast({ type: "success", title, message, duration }),
  error: (title: string, message?: string, duration?: number) =>
    addToast({ type: "error", title, message, duration }),
  info: (title: string, message?: string, duration?: number) =>
    addToast({ type: "info", title, message, duration }),
  warning: (title: string, message?: string, duration?: number) =>
    addToast({ type: "warning", title, message, duration }),
};

function loadJSON<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    // ignore
  }
  return defaultValue;
}

function saveJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

const defaultAppState: AppState = {
  currentMode: "chat",
  sidebarCollapsed: false,
  theme: "dark",
  accentColor: "violet",
  activeSessionId: null,
  paletteOpen: false,
  paletteQuery: "",
};

const [appState, setAppState] = createSignal<AppState>({
  ...defaultAppState,
  ...loadJSON<Partial<AppState>>("openstar-app-state", {}),
});

const [sessions, setSessions] = createSignal<Session[]>(loadJSON("openstar-sessions", []));

const [activeSession, setActiveSession] = createSignal<Session | null>(null);

createEffect(() => {
  const { paletteOpen, paletteQuery, ...persisted } = appState();
  saveJSON("openstar-app-state", persisted);
});

createEffect(() => {
  saveJSON("openstar-sessions", sessions());
});

createEffect(() => {
  const theme = appState().theme;
  if (theme === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
});

function setMode(mode: ViewMode) {
  setAppState((prev) => ({ ...prev, currentMode: mode }));
}

function openPalette(query: string = "") {
  setAppState((prev) => ({ ...prev, paletteOpen: true, paletteQuery: query }));
}

function closePalette() {
  setAppState((prev) => ({ ...prev, paletteOpen: false, paletteQuery: "" }));
}

function toggleSidebar() {
  setAppState((prev) => ({ ...prev, sidebarCollapsed: !prev.sidebarCollapsed }));
}

function toggleTheme() {
  setAppState((prev) => ({
    ...prev,
    theme: prev.theme === "dark" ? "light" : "dark",
  }));
}

function createSession(): Session {
  const now = Date.now();
  const session: Session = {
    id: `session-${now}`,
    title: "新会话",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };

  setSessions((prev) => [session, ...prev]);
  setAppState((prev) => ({ ...prev, activeSessionId: session.id }));
  setActiveSession(session);

  return session;
}

function selectSession(id: string) {
  const session = sessions().find((s) => s.id === id);
  if (session) {
    setActiveSession(session);
    setAppState((prev) => ({ ...prev, activeSessionId: id }));
  }
}

function addMessage(sessionId: string, message: Omit<Message, "id" | "timestamp">) {
  const newMessage: Message = {
    ...message,
    id: `msg-${Date.now()}`,
    timestamp: Date.now(),
  };

  setSessions((prev: Session[]) =>
    prev.map((s) =>
      s.id === sessionId
        ? { ...s, messages: [...s.messages, newMessage], updatedAt: Date.now() }
        : s,
    ),
  );

  if (activeSession()?.id === sessionId) {
    setActiveSession((prev: Session | null) =>
      prev
        ? {
            ...prev,
            messages: [...prev.messages, newMessage],
            updatedAt: Date.now(),
          }
        : null,
    );
  }

  return newMessage;
}

function updateMessage(sessionId: string, messageId: string, updates: Partial<Message>) {
  setSessions((prev: Session[]) =>
    prev.map((s) =>
      s.id === sessionId
        ? {
            ...s,
            messages: s.messages.map((m: Message) =>
              m.id === messageId ? { ...m, ...updates } : m,
            ),
          }
        : s,
    ),
  );

  if (activeSession()?.id === sessionId) {
    setActiveSession((prev: Session | null) =>
      prev
        ? {
            ...prev,
            messages: prev.messages.map((m: Message) =>
              m.id === messageId ? { ...m, ...updates } : m,
            ),
          }
        : null,
    );
  }
}

function deleteSession(id: string) {
  setSessions((prev) => prev.filter((s) => s.id !== id));
  if (activeSession()?.id === id) {
    const remaining = sessions().filter((s) => s.id !== id);
    if (remaining.length > 0) {
      selectSession(remaining[0].id);
    } else {
      setActiveSession(null);
      setAppState((prev) => ({ ...prev, activeSessionId: null }));
    }
  }
}

function setSessionAcpId(sessionId: string, acpSessionId: string) {
  setSessions((prev: Session[]) =>
    prev.map((s) => (s.id === sessionId ? { ...s, acpSessionId } : s)),
  );

  if (activeSession()?.id === sessionId) {
    setActiveSession((prev: Session | null) =>
      prev ? { ...prev, acpSessionId } : null,
    );
  }
}

function updateSessionTitle(sessionId: string, title: string) {
  setSessions((prev: Session[]) =>
    prev.map((s) => (s.id === sessionId ? { ...s, title, updatedAt: Date.now() } : s)),
  );

  if (activeSession()?.id === sessionId) {
    setActiveSession((prev: Session | null) =>
      prev ? { ...prev, title, updatedAt: Date.now() } : null,
    );
  }
}

export function useAppStore() {
  return {
    state: appState,
    setState: setAppState,
    sessions,
    activeSession,
    setMode,
    openPalette,
    closePalette,
    toggleSidebar,
    toggleTheme,
    createSession,
    selectSession,
    addMessage,
    updateMessage,
    deleteSession,
    setSessionAcpId,
    updateSessionTitle,
    toasts,
    addToast,
    removeToast,
    toast,
  };
}
