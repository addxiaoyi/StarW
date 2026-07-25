"use strict";

const fs = require("node:fs");
const path = require("node:path");

const platform = process.argv[2];
if (!["windows", "mac", "linux"].includes(platform)) {
  throw new Error(
    "Usage: node scripts/verify-artifacts.cjs <windows|mac|linux>",
  );
}

const desktopDir = path.resolve(__dirname, "..");
const distDir = path.join(desktopDir, "dist");
if (!fs.existsSync(distDir)) {
  throw new Error("Desktop dist directory is missing");
}

function walk(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(absolute);
      else files.push(absolute);
    }
  }
  return files;
}

const files = walk(distDir);
const normalized = files.map((file) => file.replaceAll("\\", "/"));
const topLevelFiles = fs
  .readdirSync(distDir, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => path.join(distDir, entry.name));

let releaseArtifacts;
let artifactLabel;
if (platform === "windows") {
  const executables = topLevelFiles.filter((file) => file.endsWith(".exe"));
  releaseArtifacts = executables.filter((file) =>
    /-portable-win-(x64|arm64)\.exe$/i.test(path.basename(file)),
  );
  const nonPortable = executables.filter(
    (file) => !releaseArtifacts.includes(file),
  );
  if (nonPortable.length > 0) {
    throw new Error(
      `Non-portable Windows executable(s) found: ${nonPortable.map((file) => path.basename(file)).join(", ")}`,
    );
  }
  artifactLabel = "portable executable";
} else {
  const extension = platform === "mac" ? ".dmg" : ".AppImage";
  releaseArtifacts = topLevelFiles.filter((file) => file.endsWith(extension));
  artifactLabel = `artifact with extension ${extension}`;
}
if (releaseArtifacts.length === 0) {
  throw new Error(`No top-level ${platform} ${artifactLabel} was produced`);
}

for (const suffix of [
  "/resources/app.asar",
  "/resources/engine/openstar-engine.mjs",
  "/resources/ui-web/index.html",
]) {
  if (!normalized.some((file) => file.endsWith(suffix))) {
    throw new Error(`Packaged resource is missing: ${suffix}`);
  }
}

if (platform === "windows") {
  const nativePty = normalized.some(
    (file) =>
      file.includes("/resources/app.asar.unpacked/node_modules/node-pty/") &&
      file.endsWith(".node"),
  );
  if (!nativePty) {
    throw new Error(
      "Packaged node-pty native module is missing from app.asar.unpacked",
    );
  }
}

console.log(
  `Desktop ${platform} artifacts verified: ${releaseArtifacts.length} ${artifactLabel}(s), ${files.length} files scanned`,
);
