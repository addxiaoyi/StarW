# OpenStar P0 Engineering Baseline

**Captured:** 2026-07-24
**Workspace:** `D:\qwq\项目\claudegod`

## Git boundary

- Branch at initial capture: `master`
- Initial HEAD: `74e5ace5b431d5b557c3380306fa79f577e0c8ed`
- Upstream at initial capture: none
- Staged reference-project deletions at initial capture: 15,672

The pre-existing staged reference-project deletion was intentionally left untouched. This work did not run `git reset`, `git checkout`, `git clean`, bulk staging, commit, or push.

## Runtime contract

OpenStar supports the following primary runtimes:

- Node.js 24 or later
- Bun 1.3 or later

Persistence uses built-in synchronous SQLite implementations:

- `node:sqlite` under Node.js
- `bun:sqlite` under Bun

The project no longer depends on the native `better-sqlite3` binary.

## Type checking

The legacy root command `bun x tsc --noEmit` exceeded the V8 heap near 4 GB and remains available as `typecheck:legacy` for diagnostics.

The production gate checks packages sequentially:

```bash
bun run typecheck
```

Verified result:

```text
Typecheck summary: 15/15 packages passed.
```

A subset can be checked with:

```bash
set OPENSTAR_TYPECHECK_PACKAGES=core,swarm
bun run typecheck
```

## Tests

The complete Vitest suite reports:

```text
Test Files  20 passed (20)
Tests       149 passed (149)
```

All SQLite persistence tests execute against the active runtime's built-in SQLite implementation. There are no skipped tests.

Electron policy tests report:

```text
Tests  20 passed
```

## Builds

Verified production builds:

- Web UI: `bun run build`
- CLI: `bun run build:cli`
- Electron package-readiness gate: `bun run --cwd packages/desktop-electron prepare:package`

The CLI build keeps workspace dependencies external and does not bundle native addons.

The Electron package-readiness gate builds a minimal 0.52 MB read-only StarCore engine, validates package inputs and 512×512/ICO icon assets, and launches the bundled engine through Electron's `ELECTRON_RUN_AS_NODE=1` mode. Packaged applications therefore do not require a system Bun installation or access to repository source files.

## Security boundary

The P0/P1 baseline includes:

- Gateway loopback-by-default binding, bearer-token support, strict origin allowlisting, request-size limits, and no-store responses.
- Workspace-confined file access with traversal and symbolic-link escape protection.
- Allowlisted non-shell command execution using `execFile` semantics.
- MCP environment, process, command, and filesystem capability gates.
- Electron sandboxing, permission denial, navigation restrictions, trusted IPC sender validation, and a narrowed preload API.
- Real SwarmManager execution with concurrency, dependency, priority, timeout, cancellation, and worker state.
- AgentRuntime lifecycle streaming for iterations and tool execution.
- Provider URL and credential validation, secret-redacted upstream errors, strict JSON response validation, and protocol-correct OpenAI-compatible and Anthropic tool messages.

## MCP project boundary

All MCP source files under `packages/mcp/src/` are covered by `packages/mcp/tsconfig.json`.

The former standalone server prototypes were removed after audit because they were unreachable from the published entrypoint, duplicated production packages or active tool sets, and included unsafe or simulated behavior such as shell execution, unrestricted filesystem access, `eval`, and fabricated browser/AI results. New MCP capabilities must use the shared `MCPServer`/`ToolDefinition` contract and the central security boundary.

## Continuous integration and release boundary

The GitHub Actions quality gate uses fixed Node.js 24 and Bun 1.3.14 runtimes. It performs a frozen lockfile install, `bun run presubmit`, the web and CLI production builds, and Electron boundary tests without fallback or error-suppression paths.

The desktop workflow runs the complete Electron package-readiness gate before platform-specific Windows, macOS, and Linux packaging. It validates each release artifact and verifies that every unpacked application contains `app.asar`, `resources/engine/openstar-engine.mjs`, and `resources/ui-web/index.html`. Branch pushes, version tags, and manual dispatches are supported.

