/**
 * StarCore Session - 基于 Effect 的会话管理
 * 参考 opencode 的 Session 设计，实现可追溯的对话历史
 */

import { ulid } from "ulid"

// ============= 类型定义 =============

/**
 * 消息角色
 */
export type MessageRole = "user" | "assistant" | "system" | "tool"

/**
 * 消息内容
 */
export interface MessageContent {
  readonly role: MessageRole
  readonly content: string
  readonly timestamp: number
  readonly metadata?: Record<string, unknown>
}

/**
 * 会话配置
 */
export interface SessionConfig {
  readonly agentId?: string
  readonly model?: string
  readonly temperature?: number
  readonly maxTokens?: number
  readonly systemPrompt?: string
  readonly workingDirectory?: string
}

/**
 * 会话状态
 */
export interface Session {
  readonly id: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly config: SessionConfig
  readonly messages: MessageContent[]
  readonly metadata: Record<string, unknown>
}

// ============= Session Manager =============

/**
 * 会话管理器
 */
export class SessionManager {
  private sessions: Map<string, Session> = new Map()
  private activeSessionId: string | null = null

  constructor() {}

  /**
   * 创建新会话
   */
  create(config: SessionConfig = {}): Session {
    const id = ulid()
    const now = Date.now()

    const session: Session = {
      id,
      createdAt: now,
      updatedAt: now,
      config,
      messages: [],
      metadata: {},
    }

    this.sessions.set(id, session)
    this.activeSessionId = id

    return session
  }

  /**
   * 获取会话
   */
  get(id: string): Session | undefined {
    return this.sessions.get(id)
  }

  /**
   * 获取当前活动会话
   */
  getActive(): Session | undefined {
    if (!this.activeSessionId) return undefined
    return this.sessions.get(this.activeSessionId)
  }

  /**
   * 设置活动会话
   */
  setActive(id: string): boolean {
    if (!this.sessions.has(id)) return false
    this.activeSessionId = id
    return true
  }

  /**
   * 添加消息
   */
  addMessage(
    sessionId: string,
    role: MessageRole,
    content: string,
    metadata?: Record<string, unknown>
  ): Session | undefined {
    const session = this.sessions.get(sessionId)
    if (!session) return undefined

    const message: MessageContent = {
      role,
      content,
      timestamp: Date.now(),
      metadata,
    }

    const updated: Session = {
      ...session,
      updatedAt: Date.now(),
      messages: [...session.messages, message],
    }

    this.sessions.set(sessionId, updated)
    return updated
  }

  /**
   * 获取消息历史
   */
  getHistory(sessionId: string, limit?: number): MessageContent[] {
    const session = this.sessions.get(sessionId)
    if (!session) return []

    const messages = session.messages
    if (limit && limit > 0) {
      return messages.slice(-limit)
    }
    return messages
  }

  /**
   * 清空消息历史
   */
  clearHistory(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false

    this.sessions.set(sessionId, {
      ...session,
      updatedAt: Date.now(),
      messages: [],
    })
    return true
  }

  /**
   * 删除会话
   */
  delete(id: string): boolean {
    const deleted = this.sessions.delete(id)
    if (this.activeSessionId === id) {
      this.activeSessionId = null
    }
    return deleted
  }

  /**
   * 列出所有会话
   */
  list(): Session[] {
    return Array.from(this.sessions.values())
  }

  /**
   * 获取会话数量
   */
  size(): number {
    return this.sessions.size
  }

  /**
   * 更新会话元数据
   */
  setMetadata(sessionId: string, key: string, value: unknown): Session | undefined {
    const session = this.sessions.get(sessionId)
    if (!session) return undefined

    const updated: Session = {
      ...session,
      updatedAt: Date.now(),
      metadata: { ...session.metadata, [key]: value },
    }

    this.sessions.set(sessionId, updated)
    return updated
  }

  /**
   * 清理旧会话
   */
  cleanup(maxAge: number = 86400000): number {
    const now = Date.now()
    let cleaned = 0

    for (const [id, session] of this.sessions) {
      if (now - session.updatedAt > maxAge) {
        this.sessions.delete(id)
        cleaned++
      }
    }

    if (this.activeSessionId && !this.sessions.has(this.activeSessionId)) {
      this.activeSessionId = null
    }

    return cleaned
  }
}

// ============= 工厂函数 =============

/**
 * 创建会话管理器
 */
export const createSessionManager = (): SessionManager => {
  return new SessionManager()
}
