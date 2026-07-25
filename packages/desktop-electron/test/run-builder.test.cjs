"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  applyNativeRebuildPolicy,
  findElectronArchive,
  hasElectronDistArgument,
  hasNpmRebuildArgument,
  inferTargetArch,
  inferTargetPlatform,
} = require("../scripts/run-builder.cjs");

test("infers a single target platform and rejects mixed targets", () => {
  assert.equal(inferTargetPlatform(["--win"]), "win32");
  assert.equal(inferTargetPlatform(["--linux"]), "linux");
  assert.equal(inferTargetPlatform(["--win", "--linux"]), null);
  assert.equal(inferTargetPlatform([]), process.platform);
});

test("infers explicit architecture before the host architecture", () => {
  assert.equal(inferTargetArch(["--arm64"]), "arm64");
  assert.equal(inferTargetArch([]), process.arch);
});

test("finds a nested Electron archive by exact file name", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "openstar-electron-dist-"),
  );
  try {
    const nested = path.join(root, "cache-key");
    fs.mkdirSync(nested);
    const archive = path.join(nested, "electron-v43.1.0-win32-x64.zip");
    fs.writeFileSync(archive, "test");
    assert.equal(
      findElectronArchive(root, "electron-v43.1.0-win32-x64.zip"),
      archive,
    );
    assert.equal(
      findElectronArchive(root, "electron-v43.1.0-linux-x64.zip"),
      null,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("recognizes explicit electronDist command-line configuration", () => {
  assert.equal(
    hasElectronDistArgument(["--config.electronDist=C:/electron.zip"]),
    true,
  );
  assert.equal(
    hasElectronDistArgument(["--config.electronDist", "C:/electron.zip"]),
    true,
  );
  assert.equal(hasElectronDistArgument(["--win"]), false);
});

test("uses bundled node-pty prebuilds for Windows without affecting other targets", () => {
  assert.deepEqual(applyNativeRebuildPolicy(["--win"]), [
    "--win",
    "--config.npmRebuild=false",
  ]);
  assert.deepEqual(applyNativeRebuildPolicy(["--linux"]), ["--linux"]);
  assert.deepEqual(applyNativeRebuildPolicy(["--mac"]), ["--mac"]);
  assert.deepEqual(
    applyNativeRebuildPolicy(["--win", "--config.npmRebuild=true"]),
    ["--win", "--config.npmRebuild=true"],
  );
  assert.equal(hasNpmRebuildArgument(["--config.npmRebuild=false"]), true);
});
