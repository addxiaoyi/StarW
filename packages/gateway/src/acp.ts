import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { StarCore } from "@openstar/core";
import { prepareCommand, redactSecrets, resolveReadablePath } from "./security.js";

const execFileAsync = promisify(execFile);

export const gatewayEvents = new EventEmitter();
gatewayEvents.setMaxListeners(100);

let sequence = 0;
function uid(prefix = "id"): string {
  return `${prefix}-${Date.now().toString(36)}-${(sequence++).toString(36)}`;
}

interface SessionRecord {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  messages: Array<{
    id: string;
    role: "user" | "assistant" | "system";
    content: Array<{ type: "text"; text?: string }>;
    created_at: number;
  }>;
}

export interface AcpContext {
  workspaceRoot?: string;
  allowCommands?: boolean;
  allowConfigWrite?: boolean;
  maxFileBytes?: number;
}

interface NormalizedContext {
  workspaceRoot: string;
  allowCommands: boolean;
  allowConfigWrite: boolean;
  maxFileBytes: number;
}

const sessions = new Map<string, SessionRecord>();

function normalizeContext(context: AcpContext = {}): NormalizedContext {
  return {
    workspaceRoot: path.resolve(context.workspaceRoot ?? process.env.OPENSTAR_WORKSPACE_ROOT ?? process.cwd()),
    allowCommands: context.allowCommands ?? process.env.OPENSTAR_DISABLE_COMMANDS !== "1",
    allowConfigWrite: context.allowConfigWrite ?? process.env.OPENSTAR_ALLOW_CONFIG_WRITE === "1",
    maxFileBytes: Math.max(1, Math.min(context.maxFileBytes ?? 1024 * 1024, 8 * 1024 * 1024)),
  };
}

export function emit(event: string, payload: unknown): void {
  gatewayEvents.emit(event, payload);
  gatewayEvents.emit("event", { event, payload, ts: Date.now() });
}

