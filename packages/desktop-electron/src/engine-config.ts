import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ProviderConfig } from "../../relay/src/index.js";

export type ProviderId = "openai" | "anthropic" | "kimi";

export interface DesktopProviderConfig {
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface DesktopMcpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  enabled: boolean;
}

export interface DesktopConfig {
  workspace: string;
  theme: "dark" | "light" | "auto";
  selectedProvider: ProviderId;
  providers: Record<ProviderId, DesktopProviderConfig>;
  mcp: { servers: DesktopMcpServerConfig[] };
  swarm: { maxWorkers: number; maxConcurrency: number; taskTimeoutMs: number };
}

export interface PublicDesktopProviderConfig extends Omit<
  DesktopProviderConfig,
  "apiKey"
> {
  configured: boolean;
  apiKeyHint: string;
}

export interface PublicDesktopConfig extends Omit<DesktopConfig, "providers"> {
  providers: Record<ProviderId, PublicDesktopProviderConfig>;
}

interface SecretEnvelope {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
}

const DATA_DIR = path.resolve(
  process.env.STARCORE_DATA_DIR || path.join(os.homedir(), ".openstar"),
);
const CONFIG_PATH = path.join(DATA_DIR, "desktop-config.json");
const SECRETS_PATH = path.join(DATA_DIR, "provider-secrets.enc.json");
const PROVIDER_IDS: ProviderId[] = ["openai", "anthropic", "kimi"];

const providerDefaults: Record<ProviderId, DesktopProviderConfig> = {
  openai: {
    enabled: true,
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    model: "",
  },
  anthropic: {
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.anthropic.com/v1",
    model: "",
  },
  kimi: {
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "",
  },
};

function defaultConfig(): DesktopConfig {
  return {
    workspace: path.resolve(process.env.OPENSTAR_WORKSPACE || process.cwd()),
    theme: "dark",
    selectedProvider: "openai",
    providers: structuredClone(providerDefaults),
    mcp: { servers: [] },
    swarm: { maxWorkers: 4, maxConcurrency: 2, taskTimeoutMs: 300_000 },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
function readPositiveInteger(
  value: unknown,
  fallback: number,
  maximum: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.min(maximum, Math.floor(value)))
    : fallback;
}

function secretKey(required = false): Buffer | null {
  const value = process.env.STARCORE_SECRET_KEY?.trim();
  if (!value) {
    if (required)
      throw new Error(
        "STARCORE_SECRET_KEY is required to store provider credentials",
      );
    return null;
  }
  const key = /^[0-9a-f]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (key.length !== 32)
    throw new Error("STARCORE_SECRET_KEY must contain exactly 32 bytes");
  return key;
}

function atomicWrite(file: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, content, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function readSecrets(): Partial<Record<ProviderId, string>> {
  if (!fs.existsSync(SECRETS_PATH)) return {};
  const key = secretKey(true)!;
  const envelope = JSON.parse(
    fs.readFileSync(SECRETS_PATH, "utf8"),
  ) as SecretEnvelope;
  if (envelope.version !== 1 || envelope.algorithm !== "aes-256-gcm")
    throw new Error("Unsupported provider secret envelope");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  const parsed = JSON.parse(plaintext) as Record<string, unknown>;
  return Object.fromEntries(
    PROVIDER_IDS.map((id) => [id, readString(parsed[id])]).filter(([, value]) =>
      Boolean(value),
    ),
  ) as Partial<Record<ProviderId, string>>;
}

function writeSecrets(
  providers: Record<ProviderId, DesktopProviderConfig>,
): void {
  const values = Object.fromEntries(
    PROVIDER_IDS.map((id) => [id, providers[id].apiKey.trim()]).filter(
      ([, value]) => Boolean(value),
    ),
  );
  if (Object.keys(values).length === 0) {
    fs.rmSync(SECRETS_PATH, { force: true });
    return;
  }
  const key = secretKey(true)!;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(values), "utf8"),
    cipher.final(),
  ]);
  const envelope: SecretEnvelope = {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  atomicWrite(SECRETS_PATH, `${JSON.stringify(envelope, null, 2)}\n`);
}

