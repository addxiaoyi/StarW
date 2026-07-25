import { executeSkill, type AcpExecuteResult } from "./acp";
import { desktopRequest, hasDesktopBridge } from "./desktop";

export interface TerminalCommandResult {
  commandId?: string;
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
  exitCode?: number | null;
}

export interface InteractiveTerminalSession {
  sessionId: string;
  instanceId: string;
  pid: number;
  cwd: string;
  cols: number;
  rows: number;
  shell: string;
}

export async function createInteractiveTerminal(
  sessionId: string,
  cwd: string,
  cols: number,
  rows: number,
): Promise<InteractiveTerminalSession> {
  return desktopRequest<InteractiveTerminalSession>("terminal.create", {
    sessionId,
    cwd,
    cols,
    rows,
  });
}

export async function writeInteractiveTerminal(
  sessionId: string,
  instanceId: string,
  data: string,
): Promise<void> {
  if (!data) return;
  await desktopRequest("terminal.write", { sessionId, instanceId, data });
}

export async function resizeInteractiveTerminal(
  sessionId: string,
  instanceId: string,
  cols: number,
  rows: number,
): Promise<void> {
  await desktopRequest("terminal.resize", {
    sessionId,
    instanceId,
    cols,
    rows,
  });
}

export async function disposeInteractiveTerminal(
  sessionId: string,
  instanceId?: string,
): Promise<void> {
  await desktopRequest("terminal.dispose", { sessionId, instanceId });
}

function formatOutput(output: Record<string, unknown>): string {
  if (typeof output.output === "string") return output.output;
  if (typeof output.content === "string") return output.content;
  if (typeof output.stdout === "string" || typeof output.stderr === "string") {
    return [output.stdout, output.stderr]
      .filter((value) => typeof value === "string" && value)
      .join("");
  }
  if (typeof output.result === "string") return output.result;
  if (Array.isArray(output.results)) {
    return output.results
      .map((item) =>
        typeof item === "string" ? item : JSON.stringify(item, null, 2),
      )
      .join("\n");
  }
  return JSON.stringify(output, null, 2);
}

export async function executeTerminalCommand(
  command: string,
  cwd?: string,
  commandId?: string,
): Promise<TerminalCommandResult> {
  const trimmed = command.trim();
  if (!trimmed) return { success: true, output: "", durationMs: 0 };

  try {
    if (hasDesktopBridge()) {
      if (trimmed.startsWith("/")) {
        const [skillId, ...rest] = trimmed.slice(1).split(/\s+/);
        const argumentText = rest.join(" ").trim();
        let input: Record<string, unknown> = {};
        if (argumentText) {
          try {
            const parsed = JSON.parse(argumentText);
            input =
              parsed && typeof parsed === "object" && !Array.isArray(parsed)
                ? (parsed as Record<string, unknown>)
                : { command: argumentText, prompt: argumentText };
          } catch {
            input = {
              command: argumentText,
              prompt: argumentText,
              path: argumentText,
            };
          }
        }
        if (cwd) input.cwd = cwd;
        const result = await desktopRequest<AcpExecuteResult>(
          "skills/execute",
          {
            skill_id: skillId,
            input,
          },
        );
        return {
          success: result.success,
          output: formatOutput(result.output),
          error: result.error,
          durationMs: result.duration_ms,
        };
      }

      const result = await desktopRequest<Record<string, unknown>>(
        "command.execute",
        { command: trimmed, cwd: cwd || ".", commandId },
        3_700_000,
      );
      return {
        commandId:
          typeof result.commandId === "string" ? result.commandId : undefined,
        success: result.success === true,
        output: formatOutput(result),
        error: typeof result.error === "string" ? result.error : undefined,
        durationMs:
          typeof result.durationMs === "number" ? result.durationMs : 0,
        exitCode:
          typeof result.exitCode === "number" || result.exitCode === null
            ? result.exitCode
            : undefined,
      };
    }

    let result: AcpExecuteResult;
    if (trimmed.startsWith("/")) {
      const [skillId, ...rest] = trimmed.slice(1).split(/\s+/);
      result = await executeSkill(skillId, { command: rest.join(" "), cwd });
    } else {
      result = await executeSkill("bash", { command: trimmed, cwd });
    }
    return {
      success: result.success,
      output: formatOutput(result.output),
      error: result.error,
      durationMs: result.duration_ms,
    };
  } catch (error) {
    return {
      success: false,
      output: "",
      error: error instanceof Error ? error.message : String(error),
      durationMs: 0,
    };
  }
}

export async function cancelTerminalCommand(
  commandId: string,
): Promise<boolean> {
  if (!hasDesktopBridge()) return false;
  const result = await desktopRequest<{ cancelled: boolean }>(
    "command.cancel",
    { commandId },
  );
  return result.cancelled;
}
