"use strict";

const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  safeStorage,
  shell,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const {
  assertTrustedIpc,
  isSafeExternalUrl,
  isTrustedRendererUrl,
  normalizeTheme,
} = require("./ipc-policy.cjs");
const { StarCoreBridge } = require("./starcore-bridge.cjs");
const { ensureEngineSecretKey } = require("./secret-key.cjs");
const { TerminalManager } = require("./terminal-manager.cjs");
const { resolvePortableUserDataPath } = require("./portable-policy.cjs");
const { resolveWindowTarget } = require("./window-target.cjs");

const portableUserDataPath = resolvePortableUserDataPath();
if (portableUserDataPath) app.setPath("userData", portableUserDataPath);
const portableSmokeMode = process.argv.includes("--openstar-portable-smoke");
const ptySmokeMode = process.argv.includes("--openstar-pty-smoke");

app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
app.commandLine.appendSwitch("enable-features", "TemporaryDiskCacheInMemory");

let mainWindow = null;
let rendererTarget = null;
let starcoreBridge = null;
let terminalManager = null;
let terminalEventObserver = null;

function resolvedTheme() {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

function broadcastResolvedTheme() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("theme:changed", resolvedTheme());
}

nativeTheme.on("updated", broadcastResolvedTheme);

const logFile = path.join(app.getPath("userData"), "openstar-desktop.log");
function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.appendFileSync(logFile, line);
  } catch (error) {
    console.error(`Unable to write desktop log at ${logFile}`, error);
  }
  console.log(message);
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function resolveDefaultWorkspace() {
  const candidate =
    process.env.OPENSTAR_WORKSPACE ||
    process.env.PORTABLE_EXECUTABLE_DIR ||
    (!app.isPackaged
      ? path.resolve(__dirname, "../../..")
      : app.getPath("documents"));
  try {
    const resolved = path.resolve(candidate);
    if (fs.statSync(resolved).isDirectory()) return resolved;
  } catch {
    // Fall back to the portable data directory below.
  }
  return app.getPath("userData");
}

function forwardTerminalEvent(event, payload) {
  terminalEventObserver?.(event, payload);
  if (mainWindow && !mainWindow.isDestroyed() && rendererTarget) {
    mainWindow.webContents.send("starcore:event", { event, payload });
  }
}

function requireTerminalManager() {
  if (!terminalManager) {
    terminalManager = new TerminalManager({
      workspace: resolveDefaultWorkspace(),
      onEvent: forwardTerminalEvent,
    });
  }
  return terminalManager;
}

async function startStarCore() {
  const secretKey = ensureEngineSecretKey({
    safeStorage,
    userDataPath: app.getPath("userData"),
  });
  starcoreBridge = new StarCoreBridge({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    executablePath: process.execPath,
    desktopDir: path.resolve(__dirname, ".."),
    projectRoot: resolveDefaultWorkspace(),
    dataDir: app.getPath("userData"),
    secretKey,
  });
  const mode = await starcoreBridge.start();
  log(`StarCore bridge started in ${mode} mode`);
  starcoreBridge.onError((message) => {
    log(`StarCore bridge error: ${message}`);
    if (mainWindow && !mainWindow.isDestroyed() && rendererTarget) {
      mainWindow.webContents.send("starcore:error", message);
    }
  });
  starcoreBridge.onEvent((event, payload) => {
    if (
      event === "config.changed" &&
      payload &&
      typeof payload === "object" &&
      typeof payload.workspace === "string"
    ) {
      terminalManager?.updateWorkspace(payload.workspace);
    }
    if (mainWindow && !mainWindow.isDestroyed() && rendererTarget) {
      mainWindow.webContents.send("starcore:event", { event, payload });
    }
  });
}

function loadErrorPage(window, error) {
  const detail = error instanceof Error ? error.message : String(error);
  log(`Renderer failed to load: ${detail}`);
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenStar renderer unavailable</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#11110f;color:#e8e7df;font:14px/1.6 system-ui,sans-serif}main{width:min(620px,calc(100vw - 48px))}p{color:#aaa99f}code{display:block;margin-top:18px;padding:14px;overflow-wrap:anywhere;border:1px solid #3b3a34;background:#191916;color:#ffb86b}</style></head><body><main><h1>工作台加载失败</h1><p>请构建 Solid 工作台后重试。</p><code>${escapeHtml(detail)}</code></main></body></html>`;
  return window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
  );
}

