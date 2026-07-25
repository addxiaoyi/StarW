---
name: openstar-changelog-draft
description: Generate changelog drafts for OpenStar releases
---

# OpenStar Changelog Draft Generator

## Overview

Generates reviewable changelog drafts from merged PRs in a release range. Classifies changes, attributes external contributors, and outputs markdown + JSON artifacts.

## Inputs

| Parameter | Required | Description |
|-----------|----------|-------------|
| `channel` | yes | Release channel: `stable`, `preview`, or `dev` |
| `release_tag` | yes | Tag for this release (e.g., `v0.1.0.stable_00`) |
| `output_dir` | no | Output directory, defaults to temp |
| `attribution` | no | `external-only` (default), `all`, or `none` |

## Workflow

### Step 1: Determine Release Range

Find the previous release cut for comparison:

```bash
# Get previous stable release
PREV_TAG=$(git tag --list "v0.*.stable_00" --sort=-v:refname | head -2 | tail -1)
CURRENT_TAG="v0.1.0.stable_00"
git log ${PREV_TAG}..${CURRENT_TAG} --oneline
```

### Step 2: Fetch PR Data

Collect all merged PRs in the range:

```bash
gh pr list \
  --state merged \
  --base main \
  --json number,title,author,body,labels,mergedAt,url \
  --limit 100
```

### Step 3: Extract Changelog Markers

Parse PR bodies for explicit markers:
- `CHANGELOG-NEW-FEATURE:` → New Features
- `CHANGELOG-IMPROVEMENT:` → Improvements
- `CHANGELOG-BUG-FIX:` → Bug Fixes
- `CHANGELOG-NONE:` → Excluded

### Step 4: Classify Unmarked PRs

For PRs without explicit markers:

| Category | Criteria |
|----------|----------|
| NEW-FEATURE | New package, major capability |
| IMPROVEMENT | Enhancement to existing feature |
| BUG-FIX | Fix for reported issue |
| SKIP | Docs, CI, tests, bot PRs |

### Step 5: Attribution

- External contributors credited in "Community" section
- External reporters credited when their issues are fixed
- Internal team not credited (standard practice)

## Output Format

### Markdown (changelog-draft.md)

```markdown
# OpenStar Changelog Draft
**Channel:** stable
**Range:** v0.1.0... → v0.2.0...
**Generated:** 2026-07-14

## New Features
- Added AI Relay MCP server ([#123](https://github.com/openstar/openstar/pull/123)) — [@contributor](https://github.com/contributor) ✨

## Improvements
- Faster CLI startup time ([#124](https://github.com/openstar/openstar/pull/124))

## Bug Fixes
- Fixed desktop pet animation freeze ([#125](https://github.com/openstar/openstar/pull/125))

## Community
### Contributors
Thanks to our community contributors:
- [@contributor1](https://github.com/contributor1)

### Issue Reporters
Thanks to users who reported issues:
- [@reporter1](https://github.com/reporter1) — Fixed crash on startup
```

### JSON (changelog-draft.json)

```json
{
  "channel": "stable",
  "range": { "base": "v0.1.0", "head": "v0.2.0" },
  "generated_at": "2026-07-14T00:00:00Z",
  "entries": [
    {
      "pr_number": 123,
      "url": "https://github.com/openstar/openstar/pull/123",
      "category": "NEW-FEATURE",
      "text": "Added AI Relay MCP server",
      "author": "contributor",
      "is_external": true
    }
  ],
  "contributors": ["contributor1"],
  "issue_reporters": []
}
```

## Validation

- Every PR in range appears in entries, skipped, or needs_review
- No broken links in markdown
- External attribution verified via GitHub API
- Release JSON matches markdown content

## Constraints

- Never modify `channel_versions.json`
- Never push commits or create branches
- All output to `output_dir` only
