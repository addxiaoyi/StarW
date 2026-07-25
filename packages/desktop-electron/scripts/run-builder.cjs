"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const desktopDir = path.resolve(__dirname, "..");

function inferTargetPlatform(args) {
  const flags = [
    ["--win", "win32"],
    ["--windows", "win32"],
    ["--mac", "darwin"],
    ["--macos", "darwin"],
    ["--linux", "linux"],
  ];
  const selected = new Set(
    flags
      .filter(([flag]) => args.includes(flag))
      .map(([, platform]) => platform),
  );
  if (selected.size > 1) return null;
  return selected.values().next().value || process.platform;
}

function inferTargetArch(args) {
  for (const arch of ["x64", "arm64", "ia32", "armv7l", "universal"]) {
    if (args.includes(`--${arch}`)) return arch;
  }
  return process.arch;
}

function findElectronArchive(root, fileName, maxDepth = 4) {
  if (!fs.existsSync(root)) return null;
  const stack = [{ directory: root, depth: 0 }];
  while (stack.length > 0) {
    const { directory, depth } = stack.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isFile() && entry.name === fileName) return absolute;
      if (entry.isDirectory() && depth < maxDepth) {
        stack.push({ directory: absolute, depth: depth + 1 });
      }
    }
  }
  return null;
}

function hasElectronDistArgument(args) {
  return args.some(
    (argument, index) =>
      argument.startsWith("--config.electronDist=") ||
      (argument === "--config.electronDist" && index < args.length - 1),
  );
}

function hasNpmRebuildArgument(args) {
  return args.some(
    (argument, index) =>
      argument.startsWith("--config.npmRebuild=") ||
      (argument === "--config.npmRebuild" && index < args.length - 1),
  );
}

function applyNativeRebuildPolicy(args) {
  const result = [...args];
  if (
    inferTargetPlatform(result) === "win32" &&
    !hasNpmRebuildArgument(result)
  ) {
    result.push("--config.npmRebuild=false");
  }
  return result;
}

function resolveLocalElectronArchive(args, env = process.env) {
  if (env.OPENSTAR_ELECTRON_DIST) {
    const explicit = path.resolve(env.OPENSTAR_ELECTRON_DIST);
    if (!fs.existsSync(explicit)) {
      throw new Error(`OPENSTAR_ELECTRON_DIST does not exist: ${explicit}`);
    }
    return explicit;
  }

  if (env.OPENSTAR_USE_LOCAL_ELECTRON_DIST === "0") return null;

  const targetPlatform = inferTargetPlatform(args);
  const targetArch = inferTargetArch(args);
  if (!targetPlatform || targetPlatform !== process.platform) return null;

  const hasExplicitArch = ["x64", "arm64", "ia32", "armv7l", "universal"].some(
    (arch) => args.includes(`--${arch}`),
  );
  if (
    targetPlatform === "darwin" &&
    args.includes("--mac") &&
    !hasExplicitArch
  ) {
    // The checked-in mac configuration builds both x64 and arm64. A single local
    // Electron archive must not be reused for both architectures.
    return null;
  }

  const electronPackageJsonPath = require.resolve("electron/package.json", {
    paths: [desktopDir],
  });
  const electronPackageRoot = path.dirname(electronPackageJsonPath);
  const electronPackage = JSON.parse(
    fs.readFileSync(electronPackageJsonPath, "utf8"),
  );
  const archiveName = `electron-v${electronPackage.version}-${targetPlatform}-${targetArch}.zip`;
  return findElectronArchive(
    path.join(electronPackageRoot, "dist"),
    archiveName,
  );
}

function resolveBuilderCli() {
  const packageJsonPath = require.resolve("electron-builder/package.json", {
    paths: [desktopDir],
  });
  const packageRoot = path.dirname(packageJsonPath);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const bin =
    typeof packageJson.bin === "string"
      ? packageJson.bin
      : packageJson.bin?.["electron-builder"] || packageJson.bin?.builder;
  if (!bin)
    throw new Error("electron-builder package does not expose a CLI entry");
  return path.resolve(packageRoot, bin);
}

function runBuilder(args = process.argv.slice(2), env = process.env) {
  const builderArgs = applyNativeRebuildPolicy(args);
  if (!hasElectronDistArgument(builderArgs)) {
    const localArchive = resolveLocalElectronArchive(builderArgs, env);
    if (localArchive) {
      builderArgs.push(`--config.electronDist=${localArchive}`);
      console.log(
        `[openstar-builder] using local Electron archive: ${localArchive}`,
      );
    } else if (env.OPENSTAR_OFFLINE === "1") {
      throw new Error(
        "OPENSTAR_OFFLINE=1 but no matching local Electron archive was found. " +
          "Set OPENSTAR_ELECTRON_DIST to an Electron zip, cache directory, or build directory.",
      );
    } else {
      console.log(
        "[openstar-builder] no matching local Electron archive; network fallback enabled",
      );
    }
  }

  const result = spawnSync(
    process.execPath,
    [resolveBuilderCli(), ...builderArgs],
    {
      cwd: desktopDir,
      env,
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (require.main === module) {
  try {
    process.exitCode = runBuilder();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  applyNativeRebuildPolicy,
  findElectronArchive,
  hasElectronDistArgument,
  hasNpmRebuildArgument,
  inferTargetArch,
  inferTargetPlatform,
  resolveLocalElectronArchive,
  runBuilder,
};
