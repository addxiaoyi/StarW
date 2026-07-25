"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const path = require("node:path");
const {
  StarCoreBridge,
  resolveEngineLaunch,
} = require("../src/starcore-bridge.cjs");

test("launch config forwards workspace and portable data paths", () => {
  const projectRoot = path.resolve("D:/workspace");
  const dataDir = path.resolve("D:/portable-data");
  const launch = resolveEngineLaunch({
    isPackaged: true,
    resourcesPath: path.resolve("D:/resources"),
    executablePath: path.resolve("D:/OpenStar.exe"),
    desktopDir: path.resolve(__dirname, ".."),
    projectRoot,
    dataDir,
  });
  assert.equal(launch.env.OPENSTAR_WORKSPACE, projectRoot);
  assert.equal(launch.env.STARCORE_DATA_DIR, dataDir);
  assert.equal(launch.env.ELECTRON_RUN_AS_NODE, "1");
});

test("generic request writes JSON RPC and resolves the matching response", async () => {
  const bridge = new StarCoreBridge({ requestTimeoutMs: 1000 });
  let written = "";
  bridge.mode = "real";
  bridge.proc = {
    killed: false,
    kill() {},
    stdin: {
      destroyed: false,
      end() {},
      write(value) {
        written += value;
      },
    },
  };

  const pending = bridge.request("config/get", { include: "providers" });
  const request = JSON.parse(written.trim());
  assert.equal(request.method, "config/get");
  assert.deepEqual(request.params, { include: "providers" });
  bridge._handleLine(
    JSON.stringify({ id: request.id, result: { workspace: "D:/workspace" } }),
  );
  assert.deepEqual(await pending, { workspace: "D:/workspace" });
  bridge.stop();
});

test("graceful stop closes Engine stdin without immediately killing it", async () => {
  const bridge = new StarCoreBridge();
  const proc = new EventEmitter();
  let stdinEnded = false;
  let killed = false;
  proc.exitCode = null;
  proc.signalCode = null;
  proc.killed = false;
  proc.stdin = {
    destroyed: false,
    end() {
      stdinEnded = true;
      queueMicrotask(() => {
        proc.exitCode = 0;
        proc.emit("exit", 0, null);
      });
    },
  };
  proc.kill = () => {
    killed = true;
    proc.killed = true;
  };
  bridge.proc = proc;
  bridge.mode = "real";

  await bridge.stopGracefully(100);

  assert.equal(stdinEnded, true);
  assert.equal(killed, false);
  assert.equal(bridge.proc, null);
  assert.equal(bridge.mode, "unavailable");
});

test("engine events are delivered independently from request responses", () => {
  const bridge = new StarCoreBridge();
  const events = [];
  const unsubscribe = bridge.onEvent((event, payload) =>
    events.push({ event, payload }),
  );
  bridge._handleLine(
    JSON.stringify({ event: "command.output", payload: { text: "ok" } }),
  );
  unsubscribe();
  bridge._handleLine(
    JSON.stringify({ event: "command.output", payload: { text: "ignored" } }),
  );
  assert.deepEqual(events, [
    { event: "command.output", payload: { text: "ok" } },
  ]);
});
