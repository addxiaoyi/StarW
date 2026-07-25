import { ProviderConfig, ClawConfig } from "./types";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

export function getClawDir(): string {
  return process.env.STARCORE_CLAW_DIR || path.join(os.homedir(), ".openstar", "claw");
}

export function getProviderConfigPath(): string {
  return path.join(getClawDir(), "provider.json");
}

export function getFeaturesConfigPath(): string {
  return path.join(getClawDir(), "features.json");
}

export function getConfigPath(): string {
  return path.join(getClawDir(), "config.json");
}

export function loadProviderConfig(): ProviderConfig {
  const configPath = getProviderConfigPath();
  const defaultConfig: ProviderConfig = {
    apiKey: "",
    baseURL: "https://api.anthropic.com",
    model: "",
    smallModel: "",
    timeoutMs: 300000,
  };

  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf8");
      const parsed = JSON.parse(raw);
      return { ...defaultConfig, ...parsed };
    }
  } catch {
    // ignore
  }

  return defaultConfig;
}

export function saveProviderConfig(config: ProviderConfig): void {
  const dir = getClawDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getProviderConfigPath(), JSON.stringify(config, null, 2) + "\n");
}

export function loadClawConfig(): ClawConfig {
  const configPath = getConfigPath();
  const defaultConfig: ClawConfig = {
    enabled: true,
    provider: {
      apiKey: "",
      baseURL: "https://api.anthropic.com",
      model: "",
      smallModel: "",
      timeoutMs: 300000,
    },
    leanLevel: "on",
    patches: {},
    features: {},
    themeColor: "green",
    enableUpdateCheck: true,
  };

  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf8");
      const parsed = JSON.parse(raw);
      return { ...defaultConfig, ...parsed };
    }
  } catch {
    // ignore
  }

  return defaultConfig;
}

export function saveClawConfig(config: ClawConfig): void {
  const dir = getClawDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + "\n");
}

export function applyProviderEnv(config: ProviderConfig): void {
  if (config.apiKey) {
    process.env.ANTHROPIC_API_KEY = config.apiKey;
  }

  if (config.baseURL) {
    process.env.ANTHROPIC_BASE_URL = config.baseURL;

    if (!/anthropic\.com/i.test(config.baseURL)) {
      process.env.ANTHROPIC_AUTH_TOKEN ??= config.apiKey;
      process.env.CLAUDE_CODE_ATTRIBUTION_HEADER ??= "0";
    }
  }

  if (config.model) {
    process.env.ANTHROPIC_MODEL = config.model;
  }

  if (config.smallModel) {
    process.env.ANTHROPIC_SMALL_FAST_MODEL = config.smallModel;
  }

  if (config.timeoutMs) {
    process.env.API_TIMEOUT_MS ??= String(config.timeoutMs);
  }
}

export function isThirdPartyProxy(baseURL: string): boolean {
  return !/anthropic\.com/i.test(baseURL);
}

export function getCacheBustingHeaders(baseURL: string): Record<string, string> {
  if (isThirdPartyProxy(baseURL)) {
    return {
      "x-anthropic-billing-header": "0",
    };
  }
  return {};
}
