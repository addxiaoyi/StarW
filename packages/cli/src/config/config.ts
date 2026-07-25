/**
 * User configuration manager for the OpenStar CLI.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  deepTheme,
  getThemeByName,
  type Theme,
  type ThemeMode,
} from "../themes/colors.js";

export interface UserConfig {
  version: string;
  lastUpdated: string;
  theme: {
    mode: ThemeMode;
    name: string;
  };
  agent: {
    enableSwarm: boolean;
    maxAgents: number;
    logLevel: "silent" | "info" | "debug";
  };
  mcp: {
    port: number;
    servers: MCPServerConfig[];
  };
  plugins: {
    enabled: string[];
    disabled: string[];
  };
  experimental: {
    experimentalMode: boolean;
  };
}

export interface MCPServerConfig {
  id: string;
  name: string;
  uri: string;
  enabled: boolean;
}

const DEFAULT_CONFIG: UserConfig = {
  version: "0.1.0",
  lastUpdated: new Date(0).toISOString(),
  theme: {
    mode: "system",
    name: "deep",
  },
  agent: {
    enableSwarm: true,
    maxAgents: 10,
    logLevel: "info",
  },
  mcp: {
    port: 3000,
    servers: [],
  },
  plugins: {
    enabled: [],
    disabled: [],
  },
  experimental: {
    experimentalMode: false,
  },
};

export class ConfigManager {
  private readonly configPath: string;
  private config: UserConfig | null = null;

  constructor(configPath?: string) {
    this.configPath =
      configPath ?? path.join(os.homedir(), ".openstar", "config.json");
  }

  async ensureConfigDir(): Promise<void> {
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
  }

  async readConfig(): Promise<UserConfig> {
    await this.ensureConfigDir();

    try {
      const file = await fs.readFile(this.configPath, "utf8");
      return this.migrateConfig(JSON.parse(file) as Partial<UserConfig>);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        console.warn("OpenStar config could not be read; defaults are active.");
      }
      return this.migrateConfig({});
    }
  }

  async saveConfig(config: Partial<UserConfig>): Promise<void> {
    const current = await this.getConfig();
    const updated = this.migrateConfig({ ...current, ...config });

    await this.ensureConfigDir();
    await fs.writeFile(
      this.configPath,
      `${JSON.stringify(updated, null, 2)}\n`,
      "utf8",
    );
    this.config = updated;
  }

  async getConfig(): Promise<UserConfig> {
    if (!this.config) {
      this.config = await this.readConfig();
    }
    return this.config;
  }

  async setTheme(themeName: string, mode?: ThemeMode): Promise<void> {
    const config = await this.getConfig();
    const selectedTheme = getThemeByName(themeName) ?? deepTheme;

    await this.saveConfig({
      theme: {
        name: selectedTheme.name,
        mode: mode ?? config.theme.mode,
      },
    });
  }

  async getTheme(): Promise<{ theme: Theme; mode: ThemeMode }> {
    const config = await this.getConfig();
    return {
      theme: getThemeByName(config.theme.name) ?? deepTheme,
      mode: config.theme.mode,
    };
  }

  async setAgentSwarm(enabled: boolean): Promise<void> {
    const config = await this.getConfig();
    await this.saveConfig({
      agent: {
        ...config.agent,
        enableSwarm: enabled,
      },
    });
  }

  private migrateConfig(config: Partial<UserConfig>): UserConfig {
    return {
      ...DEFAULT_CONFIG,
      ...config,
      lastUpdated: new Date().toISOString(),
      theme: {
        ...DEFAULT_CONFIG.theme,
        ...config.theme,
      },
      agent: {
        ...DEFAULT_CONFIG.agent,
        ...config.agent,
      },
      mcp: {
        ...DEFAULT_CONFIG.mcp,
        ...config.mcp,
        servers: config.mcp?.servers ?? DEFAULT_CONFIG.mcp.servers,
      },
      plugins: {
        ...DEFAULT_CONFIG.plugins,
        ...config.plugins,
        enabled: config.plugins?.enabled ?? DEFAULT_CONFIG.plugins.enabled,
        disabled: config.plugins?.disabled ?? DEFAULT_CONFIG.plugins.disabled,
      },
      experimental: {
        ...DEFAULT_CONFIG.experimental,
        ...config.experimental,
      },
    };
  }
}

export const configManager = new ConfigManager();
