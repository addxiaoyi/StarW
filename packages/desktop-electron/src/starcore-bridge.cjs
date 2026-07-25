"use strict";

const { spawn: spawnProcess } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function debug(message) {
  try {
    console.error(`[starcore-bridge] ${message}`);
  } catch {
    // Logging must not affect the bridge.
  }
}

function resolveEngineLaunch(options = {}) {
  const desktopDir = path.resolve(
    options.desktopDir || path.resolve(__dirname, ".."),
  );
  const projectRoot = path.resolve(
    options.projectRoot || path.resolve(desktopDir, "../.."),
  );
  const dataDir = path.resolve(options.dataDir || projectRoot);

  if (options.isPackaged) {
    if (!options.resourcesPath)
      throw new Error("Packaged engine requires resourcesPath");
    if (!options.executablePath)
      throw new Error("Packaged engine requires executablePath");
    return {
      command: path.resolve(options.executablePath),
      args: [
        path.join(
          path.resolve(options.resourcesPath),
          "engine",
          "openstar-engine.mjs",
        ),
      ],
      cwd: projectRoot,
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        STARCORE_DATA_DIR: dataDir,
        OPENSTAR_WORKSPACE: projectRoot,
        ...(options.secretKey ? { STARCORE_SECRET_KEY: options.secretKey } : {}),
      },
    };
  }

  return {
    command: options.bunExecutable || "bun",
    args: [path.join(desktopDir, "src", "engine.ts")],
    cwd: projectRoot,
    env: {
      STARCORE_DATA_DIR: dataDir,
      OPENSTAR_WORKSPACE: projectRoot,
      ...(options.secretKey ? { STARCORE_SECRET_KEY: options.secretKey } : {}),
    },
  };
}

class StarCoreBridge {
  constructor(options = {}) {
    this.proc = null;
    this.mode = "unavailable";
    this.nextId = 1;
    this.pending = new Map();
    this.errorHandlers = new Set();
    this.eventHandlers = new Set();
    this.expectedExits = new WeakSet();
    this.buffer = "";
    this.launch = resolveEngineLaunch(options);
    this.spawnImpl = options.spawnImpl || spawnProcess;
    this.requestTimeoutMs = options.requestTimeoutMs || 60000;
    this.readinessTimeoutMs = options.readinessTimeoutMs || 5000;
  }

