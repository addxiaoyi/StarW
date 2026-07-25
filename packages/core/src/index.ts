export * from "./types/agent";
export * from "./types/session";
export * from "./types/skill";
export * from "./types/mcp";
export * from "./types/message";
export * from "./config";
export * from "./id";
export * as tools from "./tools";
export * from "./skills/discovery";
export * from "./skills/registry";
export * from "./rules/rule_engine";
export * from "./adapters/ecc";

// 新增：系统核心模块 (基于 opencode 架构)
// 使用 selective export 避免类型冲突
export { SystemContext, makeContextSource } from "./system/context";
export type {
  ContextSnapshot,
  ContextSource,
  ContextEpoch,
  ContextSourceKey,
} from "./system/context";

export { AgentRegistry, createAgentRegistry } from "./system/agent";
export type { AgentConfig } from "./system/agent";
export {
  AgentRunAbortedError,
  EmbeddedAgentRuntime,
} from "./system/agent-runtime";
export type {
  AgentModelResponse,
  AgentRunResult,
  AgentRuntimeEvent,
  AgentRuntimeMessage,
  AgentToolCall,
  AgentToolExecutionResult,
} from "./system/agent-runtime";
export { ToolRegistry, initializeDefaultTools } from "./system/tool-registry";
export type { Tool, ToolContext, ToolResult } from "./system/tool-registry";
export { SessionManager } from "./system/session";
export type { Session, SessionConfig } from "./system/session";
export { zodToJsonSchema } from "./system/schema";
export { StarCore } from "./system/starcore";

// 新增：持久化、沙箱、插件系统
export { Persistence, initPersistence, getPersistence } from "./persistence";
export type {
  PersistenceConfig,
  StoredSession,
  StoredTask,
  StoredCheckpoint,
  StoredEvent,
} from "./persistence";
export * from "./sandbox";
export * from "./plugins";
