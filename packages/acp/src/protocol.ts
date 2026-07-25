import { AcpServer } from "./server";
import type { AcpRequest, AcpResponse, AcpEvent } from "./types";

export interface AcpTransport {
  start(): Promise<void>;
  stop(): Promise<void>;
  onRequest(handler: (request: AcpRequest, connectionId: string) => Promise<AcpResponse>): void;
  sendEvent(connectionId: string, event: AcpEvent): void;
}

export class StdioTransport implements AcpTransport {
  private server: AcpServer;
  private connectionId: string;
  private requestHandler: ((request: AcpRequest, connectionId: string) => Promise<AcpResponse>) | null = null;
  private running = false;

  constructor(server: AcpServer, connectionId: string = "stdio") {
    this.server = server;
    this.connectionId = connectionId;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    this.server.connect(this.connectionId);
    this.server.addEventListener(this.connectionId, (event) => {
      this.sendEvent(this.connectionId, event);
    });

    process.stdin.setEncoding("utf-8");

    let buffer = "";
    process.stdin.on("data", (data: string) => {
      buffer += data;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        this.handleLine(trimmed).catch((err) => {
          console.error("Error handling request:", err);
        });
      }
    });

    process.stdin.on("close", () => {
      this.stop();
    });
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.server.disconnect(this.connectionId);
  }

  onRequest(handler: (request: AcpRequest, connectionId: string) => Promise<AcpResponse>): void {
    this.requestHandler = handler;
  }

  sendEvent(connectionId: string, event: AcpEvent): void {
    if (!this.running) return;
    process.stdout.write(JSON.stringify(event) + "\n");
  }

  private async handleLine(line: string): Promise<void> {
    try {
      const request = JSON.parse(line) as AcpRequest;

      if (!request.jsonrpc || !request.method || request.id === undefined) {
        return;
      }

      let response: AcpResponse;

      if (this.requestHandler) {
        response = await this.requestHandler(request, this.connectionId);
      } else {
        response = await this.server.handleRequest(this.connectionId, request);
      }

      process.stdout.write(JSON.stringify(response) + "\n");
    } catch (err) {
      // ignore parse errors for malformed lines
    }
  }
}

export class HttpTransport implements AcpTransport {
  private server: AcpServer;
  private port: number;
  private host: string;
  private requestHandler: ((request: AcpRequest, connectionId: string) => Promise<AcpResponse>) | null = null;
  private httpServer: any = null;
  private connections: Map<string, any> = new Map();

  constructor(server: AcpServer, options: { port?: number; host?: string } = {}) {
    this.server = server;
    this.port = options.port || 3000;
    this.host = options.host || "127.0.0.1";
  }

  async start(): Promise<void> {
    const { createServer } = await import("node:http");

    this.httpServer = createServer(async (req: any, res: any) => {
      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-ACP-Connection",
      };

      if (req.method === "OPTIONS") {
        res.writeHead(204, corsHeaders);
        res.end();
        return;
      }

      if (req.method === "POST" && req.url === "/acp") {
        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });

        req.on("end", async () => {
          try {
            const request = JSON.parse(body) as AcpRequest;
            const connectionId = req.headers["x-acp-connection"] || `http_${Date.now()}`;

            if (!this.connections.has(connectionId)) {
              this.server.connect(connectionId as string);
              this.connections.set(connectionId, { id: connectionId });
            }

            let response: AcpResponse;
            if (this.requestHandler) {
              response = await this.requestHandler(request, connectionId as string);
            } else {
              response = await this.server.handleRequest(connectionId as string, request);
            }

            res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
            res.end(JSON.stringify(response));
          } catch (err) {
            res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
            res.end(JSON.stringify({ error: "Invalid request" }));
          }
        });
      } else if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders });
        res.end(JSON.stringify({ status: "ok" }));
      } else {
        res.writeHead(404, corsHeaders);
        res.end();
      }
    });

    await new Promise<void>((resolve) => {
      this.httpServer.listen(this.port, this.host, () => {
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
    for (const connId of this.connections.keys()) {
      this.server.disconnect(connId);
    }
    this.connections.clear();
  }

  onRequest(handler: (request: AcpRequest, connectionId: string) => Promise<AcpResponse>): void {
    this.requestHandler = handler;
  }

  sendEvent(connectionId: string, event: AcpEvent): void {
    // HTTP transport doesn't support server-push events without SSE/WebSocket
  }
}

export async function startAcpServer(
  server: AcpServer,
  transport: "stdio" | "http" = "stdio",
  options?: { port?: number; host?: string }
): Promise<AcpTransport> {
  let transportInstance: AcpTransport;

  if (transport === "stdio") {
    transportInstance = new StdioTransport(server);
  } else {
    transportInstance = new HttpTransport(server, options);
  }

  await transportInstance.start();
  return transportInstance;
}