function serializableConfig(config: DesktopConfig): Record<string, unknown> {
  return {
    workspace: config.workspace,
    theme: config.theme,
    selectedProvider: config.selectedProvider,
    providers: Object.fromEntries(
      PROVIDER_IDS.map((id) => [
        id,
        {
          enabled: config.providers[id].enabled,
          baseUrl: config.providers[id].baseUrl,
          model: config.providers[id].model,
        },
      ]),
    ),
    mcp: config.mcp,
    swarm: config.swarm,
  };
}
function writeConfig(config: DesktopConfig): void {
  atomicWrite(
    CONFIG_PATH,
    `${JSON.stringify(serializableConfig(config), null, 2)}\n`,
  );
}

function normalizeMcpServer(
  value: unknown,
  index: number,
): DesktopMcpServerConfig | null {
  if (!isRecord(value)) return null;
  const command = readString(value.command).trim();
  if (!command) return null;
  const id =
    readString(value.id, `mcp-${index + 1}`).trim() || `mcp-${index + 1}`;
  const args = Array.isArray(value.args)
    ? value.args.filter((item): item is string => typeof item === "string")
    : [];
  const env = isRecord(value.env)
    ? Object.fromEntries(
        Object.entries(value.env).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : undefined;
  return {
    id,
    name: readString(value.name, id).trim() || id,
    command,
    args,
    cwd: readString(value.cwd).trim() || undefined,
    env,
    enabled: readBoolean(value.enabled, true),
  };
}

export function loadDesktopConfig(): DesktopConfig {
  const defaults = defaultConfig();
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Record<
      string,
      unknown
    >;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      console.error(
        `[desktop-config] ${error instanceof Error ? error.message : String(error)}`,
      );
  }
  const encryptedSecrets = readSecrets();
  const providersRaw = isRecord(raw.providers) ? raw.providers : {};
  let migratedPlaintext = false;
  const providers = Object.fromEntries(
    PROVIDER_IDS.map((id) => {
      const value = isRecord(providersRaw[id]) ? providersRaw[id] : {};
      const fallback = providerDefaults[id];
      const legacy = readString(value.apiKey).trim();
      migratedPlaintext ||= Boolean(legacy);
      return [
        id,
        {
          enabled: readBoolean(value.enabled, fallback.enabled),
          apiKey: encryptedSecrets[id] || legacy || fallback.apiKey,
          baseUrl: readString(value.baseUrl, fallback.baseUrl),
          model: readString(value.model, fallback.model),
        },
      ];
    }),
  ) as Record<ProviderId, DesktopProviderConfig>;
  const selectedProvider = PROVIDER_IDS.includes(
    raw.selectedProvider as ProviderId,
  )
    ? (raw.selectedProvider as ProviderId)
    : defaults.selectedProvider;
  const workspaceCandidate = path.resolve(
    readString(raw.workspace, defaults.workspace),
  );
  const workspace =
    fs.existsSync(workspaceCandidate) &&
    fs.statSync(workspaceCandidate).isDirectory()
      ? workspaceCandidate
      : defaults.workspace;
  const mcpRaw =
    isRecord(raw.mcp) && Array.isArray(raw.mcp.servers) ? raw.mcp.servers : [];
  const swarmRaw = isRecord(raw.swarm) ? raw.swarm : {};
  const theme = ["dark", "light", "auto"].includes(String(raw.theme))
    ? (raw.theme as DesktopConfig["theme"])
    : defaults.theme;
  const config: DesktopConfig = {
    workspace,
    theme,
    selectedProvider,
    providers,
    mcp: {
      servers: mcpRaw
        .map(normalizeMcpServer)
        .filter((server): server is DesktopMcpServerConfig => Boolean(server)),
    },
    swarm: {
      maxWorkers: readPositiveInteger(swarmRaw.maxWorkers, 4, 32),
      maxConcurrency: readPositiveInteger(swarmRaw.maxConcurrency, 2, 32),
      taskTimeoutMs: readPositiveInteger(
        swarmRaw.taskTimeoutMs,
        300_000,
        3_600_000,
      ),
    },
  };
  if (migratedPlaintext) {
    writeSecrets(config.providers);
    writeConfig(config);
  }
  return config;
}

