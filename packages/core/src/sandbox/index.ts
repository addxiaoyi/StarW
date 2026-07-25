/**
 * OpenStar Docker Sandbox
 *
 * Provides container-based isolation for worker execution.
 * Inspired by HomeRail's Node Worker Docker lifecycle management.
 */
import Docker from "dockerode";
import path from "path";
import fs from "fs";

// ─── Types ───────────────────────────────────────────────────────────

export interface SandboxConfig {
  image?: string;
  workdir?: string;
  env?: Record<string, string>;
  memoryLimit?: string;
  cpuLimit?: string;
  networkDisabled?: boolean;
  timeoutSeconds?: number;
  volumes?: Array<{ host: string; container: string; mode?: "ro" | "rw" }>;
}

export interface SandboxInfo {
  id: string;
  containerId: string;
  status: "creating" | "running" | "stopped" | "error";
  startedAt: number;
  config: SandboxConfig;
}

export interface SandboxExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

// ─── Core ────────────────────────────────────────────────────────────

export class DockerSandbox {
  private docker: Docker;
  private containers = new Map<string, SandboxInfo>();

  constructor(socketPath?: string) {
    this.docker = new Docker(
      socketPath
        ? { socketPath }
        : process.platform === "win32"
        ? { host: "localhost", port: 2375 }
        : { socketPath: "/var/run/docker.sock" }
    );
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  async create(config: SandboxConfig = {}): Promise<SandboxInfo> {
    const workdir = config.workdir || "/workspace";

    const containerConfig: Docker.ContainerCreateOptions = {
      Image: config.image || "node:20-alpine",
      Cmd: ["sleep", (config.timeoutSeconds ? String(config.timeoutSeconds) : "3600")],
      WorkingDir: workdir,
      Env: config.env
        ? Object.entries(config.env).map(([k, v]) => `${k}=${v}`)
        : [],
      HostConfig: {
        Memory: config.memoryLimit ? parseInt(config.memoryLimit) * 1024 * 1024 : undefined,
        CpuShares: config.cpuLimit ? parseInt(config.cpuLimit) : undefined,
        NetworkMode: config.networkDisabled ? "none" : "bridge",
        AutoRemove: true,
        Binds: config.volumes?.map(
          (v) => `${path.resolve(v.host)}:${v.container}:${v.mode || "rw"}`
        ),
      },
    };

    const container = await this.docker.createContainer(containerConfig);
    await container.start();

    const info: SandboxInfo = {
      id: `sandbox_${Date.now().toString(36)}`,
      containerId: container.id,
      status: "running",
      startedAt: Date.now(),
      config,
    };

    this.containers.set(info.id, info);
    return info;
  }

  async exec(
    sandboxId: string,
    command: string[],
    options?: { workdir?: string; env?: Record<string, string>; timeoutSeconds?: number }
  ): Promise<SandboxExecResult> {
    const info = this.containers.get(sandboxId);
    if (!info) throw new Error(`Sandbox ${sandboxId} not found`);
    if (info.status !== "running") throw new Error(`Sandbox ${sandboxId} is not running`);

    const container = this.docker.getContainer(info.containerId);
    const startTime = Date.now();

    const exec = await container.exec({
      Cmd: command,
      WorkingDir: options?.workdir,
      Env: options?.env ? Object.entries(options.env).map(([k, v]) => `${k}=${v}`) : undefined,
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start({ hijack: true, Detach: false });
    let stdout = "";
    let stderr = "";

    await new Promise<void>((resolve, reject) => {
      const timeout = options?.timeoutSeconds
        ? setTimeout(() => {
            stream.destroy();
            reject(new Error(`Command timed out after ${options.timeoutSeconds}s`));
          }, options.timeoutSeconds * 1000)
        : null;

      container.modem.demuxStream(stream, {
        write: (chunk: Buffer) => {
          stdout += chunk.toString();
        },
      }, {
        write: (chunk: Buffer) => {
          stderr += chunk.toString();
        },
      });

      stream.on("end", () => {
        if (timeout) clearTimeout(timeout);
        resolve();
      });

      stream.on("error", (err: Error) => {
        if (timeout) clearTimeout(timeout);
        reject(err);
      });
    });

    const inspect = await exec.inspect();
    return {
      exitCode: inspect.ExitCode ?? 0,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      durationMs: Date.now() - startTime,
    };
  }

  async stop(sandboxId: string): Promise<void> {
    const info = this.containers.get(sandboxId);
    if (!info) return;

    try {
      const container = this.docker.getContainer(info.containerId);
      await container.stop({ t: 10 });
    } catch {
      // container may already be removed (AutoRemove)
    }

    info.status = "stopped";
    this.containers.delete(sandboxId);
  }

  async stopAll(): Promise<void> {
    const ids = Array.from(this.containers.keys());
    await Promise.all(ids.map((id) => this.stop(id)));
  }

  getSandbox(sandboxId: string): SandboxInfo | undefined {
    return this.containers.get(sandboxId);
  }

  listSandboxes(): SandboxInfo[] {
    return Array.from(this.containers.values());
  }
}

// ─── Simple (Non-Docker) Sandbox ─────────────────────────────────────

/**
 * Fallback sandbox that uses child_process when Docker is unavailable.
 * Provides limited isolation but works everywhere.
 */
import { execSync, exec as execAsync } from "child_process";

export class ProcessSandbox {
  private tempDirs = new Set<string>();

  createWorkdir(): string {
    const dir = path.join(
      process.env.TEMP || process.env.TMP || "/tmp",
      `openstar-sandbox-${Date.now().toString(36)}`
    );
    fs.mkdirSync(dir, { recursive: true });
    this.tempDirs.add(dir);
    return dir;
  }

  exec(
    command: string,
    options?: { cwd?: string; env?: Record<string, string>; timeoutSeconds?: number }
  ): SandboxExecResult {
    const startTime = Date.now();
    try {
      const stdout = execSync(command, {
        cwd: options?.cwd,
        env: { ...process.env, ...options?.env },
        timeout: (options?.timeoutSeconds ?? 60) * 1000,
        encoding: "utf-8",
      });
      return {
        exitCode: 0,
        stdout: stdout.trim(),
        stderr: "",
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const e = error as { stdout?: Buffer; stderr?: Buffer; status?: number };
      return {
        exitCode: e.status ?? 1,
        stdout: e.stdout?.toString()?.trim() ?? "",
        stderr: e.stderr?.toString()?.trim() ?? String(error),
        durationMs: Date.now() - startTime,
      };
    }
  }

  cleanup(): void {
    for (const dir of this.tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    this.tempDirs.clear();
  }
}

// ─── Unified Sandbox ─────────────────────────────────────────────────

export type SandboxMode = "docker" | "process" | "auto";

export class SandboxManager {
  private mode: SandboxMode;
  private docker: DockerSandbox | null = null;
  private process: ProcessSandbox | null = null;

  constructor(mode: SandboxMode = "auto") {
    this.mode = mode;
  }

  async initialize(): Promise<SandboxMode> {
    if (this.mode === "docker" || this.mode === "auto") {
      this.docker = new DockerSandbox();
      if (await this.docker.isAvailable()) {
        this.mode = "docker";
        return "docker";
      }
    }
    this.mode = "process";
    this.process = new ProcessSandbox();
    return "process";
  }

  async createSandbox(config?: SandboxConfig): Promise<SandboxInfo | { workdir: string }> {
    if (this.mode === "docker" && this.docker) {
      return this.docker.create(config);
    }
    const workdir = this.process?.createWorkdir() ?? "/tmp";
    return { workdir };
  }

  async execInSandbox(
    sandbox: SandboxInfo | { workdir: string },
    command: string,
    options?: { timeoutSeconds?: number }
  ): Promise<SandboxExecResult> {
    if (this.mode === "docker" && "containerId" in sandbox && this.docker) {
      return this.docker.exec(sandbox.id, ["sh", "-c", command], options);
    }
    if (this.process) {
      return this.process.exec(command, {
        cwd: (sandbox as { workdir: string }).workdir,
        timeoutSeconds: options?.timeoutSeconds,
      });
    }
    throw new Error("No sandbox available");
  }

  async destroySandbox(sandbox: SandboxInfo | { workdir: string }): Promise<void> {
    if (this.mode === "docker" && "containerId" in sandbox && this.docker) {
      await this.docker.stop(sandbox.id);
    }
  }

  async cleanup(): Promise<void> {
    if (this.docker) await this.docker.stopAll();
    if (this.process) this.process.cleanup();
  }
}
