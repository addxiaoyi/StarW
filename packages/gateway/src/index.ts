import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { handleAcp, gatewayEvents, emit, type AcpContext } from "./acp.js";

export interface GatewayOptions {
  port?: number;
  host?: string;
  token?: string;
  allowedOrigins?: string[];
  workspaceRoot?: string;
  allowConfigWrite?: boolean;
}

export interface GatewayServer {
  port: number;
  stop: () => void;
}

export interface GatewayRuntime {
  token?: string;
  allowedOrigins: Set<string>;
  acpContext: AcpContext;
  loopbackOnly: boolean;
}

const MAX_BODY_BYTES = 1024 * 1024;

export function createGatewayRuntime(options: GatewayOptions = {}): {
  requestedPort: number;
  host: string;
  runtime: GatewayRuntime;
} {
  const requestedPort = options.port ?? Number(process.env.OPENSTAR_GATEWAY_PORT ?? 3456);
  const host = options.host ?? process.env.OPENSTAR_GATEWAY_HOST ?? "127.0.0.1";
  const token = options.token ?? process.env.OPENSTAR_GATEWAY_TOKEN;
  const loopbackOnly = isLoopback(host);

  if (!loopbackOnly && !token) {
    throw new Error("OPENSTAR_GATEWAY_TOKEN is required when binding the Gateway to a non-loopback host");
  }

  return {
    requestedPort,
    host,
    runtime: {
      token,
      loopbackOnly,
      allowedOrigins: new Set(
        options.allowedOrigins ??
          (process.env.OPENSTAR_ALLOWED_ORIGINS ?? "http://127.0.0.1:4446,http://localhost:4446")
            .split(",")
            .map((origin) => origin.trim())
            .filter(Boolean),
      ),
      acpContext: {
        workspaceRoot: path.resolve(options.workspaceRoot ?? process.env.OPENSTAR_WORKSPACE_ROOT ?? process.cwd()),
        allowConfigWrite: options.allowConfigWrite ?? process.env.OPENSTAR_ALLOW_CONFIG_WRITE === "1",
      },
    },
  };
}

export async function startGateway(options: GatewayOptions = {}): Promise<GatewayServer> {
  const { requestedPort, host, runtime } = createGatewayRuntime(options);
  const server = Bun.serve({
    port: requestedPort,
    hostname: host,
    fetch: (request, bunServer) => handleGatewayRequest(request, runtime, (value) => bunServer.upgrade(value)),
    websocket: {
      open: (socket) => {
        const handler = (payload: unknown) => {
          try {
            socket.send(JSON.stringify(payload));
          } catch {
            // Closed sockets are cleaned up by close().
          }
        };
        gatewayEvents.on("event", handler);
        (socket as typeof socket & { __openstarHandler?: (payload: unknown) => void }).__openstarHandler = handler;
      },
      message: () => {},
      close: (socket) => {
        const handler = (socket as typeof socket & { __openstarHandler?: (payload: unknown) => void }).__openstarHandler;
        if (handler) gatewayEvents.off("event", handler);
      },
    },
  });

  console.log(`◆ OpenStar gateway listening on http://${host}:${server.port}`);
  return { port: server.port ?? requestedPort, stop: () => server.stop(true) };
}

export async function handleGatewayRequest(
  request: Request,
  runtime: GatewayRuntime,
  upgrade: (request: Request) => boolean = () => false,
): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");

  if (!originAllowed(origin, runtime.allowedOrigins)) {
    return json({ error: "Origin not allowed" }, 403, origin, runtime);
  }
  if (runtime.loopbackOnly && !isLoopback(url.hostname)) {
    return json({ error: "Invalid Host header" }, 403, origin, runtime);
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: responseHeaders(origin, runtime) });
  }

  if (url.pathname !== "/api/health" && !authorized(request, url, runtime.token)) {
    return json({ error: "Unauthorized" }, 401, origin, runtime);
  }

  if (url.pathname === "/acp" && request.method === "POST") {
    return handleAcpRequest(request, runtime, origin);
  }

  if (url.pathname === "/ws/events") {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "WebSocket upgrade required" }, 400, origin, runtime);
    }
    return upgrade(request)
      ? new Response(null)
      : json({ error: "WebSocket upgrade failed" }, 500, origin, runtime);
  }

  if (url.pathname === "/api/health" && request.method === "GET") {
    return json({ ok: true, version: "0.1.0", ts: Date.now() }, 200, origin, runtime);
  }

  if (url.pathname === "/api/stats" && request.method === "GET") {
    return json(await getStats(), 200, origin, runtime);
  }

  if (url.pathname === "/api/agents" && request.method === "GET") {
    return json({ agents: await getAgents(runtime.acpContext.workspaceRoot) }, 200, origin, runtime);
  }

  if (url.pathname === "/api/dag/patterns" && request.method === "GET") {
    try {
      const { DagEngine } = await import("@openstar/swarm");
      return json({ patterns: new DagEngine().listPatterns() }, 200, origin, runtime);
    } catch {
      return json({ patterns: [] }, 200, origin, runtime);
    }
  }

  if (url.pathname === "/api/dag/run" && request.method === "POST") {
    return handleDagRun(request, runtime, origin);
  }

  return json({ error: "Not Found" }, 404, origin, runtime);
}

