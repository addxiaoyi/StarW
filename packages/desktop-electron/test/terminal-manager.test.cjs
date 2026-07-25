"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { TerminalManager } = require("../src/terminal-manager.cjs");

class FakePty {
  constructor(pid = 4242) {
    this.pid = pid;
    this.dataHandlers = [];
    this.exitHandlers = [];
    this.writes = [];
    this.resizes = [];
    this.killed = false;
  }

  onData(handler) {
    this.dataHandlers.push(handler);
    return { dispose: () => {} };
  }

  onExit(handler) {
    this.exitHandlers.push(handler);
    return { dispose: () => {} };
  }

  write(data) {
    this.writes.push(data);
  }

  resize(cols, rows) {
    this.resizes.push([cols, rows]);
  }

  kill() {
    this.killed = true;
  }

  emitData(data) {
    for (const handler of this.dataHandlers) handler(data);
  }

  emitExit(exitCode = 0, signal = 0) {
    for (const handler of this.exitHandlers) handler({ exitCode, signal });
  }
}

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openstar-pty-test-"));
}

test("creates a persistent PTY and forwards input, output and resize", () => {
  const workspace = temporaryWorkspace();
  const events = [];
  const fake = new FakePty();
  let spawnCall;
  const manager = new TerminalManager({
    workspace,
    platform: "win32",
    env: { ComSpec: "cmd.exe" },
    spawnPty(executable, args, options) {
      spawnCall = { executable, args, options };
      return fake;
    },
    onEvent(event, payload) {
      events.push({ event, payload });
    },
  });

  const started = manager.request("terminal.create", {
    sessionId: "terminal-test",
    cwd: ".",
    cols: 100,
    rows: 40,
  });
  assert.equal(started.pid, 4242);
  assert.equal(spawnCall.executable, "cmd.exe");
  assert.equal(spawnCall.options.useConpty, false);
  assert.equal(spawnCall.options.cols, 100);
  assert.equal(spawnCall.options.rows, 40);

  manager.request("terminal.write", {
    sessionId: started.sessionId,
    instanceId: started.instanceId,
    data: "dir\r",
  });
  manager.request("terminal.resize", {
    sessionId: started.sessionId,
    instanceId: started.instanceId,
    cols: 132,
    rows: 50,
  });
  fake.emitData("PTY_OUTPUT");

  assert.deepEqual(fake.writes, ["dir\r"]);
  assert.deepEqual(fake.resizes, [[132, 50]]);
  assert.ok(
    events.some(
      (item) =>
        item.event === "terminal.output" && item.payload.data === "PTY_OUTPUT",
    ),
  );

  fake.emitExit(0);
  assert.equal(manager.status().sessions.length, 0);
  fs.rmSync(workspace, { recursive: true, force: true });
});

test("allows explicit ConPTY opt-in on Windows", () => {
  const workspace = temporaryWorkspace();
  let spawnOptions;
  const manager = new TerminalManager({
    workspace,
    platform: "win32",
    env: { ComSpec: "cmd.exe" },
    useConpty: true,
    spawnPty(_executable, _args, options) {
      spawnOptions = options;
      return new FakePty();
    },
  });

  manager.create({ sessionId: "terminal-conpty", cwd: "." });
  assert.equal(spawnOptions.useConpty, true);
  manager.disposeAll();
  fs.rmSync(workspace, { recursive: true, force: true });
});

test("stale PTY exit cannot remove a replacement instance", () => {
  const workspace = temporaryWorkspace();
  const terminals = [new FakePty(1), new FakePty(2)];
  const manager = new TerminalManager({
    workspace,
    spawnPty() {
      return terminals.shift();
    },
  });

  const first = manager.create({ sessionId: "terminal-race", cwd: "." });
  const firstTerminal = manager.sessions.get(first.sessionId).terminal;
  const second = manager.create({ sessionId: "terminal-race", cwd: "." });
  firstTerminal.emitExit(0);

  assert.equal(manager.status().sessions[0].instanceId, second.instanceId);
  manager.write({
    sessionId: second.sessionId,
    instanceId: second.instanceId,
    data: "echo current\r",
  });
  assert.deepEqual(manager.sessions.get(second.sessionId).terminal.writes, [
    "echo current\r",
  ]);
  fs.rmSync(workspace, { recursive: true, force: true });
});

test("rejects terminal working directories outside the workspace", () => {
  const workspace = temporaryWorkspace();
  const manager = new TerminalManager({
    workspace,
    spawnPty() {
      return new FakePty();
    },
  });
  assert.throws(
    () =>
      manager.create({
        sessionId: "terminal-escape",
        cwd: path.dirname(workspace),
      }),
    /inside the workspace/,
  );
  fs.rmSync(workspace, { recursive: true, force: true });
});
