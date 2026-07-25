import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, saveConfig, OpenStarConfigSchema, getConfigPaths } from "../config";
import { z } from "zod";
import fs from "fs";
import path from "path";
import os from "os";

describe("Config System", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `openstar-test-${Date.now()}-${Math.floor(Math.random() * 10000)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should load default config", () => {
    const config = loadConfig(path.join(tmpDir, "nonexistent.json"));
    expect(config).toBeDefined();
    expect(config.core.workingDirectory).toBeDefined();
    expect(config.core.enableSwarm).toBe(true);
  });

  it("should save and reload config", () => {
    const config = loadConfig(path.join(tmpDir, "nonexistent.json"));
    config.core.model = "claude-3-opus";
    const savedPath = saveConfig(config, path.join(tmpDir, "openstar.config.json"));
    expect(fs.existsSync(savedPath)).toBe(true);

    const reloaded = loadConfig(savedPath);
    expect(reloaded.core.model).toBe("claude-3-opus");
  });

  it("should accept env overrides", () => {
    const config = loadConfig(path.join(tmpDir, "nonexistent.json"), {
      core: { model: "test-model" },
    } as any);
    expect(config.core.model).toBe("test-model");
  });

  it("should validate config schema", () => {
    const result = OpenStarConfigSchema.safeParse({ core: { model: "x" } });
    expect(result.success).toBe(true);
  });

  it("should reject invalid temperature", () => {
    const result = OpenStarConfigSchema.safeParse({
      core: { temperature: 5 },
    });
    expect(result.success).toBe(false);
  });

  it("should have config paths", () => {
    const paths = getConfigPaths();
    expect(paths.length).toBeGreaterThan(0);
  });
});
