# Contributing to OpenStar

Contributions should be based on the latest `main` branch and submitted through focused pull requests.

## Prerequisites

- Bun 1.3.14 or newer compatible 1.3 release
- Node.js 24 or newer
- Git
- Platform build tools only when working on native or Electron packaging

## Setup

```bash
git clone https://github.com/addxiaoyi/StarW.git
cd StarW
bun install --frozen-lockfile
```

Start the web application with:

```bash
bun run dev
```

Desktop development instructions are documented in [CONTRIBUTING-DESKTOP.md](./CONTRIBUTING-DESKTOP.md).

## Development workflow

Create a short-lived branch from the latest `main`:

```bash
git fetch origin --prune
git switch main
git pull --ff-only origin main
git switch -c feat/your-change
```

See [Branch and Change Management](./docs/engineering/BRANCHING.md) for branch naming, update, review, and release rules.

## Quality gates

Run the same core gates used by CI before opening or updating a pull request:

```bash
bun run format:check
bun run typecheck
bun run test
bun run build
```

Useful focused commands include:

```bash
bun run typecheck:ui
bun run test:core
bun run test:swarm
bun run test:mcp
bun run test:ui
bun run test:desktop
bun run build:cli
bun run build:desktop
```

Add or update tests for behavior changes. UI changes should include screenshots or recordings in the pull request. Changes to native dependencies, Electron packaging, provider integrations, or release workflows require their additional platform-specific checks.

## Code and dependency conventions

- Follow the repository guidance in [AGENTS.md](./AGENTS.md).
- Use `workspace:*` for internal package dependencies.
- Add external dependencies to the narrowest appropriate package.
- Do not commit `node_modules`, build outputs, local databases, credentials, downloaded executables, runtime profiles, or test screenshots.
- Keep public APIs documented and preserve compatibility unless the pull request explicitly describes a migration.

## Commits

Use Conventional Commit subjects:

```text
feat(core): add a runtime adapter
fix(cli): correct prompt rendering
test(swarm): cover dependency release order
docs: update desktop setup
chore(deps): update dependencies
```

Keep each commit coherent and avoid combining unrelated cleanup with functional changes.

## Pull requests

Use the pull request template and include:

- the problem and implementation summary;
- affected packages and compatibility impact;
- tests and validation performed;
- visual evidence for UI changes;
- migration notes for breaking changes;
- linked issues when applicable.

Repository automation and security-sensitive runtime boundaries are reviewed through CODEOWNERS. A pull request is ready to merge only after required checks pass and review comments are resolved.

## Security

Do not report vulnerabilities publicly. Follow [SECURITY.md](./SECURITY.md) and use the repository's private vulnerability reporting flow.

## Releases

Releases are cut from verified `main` commits. Tags matching `v*` trigger validation and creation of a draft GitHub Release. Do not create release tags from local feature branches.