function mergeProvider(
  current: DesktopProviderConfig,
  update: unknown,
): DesktopProviderConfig {
  if (!isRecord(update)) return current;
  const supplied = update.apiKey;
  const apiKey =
    supplied === null
      ? ""
      : typeof supplied === "string" && supplied.trim()
        ? supplied.trim()
        : current.apiKey;
  return {
    enabled: readBoolean(update.enabled, current.enabled),
    apiKey,
    baseUrl:
      readString(update.baseUrl, current.baseUrl).trim() || current.baseUrl,
    model: readString(update.model, current.model).trim(),
  };
}

export function updateDesktopConfig(update: unknown): DesktopConfig {
  if (!isRecord(update))
    throw new TypeError("Configuration update must be an object");
  const current = loadDesktopConfig();
  const next: DesktopConfig = structuredClone(current);
  if (typeof update.workspace === "string") {
    const workspace = path.resolve(update.workspace);
    if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory())
      throw new Error(`Workspace directory does not exist: ${workspace}`);
    next.workspace = workspace;
  }
  if (["dark", "light", "auto"].includes(String(update.theme)))
    next.theme = update.theme as DesktopConfig["theme"];
  if (PROVIDER_IDS.includes(update.selectedProvider as ProviderId))
    next.selectedProvider = update.selectedProvider as ProviderId;
  if (isRecord(update.providers))
    for (const id of PROVIDER_IDS)
      next.providers[id] = mergeProvider(
        next.providers[id],
        update.providers[id],
      );
  if (isRecord(update.mcp) && Array.isArray(update.mcp.servers))
    next.mcp.servers = update.mcp.servers
      .map(normalizeMcpServer)
      .filter((server): server is DesktopMcpServerConfig => Boolean(server));
  if (isRecord(update.swarm))
    next.swarm = {
      maxWorkers: readPositiveInteger(
        update.swarm.maxWorkers,
        next.swarm.maxWorkers,
        32,
      ),
      maxConcurrency: readPositiveInteger(
        update.swarm.maxConcurrency,
        next.swarm.maxConcurrency,
        32,
      ),
      taskTimeoutMs: readPositiveInteger(
        update.swarm.taskTimeoutMs,
        next.swarm.taskTimeoutMs,
        3_600_000,
      ),
    };
  writeSecrets(next.providers);
  writeConfig(next);
  return next;
}

function keyHint(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 3)}••••${value.slice(-4)}`;
}

export function toPublicDesktopConfig(
  config: DesktopConfig,
): PublicDesktopConfig {
  return {
    ...config,
    providers: Object.fromEntries(
      PROVIDER_IDS.map((id) => [
        id,
        {
          enabled: config.providers[id].enabled,
          baseUrl: config.providers[id].baseUrl,
          model: config.providers[id].model,
          configured: Boolean(config.providers[id].apiKey),
          apiKeyHint: keyHint(config.providers[id].apiKey),
        },
      ]),
    ) as Record<ProviderId, PublicDesktopProviderConfig>,
  };
}

export function toRelayProviders(config: DesktopConfig): ProviderConfig[] {
  return PROVIDER_IDS.filter(
    (id) => config.providers[id].enabled && config.providers[id].apiKey,
  ).map((id) => ({
    id,
    type: id,
    apiKey: config.providers[id].apiKey,
    baseUrl: config.providers[id].baseUrl || undefined,
    defaultModel: config.providers[id].model || undefined,
    timeoutMs: 120_000,
  }));
}

export function getDesktopDataDir(): string {
  return DATA_DIR;
}
export function getDesktopConfigPath(): string {
  return CONFIG_PATH;
}
export function getDesktopSecretsPath(): string {
  return SECRETS_PATH;
}
