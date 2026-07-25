# Branch and Change Management

## Canonical branch

`main` is the canonical integration and release branch. Direct development should occur on short-lived branches created from the latest `main`.

Recommended branch names:

- `feat/<scope>-<description>`
- `fix/<scope>-<description>`
- `refactor/<scope>-<description>`
- `docs/<description>`
- `chore/<description>`

Do not use `master` for new work. Historical local branches must not be force-pushed over `main`.

## Update before development

```bash
git fetch origin --prune
git switch main
git pull --ff-only origin main
git switch -c feat/example-change
```

Use `--ff-only` when updating `main`. Resolve divergent feature branches by rebasing or merging deliberately; never rewrite the shared `main` history.

## Required local gates

Before opening or updating a pull request, run:

```bash
bun install --frozen-lockfile
bun run format:check
bun run typecheck
bun run test
bun run build
```

Run additional package or platform checks when the change affects CLI packaging, Electron, providers, release automation, or native dependencies.

## Commit policy

Use Conventional Commit subjects:

```text
feat(core): add runtime capability
fix(ui-web): preserve unsaved editor state
refactor(desktop): isolate IPC policy
chore(deps): update runtime dependencies
```

Keep commits reviewable and avoid mixing generated artifacts, local runtime data, screenshots, downloaded tools, or unrelated cleanup with core changes.

## Pull requests

Every pull request should:

1. explain the problem and chosen design;
2. list affected packages and compatibility impact;
3. include tests or a specific reason tests are not required;
4. include visual evidence for user-interface changes;
5. document migrations or breaking behavior;
6. contain no credentials, local databases, build outputs, or dependency directories.

CODEOWNERS review is required for repository automation and security-sensitive runtime boundaries.

## Releases

Release candidates are created from `main`. Version tags use `v*` and trigger the release workflow, which validates the repository and creates a draft GitHub Release. Do not tag unverified local branches.
