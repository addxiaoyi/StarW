"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { removePath } = require("./fs-utils.cjs");

const platform = process.argv[2];
if (!["windows", "mac", "linux", "all"].includes(platform)) {
  throw new Error(
    "Usage: node scripts/clean-output.cjs <windows|mac|linux|all>",
  );
}

const distDir = path.resolve(__dirname, "..", "dist");
if (!fs.existsSync(distDir)) process.exit(0);

const shouldDelete = (entry) => {
  const name = entry.name;
  if (platform === "all") return true;
  if (platform === "windows") {
    return (
      name === "win-unpacked" ||
      name.startsWith("win-") ||
      name.endsWith(".exe") ||
      name.endsWith(".exe.blockmap")
    );
  }
  if (platform === "mac") {
    return (
      name === "mac" ||
      name.startsWith("mac-") ||
      name.endsWith(".dmg") ||
      name.endsWith(".zip")
    );
  }
  return (
    name === "linux-unpacked" ||
    name.startsWith("linux-") ||
    name.endsWith(".AppImage")
  );
};

let removed = 0;
for (const entry of fs.readdirSync(distDir, { withFileTypes: true })) {
  if (!shouldDelete(entry)) continue;
  const target = path.join(distDir, entry.name);
  removePath(target);
  removed += 1;
}

console.log(`Cleaned ${removed} ${platform} desktop output item(s)`);
