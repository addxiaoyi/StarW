import path from "node:path";
import { describe, expect, it } from "vitest";
import { prepareCommand, redactSecrets, resolveWorkspacePath } from "../security.js";

describe("Gateway security policy", () => {
  it("blocks executable paths and command chaining", () => {
    expect(() => prepareCommand("C:\\Windows\\System32\\cmd.exe /c whoami")).toThrow(/Executable paths/);
    expect(() => prepareCommand("git status && whoami")).toThrow(/Shell operators/);
  });

  it("does not confuse sibling path prefixes", () => {
    const root = path.resolve("workspace");
    const sibling = path.resolve("workspace-secret", "value.txt");
    expect(resolveWorkspacePath(root, sibling).allowed).toBe(false);
  });

  it("redacts nested secrets", () => {
    expect(redactSecrets({ providers: { openai: { apiKey: "secret", model: "x" } } })).toEqual({
      providers: { openai: { apiKey: "[REDACTED]", model: "x" } },
    });
  });
});
