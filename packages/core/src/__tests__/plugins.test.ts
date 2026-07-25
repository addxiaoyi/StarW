import { describe, it, expect } from "vitest";
import {
  PluginRegistry,
  PluginManifest,
  loadPlugin,
  loadPluginsFromDir,
  getPluginRegistry,
} from "../plugins";
import fs from "fs";
import path from "path";
import os from "os";

describe("Plugin Registry", () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  it("should register and list plugins", () => {
    const plugin = {
      manifest: PluginManifest.parse({
        name: "test-plugin",
        version: "1.0.0",
        description: "A test plugin",
      }),
    };
    registry.register(plugin);
    expect(registry.listAll().length).toBe(1);
    expect(registry.get("test-plugin")).toBeDefined();
  });

  it("should enable and disable plugins", () => {
    const plugin = {
      manifest: PluginManifest.parse({
        name: "test-plugin",
        version: "1.0.0",
        description: "A test plugin",
      }),
    };
    registry.register(plugin);
    registry.enable("test-plugin");
    expect(registry.isEnabled("test-plugin")).toBe(true);
    registry.disable("test-plugin");
    expect(registry.isEnabled("test-plugin")).toBe(false);
  });

  it("should get contributions from enabled plugins", () => {
    const plugin = {
      manifest: PluginManifest.parse({
        name: "test-plugin",
        version: "1.0.0",
        description: "A test plugin",
      }),
      contributions: {
        dagPatterns: [{ id: "p1", name: "Pattern 1", description: "D", category: "pipeline" as const, definition: {} }],
      },
    };
    registry.register(plugin);
    registry.enable("test-plugin");
    const patterns = registry.getContributions("dagPatterns");
    expect(patterns.length).toBe(1);
    expect(patterns[0].id).toBe("p1");
  });

  it("should not get contributions from disabled plugins", () => {
    const plugin = {
      manifest: PluginManifest.parse({
        name: "test-plugin",
        version: "1.0.0",
        description: "A test plugin",
      }),
      contributions: {
        skills: [{ id: "s1", name: "Skill", description: "D", tags: [], execute: "" }],
      },
    };
    registry.register(plugin);
    // not enabled
    const skills = registry.getContributions("skills");
    expect(skills.length).toBe(0);
  });
});

describe("loadPlugin", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `openstar-plugin-${Date.now()}-${Math.floor(Math.random() * 10000)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should load a plugin from directory", async () => {
    const pluginDir = path.join(tmpDir, "my-plugin");
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginDir, "plugin.json"),
      JSON.stringify({
        name: "my-plugin",
        version: "1.0.0",
        description: "Test",
      })
    );

    const plugin = await loadPlugin(pluginDir);
    expect(plugin.manifest.name).toBe("my-plugin");
  });

  it("should throw for missing manifest", async () => {
    const emptyDir = path.join(tmpDir, "empty");
    fs.mkdirSync(emptyDir, { recursive: true });
    await expect(loadPlugin(emptyDir)).rejects.toThrow();
  });

  it("should load plugins from directory", async () => {
    const pluginDir = path.join(tmpDir, "my-plugin");
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginDir, "plugin.json"),
      JSON.stringify({
        name: "my-plugin",
        version: "1.0.0",
        description: "Test",
      })
    );

    const registry = new PluginRegistry();
    const count = await loadPluginsFromDir(tmpDir, registry);
    expect(count).toBe(1);
    expect(registry.isEnabled("my-plugin")).toBe(true);
  });
});

describe("getPluginRegistry singleton", () => {
  it("should return a registry instance", () => {
    expect(getPluginRegistry()).toBeDefined();
  });
});
