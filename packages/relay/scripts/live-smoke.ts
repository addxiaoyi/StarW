import { ApiRelay, type ProviderConfig } from "../src/index";

const successToken = "OPENSTAR_SMOKE_OK";

type ProviderSpec = {
  id: "openai" | "anthropic" | "kimi";
  type: ProviderConfig["type"];
  keyEnv: string;
  modelEnv: string;
  baseUrlEnv: string;
};

const providerSpecs: ProviderSpec[] = [
  {
    id: "openai",
    type: "openai",
    keyEnv: "OPENAI_API_KEY",
    modelEnv: "OPENAI_SMOKE_MODEL",
    baseUrlEnv: "OPENAI_BASE_URL",
  },
  {
    id: "anthropic",
    type: "anthropic",
    keyEnv: "ANTHROPIC_API_KEY",
    modelEnv: "ANTHROPIC_SMOKE_MODEL",
    baseUrlEnv: "ANTHROPIC_BASE_URL",
  },
  {
    id: "kimi",
    type: "kimi",
    keyEnv: "KIMI_API_KEY",
    modelEnv: "KIMI_SMOKE_MODEL",
    baseUrlEnv: "KIMI_BASE_URL",
  },
];

function failNotExecuted(message: string): never {
  console.error(`LIVE PROVIDER SMOKE NOT EXECUTED: ${message}`);
  process.exit(2);
}

if (process.env.OPENSTAR_LIVE_PROVIDER_SMOKE !== "1") {
  failNotExecuted(
    "set OPENSTAR_LIVE_PROVIDER_SMOKE=1 to acknowledge real network calls and provider billing",
  );
}

const requestedIds = new Set(
  (process.env.OPENSTAR_LIVE_PROVIDERS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

const selected =
  requestedIds.size > 0
    ? providerSpecs.filter((spec) => requestedIds.has(spec.id))
    : providerSpecs.filter(
        (spec) => process.env[spec.keyEnv] || process.env[spec.modelEnv],
      );

if (selected.length === 0) {
  failNotExecuted(
    "select providers with OPENSTAR_LIVE_PROVIDERS=openai,anthropic,kimi and provide their key/model variables",
  );
}

const unknown = [...requestedIds].filter(
  (id) => !providerSpecs.some((spec) => spec.id === id),
);
if (unknown.length > 0) {
  throw new Error(`Unknown live provider id(s): ${unknown.join(", ")}`);
}

const configs: ProviderConfig[] = selected.map((spec) => {
  const apiKey = process.env[spec.keyEnv]?.trim();
  const model = process.env[spec.modelEnv]?.trim();
  if (!apiKey || !model) {
    throw new Error(
      `${spec.id} requires both ${spec.keyEnv} and ${spec.modelEnv}`,
    );
  }
  return {
    id: spec.id,
    type: spec.type,
    apiKey,
    defaultModel: model,
    baseUrl: process.env[spec.baseUrlEnv]?.trim() || undefined,
    timeoutMs: Number(process.env.OPENSTAR_LIVE_PROVIDER_TIMEOUT_MS || 45000),
  };
});

const relay = new ApiRelay();
relay.configure(configs);

let failures = 0;
for (const config of configs) {
  const startedAt = Date.now();
  try {
    const response = await relay.chatCompletion(
      {
        model: config.defaultModel!,
        messages: [
          {
            role: "user",
            content: `Reply with exactly ${successToken} and nothing else.`,
          },
        ],
        temperature: 0,
        maxTokens: 32,
      },
      config.id,
    );
    const content = response.choices[0]?.message?.content?.trim();
    if (content !== successToken) {
      throw new Error(
        `unexpected response content: ${JSON.stringify(content ?? null)}`,
      );
    }

    console.log(
      JSON.stringify({
        status: "passed",
        provider: config.id,
        requestedModel: config.defaultModel,
        returnedModel: response.model,
        latencyMs: Date.now() - startedAt,
        usage: response.usage ?? null,
      }),
    );
  } catch (error) {
    failures += 1;
    console.error(
      JSON.stringify({
        status: "failed",
        provider: config.id,
        requestedModel: config.defaultModel,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

if (failures > 0) process.exitCode = 1;
