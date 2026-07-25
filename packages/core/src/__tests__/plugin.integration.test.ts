import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadPluginsFromDir, initPluginRegistry } from "../plugins/index.js";

describe("Plugin SDK integration", () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "openstar-plugin-"));
    const pluginDir = path.join(dir, "hello");
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginDir, "plugin.json"),
      JSON.stringify({
        name: "hello",
        version: "1.0.0",
        description: "Test plugin",
        openstar: { capabilities: ["dag-pattern"], permissions: [] },
      }),
    );
    fs.writeFileSync(
      path.join(pluginDir, "contributions.json"),
      JSON.stringify({
        dagPatterns: [
          { id: "hi", name: "Hi", description: "d", category: "pipeline", definition: {} },
        ],
      }),
    );
  });

  it("loads, enables, and exposes contributions", async () => {
    const registry = initPluginRegistry();
    const count = await loadPluginsFromDir(dir, registry);
    expect(count).toBe(1);
    expect(registry.isEnabled("hello")).toBe(true);

    const contribs = registry.getContributions("dagPatterns");
    expect(contribs.length).toBe(1);
    expect((contribs[0] as unknown as { id: string }).id).toBe("hi");
  });
});
