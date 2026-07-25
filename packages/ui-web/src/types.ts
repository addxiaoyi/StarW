export type ViewMode = "chat" | "terminal" | "canvas" | "browser" | "swarm" | "templates" | "marketplace" | "files" | "settings";

export interface AppState {
  currentMode: ViewMode;
  sidebarCollapsed: boolean;
  theme: "dark" | "light";
  accentColor: string;
  activeSessionId: string | null;
  paletteOpen: boolean;
  paletteQuery: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  status?: "sending" | "streaming" | "done" | "error";
}

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  acpSessionId?: string;
}
