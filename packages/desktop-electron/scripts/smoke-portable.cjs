"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { removePath } = require("./fs-utils.cjs");

const desktopDir = path.resolve(__dirname, "..");
const distDir = path.join(desktopDir, "dist");

function findPortableExecutable() {
  if (!fs.existsSync(distDir)) return null;
  const candidates = fs
    .readdirSync(distDir)
    .filter((name) => /^OpenStar-.*-portable-win-(x64|arm64)\.exe$/i.test(name))
    .map((name) => path.join(distDir, name))
    .sort(
      (left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs,
    );
  return candidates[0] || null;
}

function portableEnvironment(smokeRoot) {
  const env = { ...process.env };
  const tempRoot = env.TEMP || env.TMP || os.tmpdir();
  const inferredDrive = path
    .parse(env.SystemRoot || env.WINDIR || tempRoot)
    .root.replace(/[\\/]+$/, "");
  const systemDrive = env.SystemDrive || inferredDrive || "C:";

  env.SystemDrive = systemDrive;
  env.ProgramData ||= path.join(`${systemDrive}\\`, "ProgramData");
  env.LOCALAPPDATA ||= path.dirname(tempRoot);
  env.OPENSTAR_PORTABLE_DATA_DIR = smokeRoot;
  env.OPENSTAR_WORKSPACE = smokeRoot;
  return env;
}

function runPortable(executablePath, smokeRoot, mode) {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, [mode], {
      cwd: path.dirname(executablePath),
      env: portableEnvironment(smokeRoot),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => finish(error));
    child.on("exit", (code, signal) => {
      finish(null, { code, signal, stdout, stderr });
    });

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Ignore shutdown races.
      }
      finish(new Error(`Portable executable smoke timed out: ${mode}`));
    }, 60000);
  });
}

async function main() {
  if (process.platform !== "win32") {
    throw new Error("Portable executable smoke is supported only on Windows");
  }

  const executablePath = process.argv[2]
    ? path.resolve(process.argv[2])
    : findPortableExecutable();
  if (!executablePath || !fs.existsSync(executablePath)) {
    throw new Error(
      "Windows portable executable not found. Run the Windows portable build first.",
    );
  }

  const smokeRoot = path.join(
    desktopDir,
    ".tmp",
    `portable-smoke-${process.pid}`,
  );
  removePath(smokeRoot);
  fs.mkdirSync(smokeRoot, { recursive: true });
  const smokeExecutable = path.join(smokeRoot, path.basename(executablePath));
  fs.copyFileSync(executablePath, smokeExecutable);

  try {
    const result = await runPortable(
      smokeExecutable,
      smokeRoot,
      "--openstar-portable-smoke",
    );
    const markerPath = path.join(
      smokeRoot,
      "OpenStar-Data",
      "portable-smoke.json",
    );
    if (result.code !== 0) {
      throw new Error(
        `Portable executable exited with code=${result.code} signal=${result.signal}\n${result.stderr.trim()}`,
      );
    }
    if (!fs.existsSync(markerPath)) {
      throw new Error(
        `Portable smoke marker is missing: ${markerPath}\nstdout=${result.stdout.trim()}\nstderr=${result.stderr.trim()}`,
      );
    }

    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    if (
      marker.ok !== true ||
      marker.packaged !== true ||
      marker.engineMode !== "real"
    ) {
      throw new Error(
        `Invalid portable smoke marker: ${JSON.stringify(marker)}`,
      );
    }

    const ptyResult = await runPortable(
      smokeExecutable,
      smokeRoot,
      "--openstar-pty-smoke",
    );
    const ptyMarkerPath = path.join(
      smokeRoot,
      "OpenStar-Data",
      "pty-smoke.json",
    );
    if (ptyResult.code !== 0) {
      throw new Error(
        `Portable PTY smoke exited with code=${ptyResult.code} signal=${ptyResult.signal}\n${ptyResult.stderr.trim()}`,
      );
    }
    if (!fs.existsSync(ptyMarkerPath)) {
      throw new Error(
        `Portable PTY marker is missing: ${ptyMarkerPath}\nstdout=${ptyResult.stdout.trim()}\nstderr=${ptyResult.stderr.trim()}`,
      );
    }
    const ptyMarker = JSON.parse(fs.readFileSync(ptyMarkerPath, "utf8"));
    if (
      ptyMarker.ok !== true ||
      ptyMarker.packaged !== true ||
      ptyMarker.backend !== "node-pty" ||
      ptyMarker.outputMatched !== true ||
      ptyMarker.exitCode !== 0 ||
      JSON.stringify(ptyMarker.resizedTo) !== JSON.stringify([100, 40])
    ) {
      throw new Error(
        `Invalid portable PTY marker: ${JSON.stringify(ptyMarker)}`,
      );
    }

    console.log(
      `Windows portable executable and PTY smoke passed: ${path.basename(executablePath)}`,
    );
  } finally {
    removePath(smokeRoot);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