async function runCommand(command: string, context: NormalizedContext, cwdInput?: string) {
  if (!context.allowCommands) {
    return { stdout: "", stderr: "Command execution is disabled", exitCode: 403, blocked: true };
  }

  let prepared: ReturnType<typeof prepareCommand>;
  try {
    prepared = prepareCommand(command);
  } catch (error) {
    return {
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 403,
      blocked: true,
    };
  }

  const cwd = await resolveReadablePath(context.workspaceRoot, cwdInput ?? ".");
  if (!cwd.allowed || !cwd.path) {
    return { stdout: "", stderr: cwd.reason ?? "Invalid working directory", exitCode: 403, blocked: true };
  }

  if (prepared.executable === "echo") {
    return { stdout: `${prepared.args.join(" ")}${os.EOL}`, stderr: "", exitCode: 0, blocked: false };
  }

  try {
    const { stdout, stderr } = await execFileAsync(prepared.executable, prepared.args, {
      cwd: cwd.path,
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    return { stdout: String(stdout), stderr: String(stderr), exitCode: 0, blocked: false };
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string; code?: number | string };
    return {
      stdout: String(failure.stdout ?? ""),
      stderr: String(failure.stderr ?? failure.message),
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      blocked: false,
    };
  }
}

async function catalog(workspaceRoot: string) {
  const instance = new StarCore({ workingDirectory: workspaceRoot });
  await instance.initialize();
  try {
    return {
      skills: instance.listTools().map((tool) => ({
        id: tool.name,
        name: tool.name,
        version: "0.1.0",
        description: tool.description,
        type: "skill",
        capabilities: [tool.name],
      })),
      agents: instance.listAgents().map((agent) => ({
        id: agent.name,
        name: agent.name,
        version: "0.1.0",
        description: agent.description,
        type: "agent",
        capabilities: [agent.type],
      })),
      commands: [{
        id: "terminal",
        name: "terminal",
        version: "0.1.0",
        description: "Run an allowlisted executable without a shell",
        type: "command",
        capabilities: ["local-command"],
      }],
    };
  } finally {
    await instance.close();
  }
}

export async function handleAcp(
  method: string,
  params: Record<string, unknown> = {},
  providedContext: AcpContext = {},
): Promise<unknown> {
  const context = normalizeContext(providedContext);

  switch (method) {
    case "skills/list": {
      const values = await catalog(context.workspaceRoot);
      return { skills: values.skills, agents: values.agents };
    }

    case "skills/execute": {
      const skillId = String(params.skill_id ?? params.skillId ?? "");
      const input = (params.input ?? {}) as Record<string, unknown>;
      const started = Date.now();
      emit("skill:start", { skill: skillId });

      if (["bash", "terminal", "shell"].includes(skillId)) {
        const result = await runCommand(
          String(input.command ?? ""),
          context,
          input.cwd ? String(input.cwd) : undefined,
        );
        emit("skill:done", { skill: skillId, exitCode: result.exitCode, blocked: result.blocked });
        return {
          task_id: uid("task"),
          success: result.exitCode === 0,
          output: { stdout: result.stdout, stderr: result.stderr },
          error: result.exitCode === 0 ? undefined : result.stderr || "command failed",
          blocked: result.blocked,
          duration_ms: Date.now() - started,
        };
      }

      return {
        task_id: uid("task"),
        success: false,
        error: `Skill "${skillId}" has no Gateway execution adapter`,
        duration_ms: Date.now() - started,
      };
    }

    case "terminal/suggest":
      return { command: null, error: "Command suggestions require a configured agent provider" };

    case "files/list": {
      const checked = await resolveReadablePath(context.workspaceRoot, String(params.path ?? "."));
      if (!checked.allowed || !checked.path) return { entries: [], error: checked.reason };
      try {
        const entries = await fs.readdir(checked.path, { withFileTypes: true });
        return {
          entries: entries.map((entry) => ({
            name: entry.name,
            type: entry.isDirectory() ? "directory" : "file",
            path: path.relative(context.workspaceRoot, path.join(checked.path!, entry.name)) || ".",
          })),
        };
      } catch (error) {
        return { entries: [], error: error instanceof Error ? error.message : String(error) };
      }
    }

    case "files/read": {
      const checked = await resolveReadablePath(context.workspaceRoot, String(params.path ?? ""));
      if (!checked.allowed || !checked.path) return { content: "", error: checked.reason };
      try {
        const stat = await fs.stat(checked.path);
        if (!stat.isFile()) return { content: "", error: "Path is not a file" };
        if (stat.size > context.maxFileBytes) {
          return { content: "", error: `File exceeds ${context.maxFileBytes} byte limit` };
        }
        return { content: await fs.readFile(checked.path, "utf-8") };
      } catch (error) {
        return { content: "", error: error instanceof Error ? error.message : String(error) };
      }
    }

    case "config/get": {
      try {
        const core = await import("@openstar/core");
        return redactSecrets(core.loadConfig());
      } catch {
        return {};
      }
    }

    case "config/set": {
      if (!context.allowConfigWrite) return { ok: false, error: "Configuration writes are disabled" };
      try {
        const core = await import("@openstar/core");
        const current = core.loadConfig();
        const mutableKeys = new Set(["ui", "providers", "swarm", "agents", "sandbox"]);
        const patch = Object.fromEntries(Object.entries(params).filter(([key]) => mutableKeys.has(key)));
        core.saveConfig({ ...current, ...patch }, core.getConfigPaths()[0]);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    case "registry/skills": {
      const values = await catalog(context.workspaceRoot);
      return { skills: values.skills };
    }
    case "registry/commands": {
      const values = await catalog(context.workspaceRoot);
      return { commands: values.commands };
    }
    case "registry/agents": {
      const values = await catalog(context.workspaceRoot);
      return { agents: values.agents };
    }

    case "sessions/create": {
      const name = String(params.name ?? "New Session").slice(0, 200);
      const id = uid("sess");
      const now = Date.now();
      const session: SessionRecord = { id, name, created_at: now, updated_at: now, messages: [] };
      sessions.set(id, session);
      emit("session:create", { id, name });
      return session;
    }

    case "sessions/prompt": {
      const sessionId = String(params.session_id ?? "");
      const messages = (params.messages as Array<{ role: string; content: Array<{ text?: string }> }>) ?? [];
      const text = messages.at(-1)?.content?.map((content) => content.text ?? "").join("").slice(0, 64_000) ?? "";
      const session = sessions.get(sessionId);
      if (!session) return { ok: false, error: "session not found" };

      const now = Date.now();
      session.messages.push({ id: uid("msg"), role: "user", content: [{ type: "text", text }], created_at: now });
      session.updated_at = now;

      const { createRuntimeFromConfig } = await import("@openstar/swarm");
      const runtime = createRuntimeFromConfig();
      if (!runtime.isConfigured()) {
        session.messages.push({
          id: uid("msg"),
          role: "assistant",
          content: [{ type: "text", text: "No LLM provider is configured. Configure a provider before starting agent chat." }],
          created_at: Date.now(),
        });
        session.updated_at = Date.now();
        emit("session:message", { sessionId, role: "assistant" });
        return { ok: false, error: "provider not configured" };
      }

      emit("session:message", { sessionId, role: "thinking" });
      try {
        const core = await import("@openstar/core");
        const definition = core.AgentDefinition.parse({
          id: "web-agent",
          name: "Web Agent",
          type: "primary",
          description: "Agent answering from the OpenStar UI.",
          capabilities: [],
        });
        const result = await Promise.race([
          runtime.run({ agentDefinition: definition, task: text }),
          new Promise<Awaited<ReturnType<typeof runtime.run>>>((resolve) =>
            setTimeout(
              () => resolve({
                success: false,
                output: "",
                toolCalls: [],
                iterations: 0,
                durationMs: 0,
                error: "response timed out",
              }),
              15_000,
            ),
          ),
        ]);
        session.messages.push({
          id: uid("msg"),
          role: "assistant",
          content: [{ type: "text", text: result.success ? result.output : `Agent error: ${result.error ?? "unknown"}` }],
          created_at: Date.now(),
        });
      } catch (error) {
        session.messages.push({
          id: uid("msg"),
          role: "assistant",
          content: [{ type: "text", text: `Agent error: ${error instanceof Error ? error.message : String(error)}` }],
          created_at: Date.now(),
        });
      }
      session.updated_at = Date.now();
      emit("session:message", { sessionId, role: "assistant" });
      return { ok: true };
    }

    case "sessions/list_messages": {
      const session = sessions.get(String(params.session_id ?? ""));
      const limit = Math.max(1, Math.min(Number(params.limit ?? 50), 500));
      return { messages: session ? session.messages.slice(-limit) : [] };
    }

    default:
      throw new Error(`Unknown ACP method: ${method}`);
  }
}
