import crypto from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
// Docker isolation is invoked through the Docker CLI to keep the Engine bundle free of native dockerode dependencies.
import type {
  ToolApprovalRequest,
  ToolCommandRequest,
  ToolCommandResult,
  ToolMutationRecord,
} from "../../core/src/system/tool-registry.js";

export interface PendingApproval {
  id: string;
  sessionId: string;
  request: ToolApprovalRequest;
  createdAt: number;
  expiresAt: number;
}

interface ApprovalWaiter {
  approval: PendingApproval;
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class DesktopApprovalManager {
  private readonly pending = new Map<string, ApprovalWaiter>();
  constructor(
    private readonly emit: (event: string, payload: unknown) => void,
    private readonly timeoutMs = 5 * 60_000,
  ) {}

  request(sessionId: string, request: ToolApprovalRequest): Promise<boolean> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const approval: PendingApproval = {
      id,
      sessionId,
      request,
      createdAt: now,
      expiresAt: now + this.timeoutMs,
    };
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(
        () => this.finish(id, false, "expired"),
        this.timeoutMs,
      );
      this.pending.set(id, { approval, resolve, timer });
      this.emit("approval.requested", approval);
    });
  }

  list(): PendingApproval[] {
    return [...this.pending.values()].map(({ approval }) =>
      structuredClone(approval),
    );
  }

  resolve(id: string, approved: boolean): boolean {
    return this.finish(id, approved, approved ? "approved" : "denied");
  }

  cancelSession(sessionId: string): void {
    for (const [id, waiter] of this.pending) {
      if (waiter.approval.sessionId === sessionId)
        this.finish(id, false, "cancelled");
    }
  }

  close(): void {
    for (const id of [...this.pending.keys()])
      this.finish(id, false, "shutdown");
  }

  private finish(id: string, approved: boolean, reason: string): boolean {
    const waiter = this.pending.get(id);
    if (!waiter) return false;
    this.pending.delete(id);
    clearTimeout(waiter.timer);
    waiter.resolve(approved);
    this.emit("approval.resolved", {
      id,
      approved,
      reason,
      sessionId: waiter.approval.sessionId,
    });
    return true;
  }
}

export interface DesktopChangeRecord extends ToolMutationRecord {
  id: string;
  sessionId: string;
  createdAt: number;
  diff: string;
  rolledBackAt?: number;
}

