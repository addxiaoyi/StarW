export {};

declare global {
  interface DesktopEventEnvelope {
    event: string;
    payload: unknown;
  }

  interface StarCoreBridge {
    request<T = unknown>(
      method: string,
      params?: Record<string, unknown>,
      timeoutMs?: number,
    ): Promise<T>;
    onEvent(callback: (message: DesktopEventEnvelope) => void): () => void;
    chooseWorkspace(): Promise<string | null>;
    openExternal(url: string): Promise<boolean>;
    getStatus(): Promise<Record<string, unknown>>;
    listSkills(): Promise<Array<Record<string, unknown>>>;
    listAgents(): Promise<Array<Record<string, unknown>>>;
    getMCPStatus(): Promise<Record<string, unknown>>;
    getTheme(): Promise<"dark" | "light">;
    setTheme(theme: "dark" | "light" | "system"): void;
    onThemeChanged(callback: (theme: "dark" | "light") => void): () => void;
    onError(callback: (message: string) => void): () => void;
    onSettingsOpen(callback: () => void): () => void;
    minimize(): void;
    maximize(): void;
    close(): void;
    quit(): void;
  }

  interface Window {
    starcore?: StarCoreBridge;
    openstar?: StarCoreBridge;
  }
}
