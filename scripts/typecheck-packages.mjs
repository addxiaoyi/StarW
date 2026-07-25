import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const PACKAGES_DIR = path.join(ROOT_DIR, "packages");
const TSC_PATH = path.join(ROOT_DIR, "node_modules", "typescript", "bin", "tsc");
const MAX_HEAP_MB = parsePositiveInt(process.env.OPENSTAR_TSC_MAX_MB, 4096);
const TIMEOUT_MS = parsePositiveInt(process.env.OPENSTAR_TSC_TIMEOUT_MS, 120_000);
const SKIPPED_PACKAGES = new Set(["desktop-electron"]);
const PACKAGE_FILTER = new Set(
  (process.env.OPENSTAR_TYPECHECK_PACKAGES ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean),
);

function parsePositiveInt(raw, fallback) {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function findPackages() {
  return fs
    .readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !SKIPPED_PACKAGES.has(entry.name))
    .map((entry) => entry.name)
    .filter((name) => {
      const dir = path.join(PACKAGES_DIR, name);
      return fs.existsSync(path.join(dir, "package.json")) && fs.existsSync(path.join(dir, "src"));
    })
    .filter((name) => PACKAGE_FILTER.size === 0 || PACKAGE_FILTER.has(name))
    .sort();
}

function writeFallbackConfig(tempDir, packageName) {
  const packageDir = path.join(PACKAGES_DIR, packageName);
  const configPath = path.join(tempDir, `${packageName}.json`);
  const relativeRootConfig = toPosix(path.relative(tempDir, path.join(ROOT_DIR, "tsconfig.json")));
  const relativeSource = toPosix(path.relative(tempDir, path.join(packageDir, "src")));
  const config = {
    extends: relativeRootConfig.startsWith(".") ? relativeRootConfig : `./${relativeRootConfig}`,
    compilerOptions: {
      noEmit: true,
      incremental: false,
      declaration: false,
      declarationMap: false,
      sourceMap: false,
      jsx: "preserve",
      jsxImportSource: "solid-js",
      types: ["node", "bun", "vitest/globals"],
    },
    include: [`${relativeSource}/**/*.ts`, `${relativeSource}/**/*.tsx`],
    exclude: [
      toPosix(path.relative(tempDir, path.join(ROOT_DIR, "node_modules"))),
      toPosix(path.relative(tempDir, path.join(packageDir, "dist"))),
    ],
  };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}${os.EOL}`, "utf8");
  return configPath;
}

function resolveConfig(tempDir, packageName) {
  const packageConfig = path.join(PACKAGES_DIR, packageName, "tsconfig.json");
  return fs.existsSync(packageConfig) ? packageConfig : writeFallbackConfig(tempDir, packageName);
}

function runTypecheck(configPath) {
  const startedAt = Date.now();
  const run = spawnSync(
    process.execPath,
    [
      `--max-old-space-size=${MAX_HEAP_MB}`,
      TSC_PATH,
      "--project",
      configPath,
      "--pretty",
      "false",
    ],
    {
      cwd: ROOT_DIR,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      timeout: TIMEOUT_MS,
    },
  );
  return {
    durationMs: Date.now() - startedAt,
    exitCode: run.status,
    signal: run.signal,
    error: run.error,
    output: `${run.stdout ?? ""}${run.stderr ?? ""}`.trim(),
  };
}

function printFailure(packageName, run) {
  console.error(`FAIL ${packageName} (${run.durationMs}ms)`);
  if (run.error) console.error(`  ${run.error.message}`);
  if (run.signal) console.error(`  terminated by ${run.signal}`);
  if (run.output) console.error(run.output);
}

function main() {
  if (!fs.existsSync(TSC_PATH)) {
    console.error(`TypeScript compiler not found: ${TSC_PATH}`);
    console.error("Run `bun install` before typechecking.");
    process.exitCode = 2;
    return;
  }

  const packages = findPackages();
  if (packages.length === 0) {
    console.error("No matching TypeScript packages found.");
    process.exitCode = 2;
    return;
  }

  const tempRoot = path.join(ROOT_DIR, ".tmp");
  fs.mkdirSync(tempRoot, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(tempRoot, "typecheck-"));
  const failures = [];

  try {
    for (const packageName of packages) {
      const configPath = resolveConfig(tempDir, packageName);
      const run = runTypecheck(configPath);
      if (run.exitCode === 0) {
        console.log(`PASS ${packageName} (${run.durationMs}ms)`);
        continue;
      }
      failures.push(packageName);
      printFailure(packageName, run);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log(`Typecheck summary: ${packages.length - failures.length}/${packages.length} packages passed.`);
  if (failures.length > 0) {
    console.error(`Failed packages: ${failures.join(", ")}`);
    process.exitCode = 1;
  }
}

main();
