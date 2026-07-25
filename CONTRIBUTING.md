# Contributing to OpenStar

Thank you for contributing to OpenStar! This guide explains how to contribute.

## Getting Started

### Prerequisites
- Bun 1.3.14+
- Git
- Node.js 18+ (for some dependencies)

### Setup
```bash
# Clone the repository
git clone <your-fork>
cd openstar

# Initialize
./scripts/bootstrap.sh

# Run development
bun run dev
```

## Development Workflow

### 1. Create a Branch

```bash
# Create a feature branch
git checkout -b feat/your-feature

# Or use the workflow
./openstar workflows:run start-new-task --arg new_branch_name=feat/your-feature
```

### 2. Make Changes

Follow the code style guide in [AGENTS.md](./AGENTS.md).

### 3. Test Your Changes

```bash
# Type check
bun run typecheck

# Run tests
bun test

# Lint
bun run lint
```

### 4. Commit

Use conventional commits:
```
feat(core): add new adapter
fix(cli): resolve prompt display issue
docs: update README
chore: update dependencies
```

### 5. Create Pull Request

1. Push your branch
2. Open a PR using the template
3. AI will automatically review
4. Address feedback
5. Get approval and merge

## Automation

### AI Code Review

All PRs receive automatic AI review. The review checks:
- TypeScript type correctness
- Code quality and style
- Security vulnerabilities
- Test coverage
- Documentation

### Issue Triage

New issues are automatically triaged:
- Type classification (bug/feature/question)
- Area identification
- Severity assessment
- Owner routing

### Feature Flag Cleanup

Old feature flags are automatically cleaned up:
- Weekly scan for flags enabled > 3 months
- AI verification of removal safety
- Automated PR creation

## Packages

### Adding a New Package

1. Create `packages/your-package/`
2. Add `package.json` with workspace dependencies
3. Add to root `tsconfig.json` references
4. Create `src/index.ts` as entry point

### Dependencies

- **Internal**: Use workspace protocol: `"@openstar/other-package": "workspace:*"`
- **External**: Add to root `package.json` or the specific package

## Testing

### Writing Tests

```typescript
// src/utils.ts
export function add(a: number, b: number) {
  return a + b
}

// src/utils.test.ts
import { describe, expect, test } from 'bun:test'
import { add } from './utils'

describe('add', () => {
  test('adds two numbers', () => {
    expect(add(1, 2)).toBe(3)
  })
})
```

### Running Tests

```bash
bun test                    # All tests
bun test packages/core      # Specific package
```

## Documentation

### Updating Documentation

- Update relevant `.md` files
- Run `./scripts/changelog.sh` if adding features
- Update CHANGELOG.md

### Documenting Code

Use JSDoc for public APIs:

```typescript
/**
 * Adds two numbers together.
 * @param a - First number
 * @param b - Second number
 * @returns The sum of a and b
 */
export function add(a: number, b: number): number {
  return a + b
}
```

## Release Process

1. Update version in `package.json`
2. Run `./scripts/changelog.sh`
3. Create git tag
4. GitHub Actions creates the release

## Questions?

- Open an issue
- Check existing issues
- Read the documentation
