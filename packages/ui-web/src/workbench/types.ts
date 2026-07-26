/**
 * Workbench 核心类型定义
 * 终端工作台的状态和接口类型
 * 注意：TerminalSession, WorkbenchState, SessionHealth 定义在 model.ts
 */

// 工作台模式
export type WorkbenchMode =
  | "terminal"
  | "chat"
  | "files"
  | "agents"
  | "skills"
  | "mcp"
  | "browser"
  | "settings";

// 检查器模式
export type InspectorMode = "agents" | "skills" | "mcp";

// 命令块状态
export type BlockStatus = "running" | "success" | "error";

// 命令块
export interface CommandBlock {
  id: string;
  command: string;
  output: string;
  cwd: string;
  status: BlockStatus;
  durationMs?: number;
}

// 运行时快照
export type RuntimePhase = "loading" | "ready" | "preview" | "error";

export interface StarCoreStatus {
  core: string;
  version: string;
  agentsActive: number;
  skillsLoaded: number;
  mcpsConnected: number;
  workspace?: string;
  branch?: string;
  platform?: string;
  selectedProvider?: string;
  providers?: Record<string, boolean>;
  swarm?: Record<string, unknown>;
}

export interface StarCoreSkill {
  name: string;
  description: string;
  enabled: boolean;
  category?: string;
}

export interface StarCoreAgent {
  name: string;
  status: "running" | "idle" | "error" | "available";
  tasks: number;
  description?: string;
  memory?: string;
  role?: string;
}

export interface StarCoreMcpStatus {
  connected: number;
  total: number;
  available?: boolean;
  servers: Array<{
    id?: string;
    name: string;
    status: string;
    toolCount?: number;
    error?: string;
  }>;
}

export interface RuntimeSnapshot {
  phase: RuntimePhase;
  status?: StarCoreStatus;
  skills: StarCoreSkill[];
  agents: StarCoreAgent[];
  mcp?: StarCoreMcpStatus;
  error?: string;
}

// 导航项
export interface NavItem {
  id: WorkbenchMode;
  label: string;
  icon: string;
}

// 命令面板动作
export interface PaletteAction {
  id: string;
  label: string;
  detail: string;
  icon: string;
  category: string;
  keywords?: string[];
  keybind?: string;
  run: () => void;
}

// 命令执行结果
export interface CommandResult {
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}
