import { describe, expect, it } from "vitest";
import { createGatewayRuntime, handleGatewayRequest } from "../index.js";

function createRuntime() {
  return createGatewayRuntime({
    token: "test-token",
    allowedOrigins: ["http://allowed.test"],
    workspaceRoot: process.cwd(),
  }).runtime;
}

describe("Gateway HTTP boundary", () => {
  it("keeps health public and cache-free", async () => {
    const response = await handleGatewayRequest(new Request("http://127.0.0.1:3456/api/health"), createRuntime());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("requires a token for protected routes", async () => {
    const response = await handleGatewayRequest(new Request("http://127.0.0.1:3456/api/agents"), createRuntime());
    expect(response.status).toBe(401);
  });

  it("allows exact origins and bearer tokens", async () => {
    const response = await handleGatewayRequest(
      new Request("http://127.0.0.1:3456/api/agents", {
        headers: { origin: "http://allowed.test", authorization: "Bearer test-token" },
      }),
      createRuntime(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://allowed.test");
  });

  it("blocks unknown browser origins", async () => {
    const response = await handleGatewayRequest(
      new Request("http://127.0.0.1:3456/api/health", { headers: { origin: "http://evil.test" } }),
      createRuntime(),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects oversized bodies before parsing", async () => {
    const response = await handleGatewayRequest(
      new Request("http://127.0.0.1:3456/acp", {
        method: "POST",
        headers: { authorization: "Bearer test-token", "content-length": "1048577" },
        body: "{}",
      }),
      createRuntime(),
    );
    expect(response.status).toBe(413);
  });
});

describe("Gateway bind policy", () => {
  it("requires a token before non-loopback binding", () => {
    expect(() => createGatewayRuntime({ host: "0.0.0.0", port: 0 })).toThrow(/GATEWAY_TOKEN/);
  });
});
