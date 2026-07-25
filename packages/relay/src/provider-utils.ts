const MAX_ERROR_BODY_LENGTH = 500;

function redactSecret(value: string, secret?: string): string {
  let redacted = value;
  if (secret) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;"']+/gi, "$1[REDACTED]")
    .replace(
      /((?:x-api-key|api[_-]?key)\s*[:=]\s*)[^\s,;"']+/gi,
      "$1[REDACTED]",
    );
}

export function requireProviderApiKey(apiKey: string): string {
  const value = apiKey.trim();
  if (!value) {
    throw new Error("Provider API key must not be empty");
  }
  return value;
}

export function normalizeProviderBaseUrl(baseUrl: string): string {
  const value = baseUrl.trim();
  if (!value) {
    throw new Error("Provider base URL must not be empty");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Provider base URL must be a valid absolute URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Provider base URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("Provider base URL must not contain credentials");
  }
  if (url.search || url.hash) {
    throw new Error(
      "Provider base URL must not contain a query string or fragment",
    );
  }

  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function buildProviderEndpoint(
  configuredBaseUrl: string | undefined,
  defaultBaseUrl: string,
  endpoint: string,
): string {
  const baseUrl = normalizeProviderBaseUrl(configuredBaseUrl ?? defaultBaseUrl);
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  const endpointPath = endpoint.replace(/^\/+/, "");
  url.pathname = `${basePath}/${endpointPath}`.replace(/\/{2,}/g, "/");
  return url.toString();
}

export async function createProviderHttpError(
  providerName: string,
  response: Response,
  apiKey?: string,
): Promise<Error> {
  let body = "";
  try {
    body = await response.text();
  } catch {
    body = "Unable to read upstream error body";
  }

  const requestId =
    response.headers.get("x-request-id") ?? response.headers.get("request-id");
  const detail = redactSecret(
    body.slice(0, MAX_ERROR_BODY_LENGTH),
    apiKey,
  ).trim();
  const suffix = detail ? `: ${detail}` : "";
  const requestSuffix = requestId
    ? ` (request ${redactSecret(requestId, apiKey)})`
    : "";
  return new Error(
    `${providerName} API error ${response.status}${requestSuffix}${suffix}`,
  );
}

export async function readProviderJson<T>(
  providerName: string,
  response: Response,
): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(`${providerName} API returned invalid JSON`);
  }
}
