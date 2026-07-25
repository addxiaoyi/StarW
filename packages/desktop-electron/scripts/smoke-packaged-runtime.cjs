"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { removePath } = require("./fs-utils.cjs");

const desktopDir = path.resolve(__dirname, "..");
const unpackedDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(desktopDir, "dist", "win-unpacked");
const executable = path.join(unpackedDir, "OpenStar.exe");
const engine = path.join(
  unpackedDir,
  "resources",
  "engine",
  "openstar-engine.mjs",
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  if (process.platform !== "win32") {
    throw new Error("Packaged runtime smoke is supported only on Windows");
  }

  assert(
    fs.existsSync(executable),
    `Packaged executable is missing: ${executable}`,
  );
  assert(fs.existsSync(engine), `Packaged engine is missing: ${engine}`);

  const smokeRoot = path.join(
    desktopDir,
    ".tmp",
    `packaged-runtime-${process.pid}`,
  );
  const workspace = path.join(smokeRoot, "workspace");
  const dataDir = path.join(smokeRoot, "data");

  removePath(smokeRoot);
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(workspace, "accept.txt"),
    "PACKAGED_FILE_OK\n",
    "utf8",
  );

  const child = spawn(executable, [engine], {
    cwd: workspace,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      OPENSTAR_WORKSPACE: workspace,
      STARCORE_DATA_DIR: dataDir,
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  let buffer = "";
  let stderr = "";
  let sequence = 0;
  const pending = new Map();

  const rejectAll = (error) => {
    for (const item of pending.values()) item.reject(error);
    pending.clear();
  };

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);

      if (message.event || message.id === null || message.id === undefined)
        continue;

      const entry = pending.get(String(message.id));
      if (!entry) continue;

      pending.delete(String(message.id));
      if (message.error) entry.reject(new Error(message.error));
      else entry.resolve(message.result);
    }
  });

  child.on("error", rejectAll);
  child.on("exit", (code, signal) => {
    if (pending.size) {
      rejectAll(
        new Error(
          `Packaged engine exited code=${code} signal=${signal}\n${stderr}`,
        ),
      );
    }
  });

  const request = (method, params = {}, timeoutMs = 20_000) =>
    new Promise((resolve, reject) => {
      const id = String(++sequence);
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Packaged RPC timed out: ${method}\n${stderr}`));
      }, timeoutMs);

      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });

  try {
    const command = await request("command.execute", {
      command: "echo PACKAGED_CMD_OK",
      cwd: ".",
    });
    assert(
      command.success === true,
      command.error || "Packaged command failed",
    );
    assert(
      String(command.output).includes("PACKAGED_CMD_OK"),
      "Packaged command output missing",
    );

    const read = await request("files/read", { path: "accept.txt" });
    assert(
      read.content === "PACKAGED_FILE_OK\n",
      "Packaged file read mismatch",
    );

    const config = await request("config/get");
    assert(
      !Object.values(config.providers || {}).some(
        (provider) =>
          provider &&
          typeof provider === "object" &&
          Object.hasOwn(provider, "apiKey"),
      ),
      "Packaged config leaked an API key",
    );

    assert(
      Array.isArray((await request("agents/list")).agents),
      "Packaged agents are missing",
    );
    assert(
      Array.isArray((await request("swarm.status")).workers),
      "Packaged Swarm is missing",
    );
    assert(
      Array.isArray((await request("mcp.status")).servers),
      "Packaged MCP status is missing",
    );

    console.log(
      "Packaged command/file/config/agent/swarm/MCP runtime smoke passed",
    );
  } finally {
    child.stdin.end();
    setTimeout(() => child.kill(), 1000).unref();
    await new Promise((resolve) => child.once("exit", resolve));
    removePath(smokeRoot);
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.stack || error.message : String(error),
  );
  process.exitCode = 1;
});
