---
name: openstar-self-review
description: OpenStar AI self-review skill for automated code review
---

# OpenStar Self-Review Skill

## Overview

This skill provides automated code review for OpenStar pull requests, inspired by Warp's `review-pr-local` skill. It performs static analysis, checks code quality, and validates adherence to OpenStar conventions.

## Review Criteria

### 1. Code Quality
- TypeScript/TSX files must pass type checking
- No `any` types unless explicitly justified
- Prefer `const` over `let`
- Avoid unnecessary destructuring

### 2. Architecture
- Follow monorepo structure: `packages/*/src`
- Use workspace dependencies: `@openstar/*`
- Keep packages focused and single-responsibility
- Cross-package imports must be through public exports

### 3. Security
- No hardcoded secrets or API keys
- Environment variables for sensitive config
- Input validation using Zod schemas
- No SQL injection vulnerabilities

### 4. Performance
- Lazy imports for heavy modules
- Avoid memory leaks in async operations
- Proper error handling with Effect
- Debounce/throttle expensive operations

### 5. Testing
- Unit tests for core logic
- Integration tests for API boundaries
- No mocked tests unless necessary
- Test files alongside source: `*.test.ts`

## Review Output Format

```json
{
  "verdict": "APPROVE | REQUEST_CHANGES | COMMENT",
  "findings": [
    {
      "severity": "blocking | warning | suggestion",
      "category": "correctness | security | performance | style",
      "file": "packages/core/src/index.ts",
      "line": 42,
      "summary": "Description of the issue",
      "suggestion": "Optional fix suggestion"
    }
  ],
  "summary": "Overall assessment"
}
```

## Visual Evidence Requirements

For UI changes (packages/ui-web, packages/desktop-pet):
- Screenshots or GIFs required for visual components
- Before/after comparisons
- Test output if automated tests exist

## Automation Integration

This skill is invoked by:
1. `.github/workflows/self-review.yml` - on PR events
2. `./scripts/review.sh` - local review
3. Claude Code with `/review` command

## Examples

### Blocking Issues
- Type errors that prevent compilation
- Security vulnerabilities (hardcoded secrets)
- Missing error handling for async operations
- Breaking changes without migration path

### Warning Issues
- Code duplication across files
- Inefficient algorithms
- Missing JSDoc comments on exported functions
- Unused imports

### Suggestions
- Use named exports instead of default
- Extract repeated logic into helpers
- Add runtime validation for complex configs
- Consider using Effect for error handling
