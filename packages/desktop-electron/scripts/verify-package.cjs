"use strict";

const fs = require("node:fs");
const path = require("node:path");

const desktopDir = path.resolve(__dirname, "..");

function fail(message) {
  throw new Error(`Package verification failed: ${message}`);
}

function requireFile(relativePath) {
  const absolutePath = path.join(desktopDir, relativePath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    fail(`missing file ${relativePath}`);
  }
  return absolutePath;
}

const packageJson = JSON.parse(
  fs.readFileSync(path.join(desktopDir, "package.json"), "utf8"),
);
requireFile(packageJson.main);
for (const relativePath of [
  "src/main.cjs",
  "src/preload.js",
  "src/ipc-policy.cjs",
  "src/starcore-bridge.cjs",
  "src/terminal-manager.cjs",
  "src/window-target.cjs",
  "src/engine.ts",
  "src/engine-agent.ts",
  "scripts/smoke-electron-pty.cjs",
  "build/engine/openstar-engine.mjs",
  "../ui-web/dist/index.html",
  "assets/icon.png",
  "assets/icon.ico",
]) {
  requireFile(relativePath);
}

const png = fs.readFileSync(path.join(desktopDir, "assets/icon.png"));
if (
  png.length < 24 ||
  png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
) {
  fail("assets/icon.png is not a valid PNG header");
}
const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
if (width < 512 || height < 512) {
  fail(`assets/icon.png must be at least 512x512, found ${width}x${height}`);
}

const ico = fs.readFileSync(path.join(desktopDir, "assets/icon.ico"));
if (
  ico.length < 22 ||
  ico.readUInt16LE(0) !== 0 ||
  ico.readUInt16LE(2) !== 1 ||
  ico.readUInt16LE(4) < 1
) {
  fail("assets/icon.ico has an invalid ICO header");
}

if (!packageJson.dependencies?.["node-pty"]) {
  fail("package.json is missing the node-pty runtime dependency");
}

const builderConfig = fs.readFileSync(
  path.join(desktopDir, "electron-builder.yml"),
  "utf8",
);
for (const required of [
  "from: ../ui-web/dist",
  "to: ui-web",
  "from: build/engine",
  "to: engine",
  "icon: assets/icon.ico",
  "icon: assets/icon.png",
  "node_modules/node-pty/**/*",
]) {
  if (!builderConfig.includes(required))
    fail(`electron-builder.yml is missing: ${required}`);
}
for (const forbidden of ["assets/icon.icns", "assets/icons"]) {
  if (builderConfig.includes(forbidden))
    fail(`electron-builder.yml references missing asset: ${forbidden}`);
}

console.log(
  `Package inputs verified: main=${packageJson.main}, icon=${width}x${height}, engine=build/engine/openstar-engine.mjs`,
);
