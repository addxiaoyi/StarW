"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MIN_COLUMNS = 2;
const MAX_COLUMNS = 500;
const MIN_ROWS = 1;
const MAX_ROWS = 300;
const MAX_INPUT_BYTES = 1024 * 1024;

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(Math.trunc(parsed), maximum));
}

function normalizeSessionId(value) {
  const sessionId = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(sessionId)) {
    throw new Error("Terminal session id is invalid");
  }
  return sessionId;
}

function normalizeEnvironment(source) {
  const result = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

function defaultShell(platform, env) {
  if (platform === "win32") {
    return {
      executable: env.OPENSTAR_SHELL || env.ComSpec || env.COMSPEC || "cmd.exe",
      args: [],
    };
  }
  return {
    executable:
      env.OPENSTAR_SHELL ||
      env.SHELL ||
      (platform === "darwin" ? "/bin/zsh" : "/bin/bash"),
    args: [],
  };
}

class TerminalManager {
  constructor(options = {}) {
    this.platform = options.platform || process.platform;
    this.environment = normalizeEnvironment(options.env || process.env);
    this.workspace = path.resolve(options.workspace || process.cwd());
    this.onEvent =
      typeof options.onEvent === "function" ? options.onEvent : () => {};
    this.spawnPty =
      options.spawnPty ||
      ((executable, args, spawnOptions) =>
        require("node-pty").spawn(executable, args, spawnOptions));
    this.sessions = new Map();
  }

  updateWorkspace(workspace) {
    if (typeof workspace !== "string" || !workspace.trim()) return;
    this.workspace = path.resolve(workspace);
  }

  resolveCwd(requested) {
    const value =
      typeof requested === "string" && requested.trim() ? requested : ".";
    const candidate = path.resolve(this.workspace, value);
    const relative = path.relative(this.workspace, candidate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(
        "Terminal working directory must remain inside the workspace",
      );
    }
    const stat = fs.statSync(candidate);
    if (!stat.isDirectory())
      throw new Error("Terminal working directory is not a directory");
    return candidate;
  }

  create(params = {}) {
    const sessionId = normalizeSessionId(params.sessionId);
    const existing = this.sessions.get(sessionId);
    if (existing) {
      this.dispose({ sessionId, instanceId: existing.instanceId });
    }

    const cwd = this.resolveCwd(params.cwd);
    const cols = boundedInteger(params.cols, 80, MIN_COLUMNS, MAX_COLUMNS);
    const rows = boundedInteger(params.rows, 24, MIN_ROWS, MAX_ROWS);
    const shell = defaultShell(this.platform, this.environment);
    const instanceId = crypto.randomUUID();
    const environment = {
      ...this.environment,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      TERM_PROGRAM: "OpenStar",
      OPENSTAR_WORKSPACE: this.workspace,
    };
    const terminal = this.spawnPty(shell.executable, shell.args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: environment,
      useConpty: this.platform === "win32",
    });
    const record = {
      sessionId,
      instanceId,
      terminal,
      cwd,
      cols,
      rows,
      shell: shell.executable,
      startedAt: Date.now(),
    };
    this.sessions.set(sessionId, record);

    terminal.onData((data) => {
      this.onEvent("terminal.output", { sessionId, instanceId, data });
    });
    terminal.onExit((event) => {
      if (this.sessions.get(sessionId) === record) {
        this.sessions.delete(sessionId);
      }
      this.onEvent("terminal.exit", {
        sessionId,
        instanceId,
        exitCode: event.exitCode,
        signal: event.signal,
        durationMs: Date.now() - record.startedAt,
      });
    });

    const result = {
      sessionId,
      instanceId,
      pid: terminal.pid,
      cwd,
      cols,
      rows,
      shell: shell.executable,
    };
    this.onEvent("terminal.started", result);
    return result;
  }

  getRecord(params = {}) {
    const sessionId = normalizeSessionId(params.sessionId);
    const record = this.sessions.get(sessionId);
    if (!record)
      throw new Error(`Terminal session is unavailable: ${sessionId}`);
    if (
      typeof params.instanceId === "string" &&
      params.instanceId &&
      params.instanceId !== record.instanceId
    ) {
      throw new Error(`Terminal session instance is stale: ${sessionId}`);
    }
    return record;
  }

  write(params = {}) {
    const record = this.getRecord(params);
    const data = typeof params.data === "string" ? params.data : "";
    if (!data) return { written: 0 };
    const bytes = Buffer.byteLength(data);
    if (bytes > MAX_INPUT_BYTES) {
      throw new Error("Terminal input exceeds the 1 MiB safety limit");
    }
    record.terminal.write(data);
    return { written: bytes };
  }

  resize(params = {}) {
    const record = this.getRecord(params);
    const cols = boundedInteger(
      params.cols,
      record.cols,
      MIN_COLUMNS,
      MAX_COLUMNS,
    );
    const rows = boundedInteger(params.rows, record.rows, MIN_ROWS, MAX_ROWS);
    record.terminal.resize(cols, rows);
    record.cols = cols;
    record.rows = rows;
    return { resized: true, cols, rows };
  }

  dispose(params = {}) {
    const sessionId = normalizeSessionId(params.sessionId);
    const record = this.sessions.get(sessionId);
    if (!record) return { disposed: false };
    if (
      typeof params.instanceId === "string" &&
      params.instanceId &&
      params.instanceId !== record.instanceId
    ) {
      return { disposed: false };
    }
    this.sessions.delete(sessionId);
    try {
      record.terminal.kill();
    } catch {
      // Ignore process exit races.
    }
    return { disposed: true };
  }

  disposeAll() {
    const records = [...this.sessions.values()];
    this.sessions.clear();
    for (const record of records) {
      try {
        record.terminal.kill();
      } catch {
        // Ignore process exit races.
      }
    }
  }

  status() {
    return {
      sessions: [...this.sessions.values()].map((record) => ({
        sessionId: record.sessionId,
        instanceId: record.instanceId,
        pid: record.terminal.pid,
        cwd: record.cwd,
        cols: record.cols,
        rows: record.rows,
        shell: record.shell,
      })),
    };
  }

  request(method, params = {}) {
    switch (method) {
      case "terminal.create":
        return this.create(params);
      case "terminal.write":
        return this.write(params);
      case "terminal.resize":
        return this.resize(params);
      case "terminal.dispose":
        return this.dispose(params);
      case "terminal.status":
        return this.status();
      default:
        throw new Error(`Unsupported terminal method: ${String(method)}`);
    }
  }
}

module.exports = {
  TerminalManager,
  boundedInteger,
  defaultShell,
  normalizeSessionId,
};