function diffPreview(before: string | null, after: string): string {
  const left = (before ?? "").split(/\r?\n/);
  const right = after.split(/\r?\n/);
  let start = 0;
  while (
    start < left.length &&
    start < right.length &&
    left[start] === right[start]
  )
    start += 1;
  const removed = left.slice(start, start + 60);
  const added = right.slice(start, start + 60);
  return [
    `@@ line ${start + 1} @@`,
    ...removed.map((line) => `- ${line}`),
    ...added.map((line) => `+ ${line}`),
    removed.length < left.length - start || added.length < right.length - start
      ? "[diff truncated]"
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function atomicWrite(file: string, content: string): Promise<void> {
  return (async () => {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(temporary, content, "utf8");
    await fsp.rename(temporary, file);
  })();
}

export class DesktopMutationJournal {
  private readonly file: string;
  private records: DesktopChangeRecord[];
  constructor(
    dataDir: string,
    private readonly emit: (event: string, payload: unknown) => void,
  ) {
    this.file = path.join(dataDir, "agent-changes.json");
    this.records = this.load();
  }

  private load(): DesktopChangeRecord[] {
    try {
      const value = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return Array.isArray(value)
        ? value
            .filter((item) => item && typeof item.id === "string")
            .slice(0, 200)
        : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        console.error(`[agent-changes] ${String(error)}`);
      return [];
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(
      temporary,
      `${JSON.stringify(this.records.slice(0, 200), null, 2)}\n`,
      "utf8",
    );
    fs.renameSync(temporary, this.file);
  }

  record(
    sessionId: string,
    mutation: ToolMutationRecord,
  ): { changeId: string } {
    const max = 1024 * 1024;
    if (
      Buffer.byteLength(mutation.before ?? "") > max ||
      Buffer.byteLength(mutation.after) > max
    ) {
      throw new Error("Mutation exceeds the 1 MiB rollback journal limit");
    }
    const record: DesktopChangeRecord = {
      ...mutation,
      id: crypto.randomUUID(),
      sessionId,
      createdAt: Date.now(),
      diff: diffPreview(mutation.before, mutation.after),
    };
    this.records.unshift(record);
    this.records = this.records.slice(0, 200);
    this.save();
    this.emit("change.recorded", {
      ...record,
      before: undefined,
      after: undefined,
    });
    return { changeId: record.id };
  }

  list(
    sessionId?: string,
  ): Array<Omit<DesktopChangeRecord, "before" | "after">> {
    return this.records
      .filter((record) => !sessionId || record.sessionId === sessionId)
      .map(({ before: _before, after: _after, ...record }) => ({ ...record }));
  }

  async rollback(id: string): Promise<DesktopChangeRecord> {
    const record = this.records.find((item) => item.id === id);
    if (!record) throw new Error(`Change does not exist: ${id}`);
    if (record.rolledBackAt)
      throw new Error(`Change is already rolled back: ${id}`);
    let current: string | null = null;
    try {
      current = await fsp.readFile(record.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (current !== record.after)
      throw new Error(
        "File changed after this mutation; refusing an unsafe rollback",
      );
    if (record.before === null) await fsp.rm(record.path, { force: true });
    else await atomicWrite(record.path, record.before);
    record.rolledBackAt = Date.now();
    this.save();
    this.emit("change.rolled_back", {
      id,
      sessionId: record.sessionId,
      path: record.path,
      rolledBackAt: record.rolledBackAt,
    });
    return record;
  }
}

interface ActiveProcess {
  child: ChildProcess;
  abort: () => void;
}

function shellFor(command: string): { executable: string; args: string[] } {
  return process.platform === "win32"
    ? {
        executable: process.env.ComSpec || "cmd.exe",
        args: ["/d", "/s", "/c", command],
      }
    : { executable: process.env.SHELL || "/bin/sh", args: ["-lc", command] };
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    }).unref();
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

function boundedAppend(
  current: string,
  chunk: Buffer,
  limit: number,
): { value: string; truncated: boolean } {
  const combined = Buffer.from(current + chunk.toString());
  if (combined.length <= limit)
    return { value: combined.toString("utf8"), truncated: false };
  return {
    value: `${combined.subarray(0, limit).toString("utf8")}\n[output truncated]`,
    truncated: true,
  };
}

export class DesktopCommandExecutor {
  private readonly active = new Map<string, ActiveProcess>();
  private dockerAvailable: boolean | null = null;

  constructor(
    private readonly emit: (event: string, payload: unknown) => void,
  ) {}

  async status(): Promise<Record<string, unknown>> {
    return {
      process: true,
      docker: await this.hasDocker(),
      active: this.active.size,
    };
  }

  async execute(
    request: ToolCommandRequest,
    commandId = crypto.randomUUID(),
  ): Promise<ToolCommandResult> {
    const useDocker =
      request.sandbox === "docker" ||
      (request.sandbox === "auto" &&
        request.networkDisabled &&
        (await this.hasDocker()));
    return useDocker
      ? this.executeDocker(request, commandId)
      : this.executeProcess(request, commandId);
  }

  cancel(commandId: string): boolean {
    const active = this.active.get(commandId);
    if (!active) return false;
    active.abort();
    return true;
  }

  close(): void {
    for (const active of this.active.values()) active.abort();
    this.active.clear();
  }

  private async hasDocker(): Promise<boolean> {
    if (this.dockerAvailable !== null) return this.dockerAvailable;
    this.dockerAvailable = await new Promise<boolean>((resolve) => {
      const child = spawn(
        "docker",
        ["version", "--format", "{{.Server.Version}}"],
        { windowsHide: true, stdio: ["ignore", "ignore", "ignore"] },
      );
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (available: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(available);
      };
      timer = setTimeout(() => {
        killTree(child);
        finish(false);
      }, 3000);
      child.on("error", () => finish(false));
      child.on("exit", (code) => finish(code === 0));
    });
    return this.dockerAvailable;
  }

  private executeDocker(
    request: ToolCommandRequest,
    commandId: string,
  ): Promise<ToolCommandResult> {
    const startedAt = Date.now();
    const containerName = `openstar-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
    const args = [
      "run",
      "--rm",
      "--name",
      containerName,
      "--workdir",
      "/workspace",
    ];
    if (request.networkDisabled) args.push("--network", "none");
    args.push("--volume", `${request.cwd}:/workspace`);
    for (const [key, value] of Object.entries(request.environment)) {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        args.push("--env", `${key}=${value}`);
      }
    }
    args.push("node:20-alpine", "sh", "-lc", request.command);

    return new Promise((resolve, reject) => {
      const child = spawn("docker", args, {
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let truncated = false;
      let settled = false;
      const removeContainer = () => {
        const cleanup = spawn("docker", ["rm", "-f", containerName], {
          windowsHide: true,
          stdio: "ignore",
        });
        cleanup.unref();
      };
      const abort = () => {
        removeContainer();
        killTree(child);
        finish(130);
      };
      this.active.set(commandId, { child, abort });
      request.signal?.addEventListener("abort", abort, { once: true });
      this.emit("command.started", {
        commandId,
        command: request.command,
        cwd: request.cwd,
        pid: child.pid,
        backend: "docker",
        containerName,
      });
      const append = (stream: "stdout" | "stderr", chunk: Buffer) => {
        const next = boundedAppend(
          stream === "stdout" ? stdout : stderr,
          chunk,
          request.maxOutputBytes,
        );
        truncated ||= next.truncated;
        if (stream === "stdout") stdout = next.value;
        else stderr = next.value;
        this.emit("command.output", {
          commandId,
          stream,
          text: chunk.toString(),
        });
      };
      const timer = setTimeout(() => {
        removeContainer();
        killTree(child);
        finish(124);
      }, request.timeoutMs);
      const finish = (exitCode: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", abort);
        this.active.delete(commandId);
        const result: ToolCommandResult = {
          exitCode,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
          backend: "docker",
          truncated,
        };
        this.emit("command.exited", {
          commandId,
          ...result,
          containerName,
        });
        resolve(result);
      };
      child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
      child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", abort);
        this.active.delete(commandId);
        reject(error);
      });
      child.on("exit", (code) => finish(code ?? 1));
    });
  }

  private executeProcess(
    request: ToolCommandRequest,
    commandId: string,
  ): Promise<ToolCommandResult> {
    const startedAt = Date.now();
    const shell = shellFor(request.command);
    return new Promise((resolve, reject) => {
      const child = spawn(shell.executable, shell.args, {
        cwd: request.cwd,
        env: { ...process.env, ...request.environment },
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let truncated = false;
      let settled = false;
      const abort = () => {
        killTree(child);
        finish(130);
      };
      this.active.set(commandId, { child, abort });
      request.signal?.addEventListener("abort", abort, { once: true });
      this.emit("command.started", {
        commandId,
        command: request.command,
        cwd: request.cwd,
        pid: child.pid,
        backend: "process-restricted",
      });
      const append = (stream: "stdout" | "stderr", chunk: Buffer) => {
        const next = boundedAppend(
          stream === "stdout" ? stdout : stderr,
          chunk,
          request.maxOutputBytes,
        );
        truncated ||= next.truncated;
        if (stream === "stdout") stdout = next.value;
        else stderr = next.value;
        this.emit("command.output", {
          commandId,
          stream,
          text: chunk.toString(),
        });
      };
      const timer = setTimeout(() => {
        killTree(child);
        finish(124);
      }, request.timeoutMs);
      const finish = (exitCode: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        request.signal?.removeEventListener("abort", abort);
        this.active.delete(commandId);
        const result: ToolCommandResult = {
          exitCode,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
          backend: "process-restricted",
          truncated,
        };
        this.emit("command.exited", { commandId, ...result });
        resolve(result);
      };
      child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
      child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));
      child.on("error", reject);
      child.on("exit", (code) => finish(code ?? 1));
    });
  }
}