function resolveRendererTarget() {
  const desktopDir = path.resolve(__dirname, "..");
  const resourcesDir =
    process.resourcesPath || path.join(desktopDir, "resources");
  const devServerUrl =
    process.env.OPENSTAR_DEV_SERVER_URL ||
    (!app.isPackaged ? "http://127.0.0.1:4446" : undefined);
  return resolveWindowTarget({
    desktopDir,
    resourcesDir,
    isPackaged: app.isPackaged,
    devServerUrl,
  });
}

async function loadRenderer(window) {
  rendererTarget = resolveRendererTarget();
  if (rendererTarget.kind === "file" && !fs.existsSync(rendererTarget.value)) {
    throw new Error(`Renderer file not found: ${rendererTarget.value}`);
  }
  log(`Loading Solid renderer from ${rendererTarget.value}`);
  if (rendererTarget.kind === "url") await window.loadURL(rendererTarget.value);
  else await window.loadFile(rendererTarget.value);
}

function configureWebContents(window) {
  const { webContents } = window;
  webContents.session.setPermissionCheckHandler(() => false);
  webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );

  webContents.on("will-attach-webview", (event) => event.preventDefault());
  webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url, rendererTarget)) event.preventDefault();
  });
  webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      void shell
        .openExternal(url)
        .catch((error) => log(`Unable to open external URL: ${error.message}`));
    }
    return { action: "deny" };
  });
  webContents.on("render-process-gone", (_event, details) => {
    terminalManager?.disposeAll();
    log(`[renderer process gone] ${details.reason}: ${details.exitCode}`);
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "OpenStar",
    backgroundColor: "#11110f",
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    titleBarOverlay:
      process.platform === "darwin"
        ? false
        : { color: "#11110f", symbolColor: "#aaa99f", height: 40 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  });

  configureWebContents(mainWindow);
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    if (process.env.OPENSTAR_OPEN_DEVTOOLS === "1" && !app.isPackaged) {
      mainWindow?.webContents.openDevTools({ mode: "detach" });
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    rendererTarget = null;
  });

  try {
    await loadRenderer(mainWindow);
  } catch (error) {
    rendererTarget = null;
    await loadErrorPage(mainWindow, error);
  }
}

function requireBridge() {
  if (!starcoreBridge || starcoreBridge.mode !== "real")
    throw new Error("StarCore engine is unavailable");
  return starcoreBridge;
}

function setupIPC() {
  const guard = (event) => assertTrustedIpc(event, mainWindow, rendererTarget);
  const handle = (channel, callback) => {
    ipcMain.handle(channel, async (event, ...args) => {
      guard(event);
      return callback(...args);
    });
  };
  const on = (channel, callback) => {
    ipcMain.on(channel, (event, ...args) => {
      guard(event);
      callback(...args);
    });
  };

  requireTerminalManager();
  handle("starcore:request", (method, params, timeoutMs) => {
    if (typeof method === "string" && method.startsWith("terminal.")) {
      return requireTerminalManager().request(method, params || {});
    }
    return requireBridge().request(method, params || {}, timeoutMs);
  });
  handle("workspace:choose", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
      title: "选择 OpenStar 工作区",
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  handle("browser:open-external", async (url) => {
    if (!isSafeExternalUrl(url)) throw new Error("External URL is not allowed");
    await shell.openExternal(url);
    return true;
  });

  handle("starcore:status", () => requireBridge().status());
  handle("starcore:list-skills", () => requireBridge().skills());
  handle("starcore:list-agents", () => requireBridge().agents());
  handle("starcore:mcp-status", () => requireBridge().mcpStatus());
  handle("theme:get", () => resolvedTheme());

  on("theme:set", (theme) => {
    nativeTheme.themeSource = normalizeTheme(theme);
    broadcastResolvedTheme();
  });
  on("window:minimize", () => mainWindow?.minimize());
  on("window:maximize", () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  on("window:close", () => mainWindow?.close());
  on("app:quit", () => {
    terminalManager?.disposeAll();
    starcoreBridge?.stop();
    app.quit();
  });
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(message)), timeoutMs),
    ),
  ]);
}