Windows is portable-only. The build resolves the matching Electron archive from the installed dependency before enabling network fallback and produces a single `OpenStar-<version>-portable-win-x64.exe` with no installer, Start menu entry, desktop shortcut, or uninstaller. At runtime, persistent state is stored in an `OpenStar-Data` directory beside the portable executable. The portable executable is launched directly in a headless acceptance mode that verifies the packaged application, embedded StarCore engine, resources, and RPC status before cleaning its temporary test data. macOS and Linux artifacts remain platform-specific CI acceptance artifacts.

A real-provider smoke harness is available as `bun run smoke:providers:live`. It refuses to run unless `OPENSTAR_LIVE_PROVIDER_SMOKE=1` is set, requires explicit provider model names, performs real billable network calls only for selected providers, validates the exact response token, and never prints API keys. No OpenAI, Anthropic, or Kimi live smoke is recorded as passing until valid credentials and models are supplied.

Tag releases create a draft GitHub Release containing fresh web, CLI, and desktop-engine `tar.gz` archives. Version tags also trigger the cross-platform desktop packaging workflow. The former deployment workflow is now a manual deployment-readiness check: it executes the package-readiness gate, uploads web/CLI/desktop-engine artifacts, and explicitly does not modify a remote environment because no deployment provider or credentials are configured.

`bun audit --audit-level high` currently receives HTTP 404 from the configured audit endpoint. No vulnerability result can be inferred from that response, so dependency audit is not represented as a passing gate and is not suppressed with `|| true`.

## Formatting debt gate

The repository currently has 180 pre-existing source files that do not match the strict Prettier output. They are recorded with source SHA-256 hashes in `docs/engineering/PRETTIER-BASELINE.txt`.

`bun run format:check` fails when:

- a new unformatted TypeScript or TSX file is introduced; or
- a known unformatted file changes without being formatted.

The complete strict audit remains available as `bun run format:strict`. This allows the debt count to decrease without rewriting unrelated files in a dirty worktree.

## Acceptance result

1. All 15 production packages pass deterministic type checking.
2. All 149 Vitest tests execute and pass; none are skipped.
3. Web UI and CLI production builds pass.
4. All 20 Electron policy, portable-data, renderer-target, package-builder, and packaged-engine launch tests pass.
5. SQLite persistence no longer depends on an external native binding.
6. Gateway, MCP, Electron, Provider, Swarm, and AgentRuntime security and execution boundaries have regression coverage.
7. MCP's production TypeScript graph covers all remaining source files; unsafe and simulated standalone prototypes are removed.
8. CI, release, desktop packaging, and deployment-readiness workflows use fixed runtimes, build the embedded engine, validate package resources, and fail closed on supported quality gates.
9. The pre-existing reference-project deletion index remains outside this work's control.

## Embedded desktop runtime acceptance

The portable Electron application now uses an embedded event-capable JSON-RPC runtime rather than a read-only status bridge or an externally started ACP process. The packaged runtime provides workspace-bounded command execution, ToolRegistry execution, file list/read/write, masked persistent configuration, provider-backed chat sessions, Agent/Swarm task execution, and official MCP SDK stdio connections. Renderer views for Terminal, Chat, Files, Agents, Skills, MCP, Browser, and Settings are routed from the active application entry and load real runtime data.

Acceptance rules:

- Commands are limited to the configured workspace, a maximum timeout, and 5 MiB combined output. The command interface is non-PTY.
- File list/read/write is restricted to the configured workspace; preview and write payloads are limited to 5 MiB.
- Provider calls require an explicitly enabled provider, API key, and model. No live-provider success is recorded without real credentials.
- MCP uses real stdio processes and the official SDK. No external MCP connection success is recorded when no server is configured.
- The Browser view opens validated HTTP/HTTPS URLs in the system browser; it does not present simulated page content.
- Configuration returned to the renderer contains only masked key hints and never raw API keys.
