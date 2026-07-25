/**
 * OpenStar ACP - Agent Client Protocol
 *
 * Enables embedding OpenStar agents into editors and IDEs.
 * Inspired by Grok Build's ACP for editor integration.
 */

export interface AcpConfig {
  editor?: "vscode" | "cursor" | "windsurf" | "custom";
  port?: number;
  authToken?: string;
}

export interface AcpRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface AcpResponse {
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

export type AcpHandler = (params: Record<string, unknown>) => Promise<unknown>;

export class AcpServer {
  private handlers = new Map<string, AcpHandler>();
  private config: AcpConfig;

  constructor(config: AcpConfig = {}) {
    this.config = { port: 9876, ...config };
  }

  register(method: string, handler: AcpHandler): void {
    this.handlers.set(method, handler);
  }

  async handle(request: AcpRequest): Promise<AcpResponse> {
    const handler = this.handlers.get(request.method);
    if (!handler) {
      return { id: request.id, error: { code: -32601, message: `Method not found: ${request.method}` } };
    }
    try {
      const result = await handler(request.params);
      return { id: request.id, result };
    } catch (err) {
      return { id: request.id, error: { code: -32603, message: err instanceof Error ? err.message : String(err) } };
    }
  }

  // Standard agent methods
  initialize(params: Record<string, unknown>): Promise<unknown> {
    return this.handle({ id: "init", method: "initialize", params });
  }

  async executeTask(task: string, context?: Record<string, unknown>): Promise<unknown> {
    return this.handle({ id: `task_${Date.now()}`, method: "agent/execute", params: { task, context } });
  }

  async getStatus(): Promise<unknown> {
    return this.handle({ id: "status", method: "agent/status", params: {} });
  }
}

export { AcpServer as default };