async function runPtySmoke() {
  const manager = requireTerminalManager();
  let output = "";
  let resolveOutput;
  let resolveExit;
  const outputReady = new Promise((resolve) => {
    resolveOutput = resolve;
  });
  const exitReady = new Promise((resolve) => {
    resolveExit = resolve;
  });
  terminalEventObserver = (event, payload) => {
    if (!payload || payload.sessionId !== "portable-pty-smoke") return;
    if (event === "terminal.output") {
      output += typeof payload.data === "string" ? payload.data : "";
      if (output.includes("OPENSTAR_PTY_OK")) resolveOutput();
    }
    if (event === "terminal.exit") resolveExit(payload);
  };

  try {
    const session = manager.request("terminal.create", {
      sessionId: "portable-pty-smoke",
      cwd: ".",
      cols: 90,
      rows: 30,
    });
    manager.request("terminal.resize", {
      sessionId: session.sessionId,
      instanceId: session.instanceId,
      cols: 100,
      rows: 40,
    });
    manager.request("terminal.write", {
      sessionId: session.sessionId,
      instanceId: session.instanceId,
      data: "echo OPENSTAR_PTY_OK\r",
    });
    await withTimeout(outputReady, 15000, "Packaged PTY output timed out");
    manager.request("terminal.write", {
      sessionId: session.sessionId,
      instanceId: session.instanceId,
      data: "exit\r",
    });
    const exit = await withTimeout(
      exitReady,
      15000,
      "Packaged PTY exit timed out",
    );
    const markerPath = path.join(app.getPath("userData"), "pty-smoke.json");
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(
      markerPath,
      JSON.stringify(
        {
          ok: true,
          packaged: app.isPackaged,
          backend: "node-pty",
          outputMatched: output.includes("OPENSTAR_PTY_OK"),
          exitCode: exit.exitCode,
          resizedTo: [100, 40],
        },
        null,
        2,
      ),
    );
    console.log("OPENSTAR_PTY_SMOKE_OK");
    app.exit(0);
  } finally {
    terminalEventObserver = null;
    manager.disposeAll();
  }
}

async function runPortableSmoke() {
  await startStarCore();
  if (!starcoreBridge || starcoreBridge.mode !== "real") {
    throw new Error("Portable StarCore engine is unavailable");
  }
  await starcoreBridge.status();
  const markerPath = path.join(app.getPath("userData"), "portable-smoke.json");
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });
  fs.writeFileSync(
    markerPath,
    JSON.stringify(
      {
        ok: true,
        packaged: app.isPackaged,
        engineMode: starcoreBridge.mode,
      },
      null,
      2,
    ),
  );
  console.log("OPENSTAR_PORTABLE_SMOKE_OK");
  await starcoreBridge.stopGracefully();
  app.exit(0);
}

function createMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "OpenStar",
        submenu: [{ label: "退出", role: "quit", accelerator: "CmdOrCtrl+Q" }],
      },
      {
        label: "编辑",
        submenu: [
          { label: "撤销", role: "undo" },
          { label: "重做", role: "redo" },
          { type: "separator" },
          { label: "剪切", role: "cut" },
          { label: "复制", role: "copy" },
          { label: "粘贴", role: "paste" },
        ],
      },
    ]),
  );
}

app
  .whenReady()
  .then(async () => {
    if (ptySmokeMode) {
      await runPtySmoke();
      return;
    }
    if (portableSmokeMode) {
      await runPortableSmoke();
      return;
    }
    setupIPC();
    await startStarCore();
    await createWindow();
    createMenu();
  })
  .catch((error) => {
    log(
      `Desktop startup failed: ${error instanceof Error ? error.stack : String(error)}`,
    );
    if (portableSmokeMode || ptySmokeMode) app.exit(1);
    else app.quit();
  });

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
app.on("before-quit", () => {
  terminalManager?.disposeAll();
  starcoreBridge?.stop();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
