import { generateId, generateSessionId, generateMessageId } from "@openstar/core";
import type { AcpSession, AcpMessage } from "./types";

export class AcpSessionManager {
  private sessions: Map<string, AcpSession> = new Map();
  private messages: Map<string, AcpMessage[]> = new Map();
  private activePrompts: Map<string, AbortController> = new Map();

  createSession(name: string = "New Session"): AcpSession {
    const id = generateSessionId();
    const now = Date.now();

    const session: AcpSession = {
      id,
      name,
      created_at: now,
      updated_at: now,
      message_count: 0,
    };

    this.sessions.set(id, session);
    this.messages.set(id, []);

    return session;
  }

  getSession(id: string): AcpSession | undefined {
    return this.sessions.get(id);
  }

  listSessions(): AcpSession[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) => b.updated_at - a.updated_at
    );
  }

  deleteSession(id: string): boolean {
    if (!this.sessions.has(id)) return false;

    this.cancelPrompt(id);
    this.sessions.delete(id);
    this.messages.delete(id);
    return true;
  }

  renameSession(id: string, newName: string): AcpSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;

    session.name = newName;
    session.updated_at = Date.now();
    return session;
  }

  loadSession(id: string): { session: AcpSession; messages: AcpMessage[] } | null {
    const session = this.sessions.get(id);
    if (!session) return null;

    const messages = this.messages.get(id) || [];
    return { session, messages };
  }

  addMessage(sessionId: string, message: Omit<AcpMessage, "id" | "created_at">): AcpMessage | null {
    const session = this.sessions.get(sessionId);
    const sessionMessages = this.messages.get(sessionId);
    if (!session || !sessionMessages) return null;

    const fullMessage: AcpMessage = {
      ...message,
      id: generateMessageId(),
      created_at: Date.now(),
    };

    sessionMessages.push(fullMessage);
    session.message_count = sessionMessages.length;
    session.updated_at = Date.now();

    return fullMessage;
  }

  listMessages(sessionId: string, limit?: number, before?: string): AcpMessage[] | null {
    const sessionMessages = this.messages.get(sessionId);
    if (!sessionMessages) return null;

    let result = [...sessionMessages];

    if (before) {
      const index = result.findIndex((m) => m.id === before);
      if (index >= 0) {
        result = result.slice(0, index);
      }
    }

    if (limit && limit > 0) {
      result = result.slice(-limit);
    }

    return result;
  }

  startPrompt(sessionId: string): AbortController | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const controller = new AbortController();
    this.activePrompts.set(sessionId, controller);
    session.updated_at = Date.now();

    return controller;
  }

  cancelPrompt(sessionId: string): boolean {
    const controller = this.activePrompts.get(sessionId);
    if (!controller) return false;

    controller.abort();
    this.activePrompts.delete(sessionId);
    return true;
  }

  finishPrompt(sessionId: string): void {
    this.activePrompts.delete(sessionId);
    const session = this.sessions.get(sessionId);
    if (session) {
      session.updated_at = Date.now();
    }
  }

  isPromptActive(sessionId: string): boolean {
    return this.activePrompts.has(sessionId);
  }

  getStats() {
    return {
      totalSessions: this.sessions.size,
      activePrompts: this.activePrompts.size,
    };
  }
}

export const acpSessionManager = new AcpSessionManager();
