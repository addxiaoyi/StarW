"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  StarCoreBridge,
  resolveEngineLaunch,
} = require("../src/starcore-bridge.cjs");

test("development launch uses Bun and the minimal engine source", () => {
  const desktopDir = path.resolve("packages/desktop-electron");
  const projectRoot = path.resolve(".");
  const launch = resolveEngineLaunch({
    desktopDir,
    projectRoot,
    bunExecutable: "bun-test",
  });

  assert.equal(launch.command, "bun-test");
  assert.deepEqual(launch.args, [path.join(desktopDir, "src", "engine.ts")]);
  assert.equal(launch.cwd, projectRoot);
  assert.deepEqual(launch.env, {
    STARCORE_DATA_DIR: projectRoot,
    OPENSTAR_WORKSPACE: projectRoot,
  });
});

test("packaged launch uses the Electron executable in Node mode", () => {
  const resourcesPath = path.resolve("tmp/resources");
  const executablePath = path.resolve("tmp/OpenStar.exe");
  const projectRoot = path.resolve("tmp/user-data");
  const launch = resolveEngineLaunch({
    isPackaged: true,
    resourcesPath,
    executablePath,
    projectRoot,
  });

  assert.equal(launch.command, executablePath);
  assert.deepEqual(launch.args, [
    path.join(resourcesPath, "engine", "openstar-engine.mjs"),
  ]);
  assert.equal(launch.cwd, projectRoot);
  assert.deepEqual(launch.env, {
    ELECTRON_RUN_AS_NODE: "1",
    STARCORE_DATA_DIR: projectRoot,
    OPENSTAR_WORKSPACE: projectRoot,
  });
});

test("packaged launch requires explicit runtime paths", () => {
  assert.throws(
    () => resolveEngineLaunch({ isPackaged: true }),
    /resourcesPath/,
  );
  assert.throws(
    () =>
      resolveEngineLaunch({
        isPackaged: true,
        resourcesPath: path.resolve("resources"),
      }),
    /executablePath/,
  );
});

test("bridge reports unavailable without spawning when the engine entry is missing", async () => {
  let spawned = false;
  const bridge = new StarCoreBridge({
    desktopDir: path.resolve("missing-desktop"),
    spawnImpl: () => {
      spawned = true;
      throw new Error("must not spawn");
    },
  });
  const errors = [];
  bridge.onError((message) => errors.push(message));

  assert.equal(await bridge.start(), "unavailable");
  assert.equal(spawned, false);
  assert.match(errors[0], /engine entry is missing/);
});
