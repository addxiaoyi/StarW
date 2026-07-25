"use strict";

const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  if (typeof callback !== "function")
    throw new TypeError("Callback must be a function");
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const bridge = Object.freeze({
  request: (method, params = {}, timeoutMs) =>
    ipcRenderer.invoke("starcore:request", method, params, timeoutMs),
  onEvent: (callback) => subscribe("starcore:event", callback),
  chooseWorkspace: () => ipcRenderer.invoke("workspace:choose"),
  openExternal: (url) => ipcRenderer.invoke("browser:open-external", url),
  getStatus: () => ipcRenderer.invoke("starcore:status"),
  listSkills: () => ipcRenderer.invoke("starcore:list-skills"),
  listAgents: () => ipcRenderer.invoke("starcore:list-agents"),
  getMCPStatus: () => ipcRenderer.invoke("starcore:mcp-status"),
  getTheme: () => ipcRenderer.invoke("theme:get"),
  setTheme: (theme) => ipcRenderer.send("theme:set", theme),
  onThemeChanged: (callback) => subscribe("theme:changed", callback),
  onError: (callback) => subscribe("starcore:error", callback),
  onSettingsOpen: (callback) => subscribe("open-settings", callback),
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
  quit: () => ipcRenderer.send("app:quit"),
});

contextBridge.exposeInMainWorld("starcore", bridge);