async function handleAcpRequest(
  request: Request,
  runtime: GatewayRuntime,
  origin: string | null,
): Promise<Response> {
  let body: { id?: number | string; method?: string; params?: Record<string, unknown> };
  try {
    body = await readJson(request);
  } catch (error) {
    const status = error instanceof PayloadTooLargeError ? 413 : 400;
    return json(
      { jsonrpc: "2.0", error: { code: -32700, message: error instanceof Error ? error.message : "Parse error" } },
      status,
      origin,
      runtime,
    );
  }

  try {
    const result = await handleAcp(body.method ?? "", body.params ?? {}, runtime.acpContext);
    return json({ jsonrpc: "2.0", id: body.id, result }, 200, origin, runtime);
  } catch (error) {
    return json(
      {
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
      },
      400,
      origin,
      runtime,
    );
  }
}

async function handleDagRun(
  request: Request,
  runtime: GatewayRuntime,
  origin: string | null,
): Promise<Response> {
  let pattern = "";
  try {
    const body = await readJson<{ pattern?: string }>(request);
    pattern = String(body.pattern ?? "").slice(0, 200);
    if (!pattern) return json({ error: "DAG pattern is required" }, 400, origin, runtime);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400, origin, runtime);
  }

  try {
    const { DagExecutor, createRuntimeFromConfig } = await import("@openstar/swarm");
    const executor = new DagExecutor({
      runtime: createRuntimeFromConfig(),
      onEvent: (event) => {
        if (event.type === "run:start") emit("dag:run", { pattern, status: "started" });
        else if (event.type === "node:start") emit("dag:node", { pattern, node: event.label, status: "running" });
        else if (event.type === "node:complete") emit("dag:node", { pattern, node: event.label, status: "completed" });
        else if (event.type === "node:error") emit("dag:node", { pattern, node: event.label, status: "failed", error: event.error });
        else if (event.type === "run:complete") emit("dag:done", { pattern, success: event.success, durationMs: event.durationMs });
        else if (event.type === "run:error") emit("dag:error", { pattern, error: event.error });
      },
    });
    const result = await executor.runPattern(pattern);
    return json(
      {
        runId: result.runId,
        status: result.success ? "completed" : "failed",
        mode: result.mode,
        durationMs: result.durationMs,
        nodeResults: result.nodeResults,
      },
      200,
      origin,
      runtime,
    );
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500, origin, runtime);
  }
}

async function getAgents(workspaceRoot?: string) {
  try {
    const core = await import("@openstar/core");
    const instance = new core.StarCore({ workingDirectory: workspaceRoot });
    await instance.initialize();
    try {
      return instance.listAgents().map((agent) => ({ ...agent, status: "available" }));
    } finally {
      await instance.close();
    }
  } catch {
    return [];
  }
}

async function getStats(): Promise<unknown> {
  try {
    const core = await import("@openstar/core");
    return { stats: core.getPersistence().getStats() };
  } catch (error) {
    return { stats: null, error: error instanceof Error ? error.message : String(error) };
  }
}

class PayloadTooLargeError extends Error {}

async function readJson<T = { id?: number | string; method?: string; params?: Record<string, unknown> }>(request: Request): Promise<T> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) throw new PayloadTooLargeError("Request body is too large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new PayloadTooLargeError("Request body is too large");
  return JSON.parse(text) as T;
}

function authorized(request: Request, url: URL, token?: string): boolean {
  if (!token) return true;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const supplied = bearer ?? request.headers.get("x-openstar-token") ?? url.searchParams.get("token") ?? "";
  const expected = Buffer.from(token);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function originAllowed(origin: string | null, allowedOrigins: Set<string>): boolean {
  return !origin || allowedOrigins.has(origin);
}

function isLoopback(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

function responseHeaders(origin: string | null, runtime: GatewayRuntime): Headers {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type,X-OpenStar-Token",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    Vary: "Origin",
  });
  if (origin && runtime.allowedOrigins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function json(data: unknown, status: number, origin: string | null, runtime: GatewayRuntime): Response {
  return new Response(JSON.stringify(data), { status, headers: responseHeaders(origin, runtime) });
}
