/**
 * OpenStar 错误码规范
 * 遵循 JSON-RPC 2.0 扩展码惯例：-32xxx 为 OpenStar 业务错误
 */

export const ErrorCode = {
  // JSON-RPC 标准错误
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  // OpenStar 业务错误（-32xxx）
  SESSION_NOT_FOUND: -32001,
  SESSION_DUPLICATE: -32002,
  SESSION_LIMIT_EXCEEDED: -32003,
  MODEL_NOT_FOUND: -32004,
  MODEL_UNAVAILABLE: -32005,
  TOOL_NOT_FOUND: -32006,
  TOOL_EXECUTION_FAILED: -32007,
  SKILL_NOT_FOUND: -32008,
  SKILL_EXECUTION_FAILED: -32009,
  AGENT_NOT_FOUND: -32010,
  AGENT_CRASHED: -32011,
  MCP_SERVER_NOT_FOUND: -32012,
  MCP_SERVER_ERROR: -32013,
  PERMISSION_DENIED: -32014,
  RATE_LIMITED: -32015,
  TIMEOUT: -32016,
  CHANNEL_CLOSED: -32017,
  INVALID_STATE: -32018,
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

export interface ProtocolError {
  code: ErrorCode
  message: string
  data?: unknown
}

export function createError(
  code: ErrorCode,
  message: string,
  data?: unknown
): ProtocolError {
  return { code, message, data }
}

export function isProtocolError(obj: unknown): obj is ProtocolError {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "code" in obj &&
    "message" in obj
  )
}
