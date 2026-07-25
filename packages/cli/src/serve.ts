/**
 * OpenStar stdio server mode.
 *
 * Speaks a tiny line-delimited JSON-RPC protocol over stdin/stdout so that
 * external processes (e.g. the Electron desktop shell) can drive the real
 * OpenStar engine without a TTY:
 *
 *   { "id": "1", "method": "ping" }
 *   { "id": "1", "result": { "ok": true } }
 *
 *   { "id": "2", "method": "exec", "params": { "cmd": "/status" } }
 *   { "id": "2", "result": { "lines": ["...", "..."] } }
 *
 *   { "id": "3", "method": "exec", "params": { "cmd": "/exit" } }
 *   { "id": "3", "result": { "closed": true } }
 */
import readline from "node:readline";
import { createTuiCommandHandler } from "./tui/commands.js";
import { getTheme } from "./tui/theme.js";

interface ServeRequest {
  id?: string;
  method: string;
  params?: Record<string, unknown>;
}

async function loadRuntimeCatalog(): Promise<{
  skills: Array<Record<string, unknown>>;
  agents: Array<Record<string, unknown>>;
}> {
  const { StarCore } = await import("@openstar/core");
  const instance = new StarCore({ workingDirectory: process.cwd() });
  await instance.initialize();
  try {
    return {
      skills: instance.listTools().map((tool) => ({
        id: tool.name,
        name: tool.name,
        description: tool.description,
        enabled: true,
      })),
      agents: instance.listAgents().map((agent) => ({ ...agent, status: "available" })),
    };
  } finally {
    await instance.close();
  }
}

export async function runServe(configPath?: string): Promise<void> {
  const theme = getTheme();
  const handler = createTuiCommandHandler(configPath);
  const rl = readline.createInterface({ input: process.stdin });

  const send = (obj: unknown) => {
    process.stdout.write(JSON.stringify(obj) + "\n");
  };

  const respond = (id: string | undefined, result: unknown) => send({ id, result });
  const fail = (id: string | undefined, message: string) => send({ id, error: message });

  rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let req: ServeRequest;
    try {
      req = JSON.parse(trimmed) as ServeRequest;
    } catch {
      return;
    }

    if (req.method === "ping") {
      respond(req.id, { ok: true });
      return;
    }

    if (req.method === "status") {
      try {
        const core = await import("@openstar/core");
        const config = core.loadConfig(configPath);
        const providerConfig = (config.providers ?? {}) as Record<string, { apiKey?: string }>;
        const providers: Record<string, boolean> = {};
        for (const p of ["openai", "anthropic", "kimi"] as const) {
          providers[p] = Boolean(providerConfig[p]?.apiKey);
        }
        respond(req.id, { core: "ready", version: "0.1.0", providers });
      } catch {
        respond(req.id, { core: "ready", version: "0.1.0", providers: {} });
      }
      return;
    }

    if (req.method === "skills") {
      try {
        const catalog = await loadRuntimeCatalog();
        respond(req.id, { skills: catalog.skills });
      } catch (error) {
        fail(req.id, error instanceof Error ? error.message : String(error));
      }
      return;
    }

    if (req.method === "agents") {
      try {
        const catalog = await loadRuntimeCatalog();
        respond(req.id, { agents: catalog.agents });
      } catch (error) {
        fail(req.id, error instanceof Error ? error.message : String(error));
      }
      return;
    }

    if (req.method === "mcp-status") {
      try {
        const core = await import("@openstar/core");
        const config = core.loadConfig(configPath) as {
          mcp?: { servers?: Array<Record<string, unknown>> };
        };
        const servers = Array.isArray(config.mcp?.servers) ? config.mcp.servers : [];
        respond(req.id, {
          available: false,
          connected: 0,
          total: servers.length,
          servers: servers.map((server) => ({ ...server, status: "not_connected" })),
        });
      } catch (error) {
        respond(req.id, {
          available: false,
          connected: 0,
          total: 0,
          servers: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (req.method === "stats") {
      try {
        const core = await import("@openstar/core");
        const persistence = core.getPersistence();
        respond(req.id, { stats: persistence.getStats() });
      } catch (err) {
        respond(req.id, { stats: null, error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (req.method === "dag-patterns") {
      const { DagEngine } = await import("@openstar/swarm");
      const engine = new DagEngine();
      respond(req.id, { patterns: engine.listPatterns() });
      return;
    }

    if (req.method === "exec") {
      const cmd = String(req.params?.cmd ?? "");
      const collected: string[] = [];
      let closed = false;

      const ctx = {
        theme,
        print: (l: string) => {
          for (const x of l.split("\n")) collected.push(x);
        },
        clearScreen: () => {
          collected.length = 0;
        },
        setStatus: () => {},
        setTheme: () => {},
        exit: () => {
          closed = true;
        },
      };

      try {
        await handler(cmd, ctx as never);
        if (closed) {
          respond(req.id, { closed: true });
          rl.close();
          process.stdin.pause();
          return;
        }
        respond(req.id, { lines: collected });
      } catch (err) {
        fail(req.id, err instanceof Error ? err.message : String(err));
      }
      return;
    }

    fail(req.id, `Unknown method: ${req.method}`);
  });

  // Signal readiness to the parent process.
  send({ id: null, result: { ready: true } });
}
