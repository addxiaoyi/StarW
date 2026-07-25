import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@openstar/core": pkg("core"),
      "@openstar/swarm": pkg("swarm"),
      "@openstar/protocol": pkg("protocol"),
      "@openstar/relay": pkg("relay"),
      "@openstar/gateway": pkg("gateway"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/desktop-electron/test/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/build/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["packages/*/src/**/*.ts"],
      exclude: [
        "packages/*/src/**/*.test.ts",
        "packages/ui-web/**",
        "packages/desktop-electron/**",
      ],
    },
    testTimeout: 10_000,
  },
});
