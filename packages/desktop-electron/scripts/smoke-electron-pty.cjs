"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const marker = "OPENSTAR_ELECTRON_PTY_OK";

function runChildSmoke() {
  const pty = require("node-pty");
  const executable =
    process.platform === "win32"
      ? process.env.ComSpec || process.env.COMSPEC || "cmd.exe"
      : process.env.SHELL || "/bin/sh";
  const terminal = pty.spawn(executable, [], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: process.env,
    useConpty: process.platform === "win32",
  });
  let output = "";
  let finished = false;
  const timeout = setTimeout(() => {
    if (finished) return;
    terminal.kill();
    console.error("Electron node-pty smoke timed out");
    process.exit(2);
  }, 10000);

  terminal.onData((data) => {
    output += data;
    if (output.includes(marker)) {
      terminal.write(process.platform === "win32" ? "exit\r" : "exit\n");
    }
  });
  terminal.onExit((event) => {
    finished = true;
    clearTimeout(timeout);
    const ok = output.includes(marker) && event.exitCode === 0;
    console.log(
      JSON.stringify({
        ok,
        electron: process.versions.electron,
        modules: process.versions.modules,
        backend: "node-pty",
        outputMatched: output.includes(marker),
        exitCode: event.exitCode,
      }),
    );
    process.exit(ok ? 0 : 1);
  });
  terminal.resize(123, 45);
  terminal.write(
    process.platform === "win32"
      ? `echo ${marker}\r`
      : `printf '${marker}\\n'\n`,
  );
}

function runElectronSmoke() {
  const electronExecutable = require("electron");
  const result = spawnSync(electronExecutable, [__filename], {
    cwd: path.resolve(__dirname, "../../.."),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      OPENSTAR_ELECTRON_PTY_CHILD: "1",
    },
    encoding: "utf8",
    timeout: 15000,
    windowsHide: true,
  });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.env.OPENSTAR_ELECTRON_PTY_CHILD === "1") {
  runChildSmoke();
} else {
  runElectronSmoke();
}
