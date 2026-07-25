import { hasDesktopBridge } from "./desktop";

const ACP_BASE_URL = "http://127.0.0.1:3456/acp";

let requestId = 0;
let connected = hasDesktopBridge();
let lastErrorAt = 0;

export function isAcpConnected(): boolean {
  return connected;
}

export function onAcpConnectionChange(
  callback: (connected: boolean) => void,
): () => void {
  const handler = () => callback(connected);
  if (typeof window === "undefined") return () => {};
  window.addEventListener("acp-connection-change", handler);
  return () => window.removeEventListener("acp-connection-change", handler);
}

function setAcpConnection(next: boolean) {
  if (connected === next) return;
  connected = next;
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("acp-connection-change", { detail: next }),
    );
  }
}

export interface AcpSkillItem {
  id: string;
  name: string;
  version?: string;
  description: string;
  tags?: string[];
  author?: string;
  entryPoint?: string;
  type: "skill" | "command" | "agent";
  capabilities?: string[];
}

export interface AcpExecuteResult {
  task_id: string;
  success: boolean;
  output: Record<string, unknown>;
  error?: string;
  duration_ms: number;
}

export interface AcpSession {
  id: string;
  name: string;
  created_at: number;
  updated_at?: number;
}

export interface AcpMessageContent {
  type: "text";
  text?: string;
}

export interface AcpMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: AcpMessageContent[];
  created_at?: number;
}

export async function acpRequest(
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  if (hasDesktopBridge()) {
    try {
      const result = await window.starcore!.request(method, params);
      setAcpConnection(true);
      return result;
    } catch (error) {
      setAcpConnection(false);
      throw error;
    }
  }

  const id = ++requestId;
  if (!connected && Date.now() - lastErrorAt < 5000) {
    throw new Error("ACP backend unavailable");
  }
  try {
    const response = await fetch(ACP_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ACP-Connection": "ui-web",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      }),
    });

    setAcpConnection(true);

    if (!response.ok) {
      throw new Error(
        `ACP request failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      jsonrpc: string;
      id?: number;
      result?: unknown;
      error?: { code: number; message: string; data?: unknown };
    };

    if (data.error) {
      throw new Error(data.error.message);
    }

    return data.result;
  } catch (error) {
    const now = Date.now();
    // only log connection errors once per 5s to avoid console spam
    if (now - lastErrorAt > 5000) {
      lastErrorAt = now;
      // eslint-disable-next-line no-console
      console.warn("OpenStar backend unavailable.", error);
    }
    setAcpConnection(false);
    throw error;
  }
}

export interface FileEntry {
  name: string;
  type: "file" | "directory";
  path: string;
}

export async function listSkills(): Promise<{
  skills: AcpSkillItem[];
  agents: AcpSkillItem[];
}> {
  try {
    const result = (await acpRequest("skills/list")) as {
      skills: AcpSkillItem[];
      agents: AcpSkillItem[];
    };
    return result;
  } catch {
    return { skills: [], agents: [] };
  }
}

export async function executeSkill(
  skillId: string,
  input: Record<string, unknown> = {},
): Promise<AcpExecuteResult> {
  return (await acpRequest("skills/execute", {
    skill_id: skillId,
    input,
  })) as AcpExecuteResult;
}

export async function suggestTerminalCommand(prompt: string): Promise<string> {
  const result = (await acpRequest("terminal/suggest", { prompt })) as {
    command: string;
  };
  return result.command;
}

export async function listFiles(path = "."): Promise<FileEntry[]> {
  try {
    const result = (await acpRequest("files/list", { path })) as {
      entries: FileEntry[];
    };
    return result.entries;
  } catch {
    return [];
  }
}

export async function readFile(path: string): Promise<string> {
  const result = (await acpRequest("files/read", { path })) as {
    content: string;
  };
  return result.content;
}

export async function getConfig(): Promise<Record<string, unknown>> {
  try {
    return (await acpRequest("config/get")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function setConfig(
  updates: Record<string, unknown>,
): Promise<void> {
  await acpRequest("config/set", updates);
}

export async function listRegistrySkills(): Promise<AcpSkillItem[]> {
  try {
    const result = (await acpRequest("registry/skills")) as {
      skills: AcpSkillItem[];
    };
    return result.skills;
  } catch {
    return [];
  }
}

export async function listRegistryCommands(): Promise<AcpSkillItem[]> {
  try {
    const result = (await acpRequest("registry/commands")) as {
      commands: AcpSkillItem[];
    };
    return result.commands;
  } catch {
    return [];
  }
}

export async function listRegistryAgents(): Promise<AcpSkillItem[]> {
  try {
    const result = (await acpRequest("registry/agents")) as {
      agents: AcpSkillItem[];
    };
    return result.agents;
  } catch {
    return [];
  }
}
