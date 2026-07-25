"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const desktopDir = path.resolve(__dirname, "..");
const distDir = path.join(desktopDir, "dist");

function findInstaller() {
  if (!fs.existsSync(distDir)) return null;
  const candidates = fs
    .readdirSync(distDir)
    .filter(
      (name) =>
        /^OpenStar-.*-win-.*\.exe$/i.test(name) &&
        !name.includes("__uninstaller") &&
        !name.includes("portable"),
    )
    .map((name) => path.join(distDir, name))
    .sort(
      (left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs,
    );
  return candidates[0] || null;
}

function runInstalledEngine(executablePath, enginePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, [enginePath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.stdin.end();
      } catch {
        // Ignore shutdown races.
      }
      try {
        child.kill();
      } catch {
        // Ignore shutdown races.
      }
      if (error) reject(error);
      else resolve();
    };

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() || "";
      for (const line of lines) {
        try {
          const message = JSON.parse(line);
          if (message.id === "installed-smoke" && message.result?.ok === true) {
            finish();
            return;
          }
        } catch {
          // Ignore non-RPC output.
        }
      }
    });
    child.on("error", finish);
    child.on("exit", (code, signal) => {
      if (!settled) {
        finish(
          new Error(
            `Installed engine exited before readiness: code=${code} signal=${signal}\n${stderr.trim()}`,
          ),
        );
      }
    });

    child.stdin.write(
      `${JSON.stringify({ id: "installed-smoke", method: "ping", params: {} })}\n`,
    );
    const timer = setTimeout(
      () =>
        finish(new Error(`Installed engine RPC timed out\n${stderr.trim()}`)),
      15000,
    );
  });
}

async function main() {
  if (process.platform !== "win32") {
    throw new Error("Installed-package smoke is supported only on Windows");
  }

  const installer = process.argv[2]
    ? path.resolve(process.argv[2])
    : findInstaller();
  if (!installer || !fs.existsSync(installer)) {
    throw new Error(
      "Windows NSIS installer not found. Run the Windows desktop build first.",
    );
  }

  const installDir = path.join(
    desktopDir,
    ".tmp",
    `openstar-installed-${process.pid}`,
  );
  fs.rmSync(installDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(installDir), { recursive: true });

  try {
    const install = spawnSync(installer, ["/S", `/D=${installDir}`], {
      stdio: "inherit",
      timeout: 120000,
      windowsHide: true,
    });
    if (install.error) throw install.error;
    if (install.status !== 0) {
      throw new Error(`Windows installer exited with code ${install.status}`);
    }

    const executablePath = path.join(installDir, "OpenStar.exe");
    const enginePath = path.join(
      installDir,
      "resources",
      "engine",
      "openstar-engine.mjs",
    );
    for (const required of [
      executablePath,
      path.join(installDir, "resources", "app.asar"),
      enginePath,
      path.join(installDir, "resources", "ui-web", "index.html"),
    ]) {
      if (!fs.existsSync(required)) {
        throw new Error(`Installed package file is missing: ${required}`);
      }
    }

    await runInstalledEngine(executablePath, enginePath);
    console.log(
      `Installed Windows package smoke passed: ${path.basename(installer)}`,
    );
  } finally {
    const uninstaller = path.join(installDir, "Uninstall OpenStar.exe");
    if (fs.existsSync(uninstaller)) {
      const uninstall = spawnSync(uninstaller, ["/S"], {
        stdio: "inherit",
        timeout: 120000,
        windowsHide: true,
      });
      if (uninstall.error) throw uninstall.error;
      if (uninstall.status !== 0) {
        throw new Error(
          `Windows uninstaller exited with code ${uninstall.status}`,
        );
      }
    }
    fs.rmSync(installDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
