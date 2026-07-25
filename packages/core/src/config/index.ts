/**
 * OpenStar Configuration System
 *
 * This module unifies two configuration layers that previously lived in two
 * colliding files (`config.ts` and `config/index.ts`):
 *
 *  1. OpenStarConfig  — the canonical, layered project config (load/save/validate).
 *     Used by `config-show`, `config-init`, `dag-*`, swarm runtime, etc.
 *  2. AppConfig       — the lightweight user/app preferences (data dir, model,
 *     api key, theme, …). Used by the ACP server and the desktop binary.
 *
 * NOTE: the two layers use different `saveConfig` signatures, so the AppConfig
 * write helper is intentionally named `saveAppConfig` to avoid a name clash.
 */

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { promises as fsp } from "node:fs"
import { z } from "zod"

// =====================================================================
// 1. AppConfig (user / app preferences)
// =====================================================================

export const AppConfig = z.object({
  dataDir: z.string().default(() => path.join(os.homedir(), ".openstar")),
  defaultModel: z.string().default(""),
  defaultSmallModel: z.string().default(""),
  apiKey: z.string().default(""),
  baseURL: z.string().default(""),
  timeoutMs: z.number().default(300000),
  maxConcurrentAgents: z.number().default(4),
  theme: z.enum(["dark", "light", "auto"]).default("dark"),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
})
export type AppConfig = z.infer<typeof AppConfig>

export function getDataDir(): string {
  return process.env.STARCORE_DATA_DIR || path.join(os.homedir(), ".openstar")
}

export function getConfigPath(): string {
  return path.join(getDataDir(), "config.json")
}

export function getSessionsDir(): string {
  return path.join(getDataDir(), "sessions")
}

export function getSkillsDir(): string {
  return path.join(getDataDir(), "skills")
}

export function getMcpConfigPath(): string {
  return path.join(getDataDir(), "mcp.json")
}

export async function getConfig(): Promise<AppConfig> {
  const configPath = getConfigPath()
  let fileConfig: Record<string, unknown> = {}
  try {
    const data = await fsp.readFile(configPath, "utf8")
    fileConfig = JSON.parse(data)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err
    }
  }

  return AppConfig.parse({
    ...fileConfig,
    apiKey: fileConfig.apiKey || process.env.STARCORE_API_KEY || "",
    baseURL: fileConfig.baseURL || process.env.STARCORE_BASE_URL || "",
    defaultModel: fileConfig.defaultModel || process.env.STARCORE_DEFAULT_MODEL || "",
  })
}

/** Persist (merge) AppConfig preferences. Returns the merged result. */
export async function saveAppConfig(config: Partial<AppConfig>): Promise<AppConfig> {
  const configPath = getConfigPath()
  const current = await getConfig()
  const merged = AppConfig.parse({ ...current, ...config })
  await fsp.mkdir(path.dirname(configPath), { recursive: true })
  await fsp.writeFile(configPath, JSON.stringify(merged, null, 2) + "\n", "utf8")
  return merged
}

// =====================================================================
// 2. OpenStarConfig (canonical layered project config)
// =====================================================================

export const CoreConfigSchema = z
  .object({
    workingDirectory: z.string().optional(),
    model: z.string(),
    temperature: z.number().min(0).max(2).optional(),
    enableSwarm: z.boolean().optional(),
    apiKey: z.string().optional(),
    baseUrl: z.string().optional(),
  })
  .loose()

export const OpenStarConfigSchema = z
  .object({
    core: CoreConfigSchema,
    swarm: z
      .object({
        enabled: z.boolean().optional(),
        maxConcurrency: z.number().optional(),
        agents: z.array(z.unknown()).optional(),
      })
      .loose()
      .optional(),
    mcp: z
      .object({
        servers: z.array(z.unknown()).optional(),
      })
      .loose()
      .optional(),
    agents: z.array(z.unknown()).optional(),
    skills: z.array(z.unknown()).optional(),
    providers: z.record(z.string(), z.unknown()).optional(),
    persistence: z
      .object({
        dbPath: z.string().optional(),
      })
      .loose()
      .optional(),
    sandbox: z
      .object({
        type: z.string().optional(),
      })
      .loose()
      .optional(),
    ui: z
      .object({
        theme: z.string().optional(),
      })
      .loose()
      .optional(),
  })
  .loose()

export type CoreConfig = z.infer<typeof CoreConfigSchema>
export type OpenStarConfig = z.infer<typeof OpenStarConfigSchema>

const DEFAULT_CONFIG: OpenStarConfig = {
  core: {
    workingDirectory: process.cwd(),
    model: "claude-3-sonnet",
    temperature: 0.7,
    enableSwarm: true,
  },
  swarm: {
    enabled: true,
    maxConcurrency: 5,
  },
  mcp: {
    servers: [],
  },
  agents: [],
  skills: [],
  providers: {},
  persistence: {
    dbPath: path.join(os.homedir(), ".openstar", "openstar.db"),
  },
  sandbox: {
    type: "process",
  },
  ui: {
    theme: "dark",
  },
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override as T) ?? base
  }
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(base[key]) && isPlainObject(value)) {
      result[key] = deepMerge(base[key], value)
    } else if (value !== undefined) {
      result[key] = value
    }
  }
  return result as T
}

/**
 * Load configuration. Falls back to defaults when the file is missing or
 * unreadable. `overrides` are deep-merged on top of the loaded config.
 */
export function loadConfig(
  configPath?: string,
  overrides?: Partial<OpenStarConfig>
): OpenStarConfig {
  let config: OpenStarConfig = structuredClone(DEFAULT_CONFIG)

  if (configPath && fs.existsSync(configPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"))
      config = deepMerge(config, raw)
    } catch {
      // Corrupt config: keep defaults.
    }
  }

  if (overrides) {
    config = deepMerge(config, overrides)
  }

  const parsed = OpenStarConfigSchema.safeParse(config)
  return parsed.success ? (parsed.data as OpenStarConfig) : config
}

/**
 * Persist OpenStarConfig to disk. Returns the path written.
 */
export function saveConfig(config: OpenStarConfig, configPath: string): string {
  const dir = path.dirname(configPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8")
  return configPath
}

/**
 * Candidate configuration file locations, in priority order.
 */
export function getConfigPaths(): string[] {
  return [
    path.join(process.cwd(), "openstar.config.json"),
    path.join(process.cwd(), ".openstar", "config.json"),
    path.join(os.homedir(), ".openstar", "config.json"),
    path.join(os.homedir(), ".config", "openstar", "config.json"),
  ]
}