  start() {
    return new Promise((resolve) => {
      let settled = false;
      let readinessTimer = null;
      const finish = (mode) => {
        if (settled) return;
        settled = true;
        if (readinessTimer) clearTimeout(readinessTimer);
        this.mode = mode;
        debug(`started in ${mode} mode`);
        resolve(mode);
      };

      const engineEntry = this.launch.args[0];
      if (!fs.existsSync(engineEntry)) {
        this._emitError(`engine entry is missing: ${engineEntry}`);
        finish("unavailable");
        return;
      }

      let child;
      try {
        child = this.spawnImpl(this.launch.command, this.launch.args, {
          cwd: this.launch.cwd,
          env: { ...process.env, ...this.launch.env },
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch (error) {
        this._emitError(
          `engine: ${error instanceof Error ? error.message : String(error)}`,
        );
        finish("unavailable");
        return;
      }

      this.proc = child;
      child.on("error", (error) => {
        this.mode = "unavailable";
        for (const [, pending] of this.pending) {
          clearTimeout(pending.timer);
          pending.reject(new Error(`engine: ${error.message}`));
        }
        this.pending.clear();
        this._emitError(`engine: ${error.message}`);
        finish("unavailable");
      });
      child.on("exit", (code, signal) => {
        const expectedExit = this.expectedExits.has(child);
        this.expectedExits.delete(child);
        for (const [, pending] of this.pending) {
          clearTimeout(pending.timer);
          pending.reject(new Error("engine exited"));
        }
        this.pending.clear();
        if (this.proc === child) this.proc = null;
        this.mode = "unavailable";
        if (!expectedExit) {
          this._emitError(`engine exited code=${code} signal=${signal}`);
        }
        finish("unavailable");
      });
      child.stderr.on("data", (data) => {
        const text = String(data).trim();
        if (text) debug(`[engine] ${text}`);
      });
      child.stdout.on("data", (chunk) => {
        this.buffer += chunk.toString();
        let newline;
        while ((newline = this.buffer.indexOf("\n")) >= 0) {
          const line = this.buffer.slice(0, newline).trim();
          this.buffer = this.buffer.slice(newline + 1);
          if (line) this._handleLine(line);
        }
      });

      this._send("ping", {})
        .then(() => finish("real"))
        .catch((error) => {
          this._emitError(`engine readiness failed: ${error.message}`);
          this._terminateChild();
          finish("unavailable");
        });

      readinessTimer = setTimeout(() => {
        if (!settled) {
          this._emitError("engine readiness timed out");
          this._terminateChild();
          finish("unavailable");
        }
      }, this.readinessTimeoutMs);
    });
  }

  _handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof message.event === "string") {
      this._emitEvent(message.event, message.payload);
      return;
    }
    if (message.id === null || message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(
        new Error(
          typeof message.error === "string"
            ? message.error
            : message.error.message || "RPC error",
        ),
      );
    } else {
      pending.resolve(message.result);
    }
  }

  _send(method, params, timeoutMs = this.requestTimeoutMs) {
    return new Promise((resolve, reject) => {
      if (!this.proc?.stdin || this.proc.stdin.destroyed) {
        reject(new Error("StarCore engine is unavailable"));
        return;
      }
      const id = String(this.nextId++);
      const timer = setTimeout(() => {
        if (this.pending.delete(id))
          reject(new Error(`request timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.proc.stdin.write(
          `${JSON.stringify({ id, method, params: params || {} })}\n`,
        );
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  _requireReal() {
    if (this.mode !== "real") throw new Error("StarCore engine is unavailable");
  }

  async request(method, params = {}, timeoutMs) {
    this._requireReal();
    if (typeof method !== "string" || !method.trim()) {
      throw new TypeError("RPC method must be a non-empty string");
    }
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      throw new TypeError("RPC params must be an object");
    }
    const effectiveTimeout =
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? Math.min(Math.floor(timeoutMs), 3_700_000)
        : /^(command\.|chat\.|sessions\/prompt|agent\.|swarm\.)/.test(method)
          ? 3_700_000
          : this.requestTimeoutMs;
    return this._send(method, params, effectiveTimeout);
  }

  async status() {
    return this.request("status", {});
  }

  async skills() {
    const result = await this.request("skills", {});
    return Array.isArray(result?.skills) ? result.skills : [];
  }

  async agents() {
    const result = await this.request("agents", {});
    return Array.isArray(result?.agents) ? result.agents : [];
  }

  async mcpStatus() {
    const result = await this.request("mcp-status", {});
    return result && typeof result === "object"
      ? result
      : { connected: 0, total: 0, servers: [], available: false };
  }

  onError(callback) {
    if (typeof callback !== "function") return () => {};
    this.errorHandlers.add(callback);
    return () => this.errorHandlers.delete(callback);
  }

  onEvent(callback) {
    if (typeof callback !== "function") return () => {};
    this.eventHandlers.add(callback);
    return () => this.eventHandlers.delete(callback);
  }

  _emitEvent(event, payload) {
    for (const callback of this.eventHandlers) {
      try {
        callback(event, payload);
      } catch {
        // One consumer must not block the others.
      }
    }
  }

  _emitError(message) {
    for (const callback of this.errorHandlers) {
      try {
        callback(message);
      } catch {
        // One consumer must not block the others.
      }
    }
  }

  _rejectPending(message) {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }

  _endChildStdin(proc) {
    try {
      if (proc?.stdin && !proc.stdin.destroyed) proc.stdin.end();
    } catch {
      // Ignore shutdown races.
    }
  }

  _killChild(proc) {
    try {
      if (proc && !proc.killed) proc.kill();
    } catch {
      // Ignore shutdown races.
    }
  }

  _terminateChild() {
    const proc = this.proc;
    if (!proc) return;
    this.expectedExits.add(proc);
    this._endChildStdin(proc);
    this._killChild(proc);
  }

  async stopGracefully(timeoutMs = 2000) {
    this._rejectPending("engine stopped");
    this.eventHandlers.clear();
    const proc = this.proc;
    this.proc = null;
    this.mode = "unavailable";
    if (!proc) return;

    this.expectedExits.add(proc);
    await new Promise((resolve) => {
      let settled = false;
      let killTimer;
      let hardTimer;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (killTimer) clearTimeout(killTimer);
        if (hardTimer) clearTimeout(hardTimer);
        proc.removeListener?.("exit", finish);
        resolve();
      };

      if (proc.exitCode !== null || proc.signalCode !== null) {
        finish();
        return;
      }
      proc.once?.("exit", finish);
      this._endChildStdin(proc);
      killTimer = setTimeout(
        () => this._killChild(proc),
        Math.max(100, timeoutMs),
      );
      hardTimer = setTimeout(finish, Math.max(1100, timeoutMs + 1000));
    });
  }

  stop() {
    this._rejectPending("engine stopped");
    this.eventHandlers.clear();
    const proc = this.proc;
    this.proc = null;
    this.mode = "unavailable";
    if (!proc) return;

    this.expectedExits.add(proc);
    this._endChildStdin(proc);
    const timer = setTimeout(() => this._killChild(proc), 500);
    timer.unref?.();
  }
}

module.exports = { StarCoreBridge, resolveEngineLaunch };
