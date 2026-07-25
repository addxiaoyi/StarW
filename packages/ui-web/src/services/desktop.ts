export interface DesktopEventEnvelope {
  event: string;
  payload: unknown;
}

export function hasDesktopBridge(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.starcore?.request === "function"
  );
}

export async function desktopRequest<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs?: number,
): Promise<T> {
  if (!hasDesktopBridge())
    throw new Error("OpenStar desktop bridge is unavailable");
  return window.starcore!.request<T>(method, params, timeoutMs);
}

export function subscribeDesktopEvent(
  callback: (event: string, payload: unknown) => void,
): () => void {
  if (!hasDesktopBridge() || !window.starcore?.onEvent) return () => {};
  return window.starcore.onEvent((message) =>
    callback(message.event, message.payload),
  );
}

export async function chooseWorkspace(): Promise<string | null> {
  if (!hasDesktopBridge() || !window.starcore?.chooseWorkspace) {
    throw new Error(
      "Workspace picker is available only in the desktop application",
    );
  }
  return window.starcore.chooseWorkspace();
}

export async function openExternal(url: string): Promise<boolean> {
  if (!hasDesktopBridge() || !window.starcore?.openExternal) {
    throw new Error("External browser integration is unavailable");
  }
  return window.starcore.openExternal(url);
}
