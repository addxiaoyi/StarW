---
name: openstar-triage-issue
description: OpenStar issue triage skill for automated labeling and routing
---

# OpenStar Issue Triage Skill

## Overview

This skill automates issue triage for OpenStar, analyzing bug reports and feature requests, then applying appropriate labels and routing to owners.

## Triage Process

### 1. Classify Issue Type

| Type | Indicators | Labels |
|------|------------|--------|
| Bug | "crash", "error", "not working", steps to reproduce | `type:bug` |
| Feature | "add", "implement", "support", "should" | `type:feature` |
| Question | "how", "what", "why", "?" | `type:question` |
| Enhancement | "improve", "better", "optimize" | `type:enhancement` |

### 2. Identify Affected Area

Based on issue content and affected packages:

| Area | Keywords | Packages |
|------|----------|----------|
| Core | adapter, ECC, config, ID | `packages/core` |
| CLI | command, terminal, args | `packages/cli` |
| Swarm | agent, orchestration, task | `packages/swarm` |
| MCP | server, tool, resource | `packages/mcp` |
| UI | interface, button, modal | `packages/ui-web` |
| Browser | automation, puppeteer | `packages/browser` |
| Canvas | drawing, graphics | `packages/canvas` |
| Pet | character, animation | `packages/pet`, `packages/desktop-pet` |

### 3. Determine Severity

| Severity | Indicators | Response |
|----------|------------|----------|
| Critical | crash, data loss, security | `priority:critical`, escalate immediately |
| High | major feature broken, workarounds difficult | `priority:high`, assign to team lead |
| Medium | feature partially working, workaround exists | `priority:medium`, normal sprint |
| Low | cosmetic, minor inconvenience | `priority:low`, backlog |

### 4. Check Reproducibility

For bugs, assess whether the issue is reproducible:
- **Yes** (clear steps) → Apply `ready-to-implement` if fix is obvious
- **Maybe** (steps unclear) → Apply `needs-info`, ask for reproduction steps
- **No** (cannot reproduce) → Apply `needs-info`, request environment details

## Follow-Up Questions (Max 2)

Ask high-value questions that meaningfully change the triage outcome:

1. **Environment**: OS, Node/Bun version, OpenStar version
2. **Reproduction**: Clear steps to reproduce
3. **Expected vs Actual**: What should happen vs what happens
4. **Logs**: Relevant error logs or screenshots

## Output Format

```json
{
  "type": "bug | feature | question | enhancement",
  "area": ["core", "cli", "swarm"],
  "severity": "critical | high | medium | low",
  "labels": ["area:core", "priority:medium"],
  "needs_info": true,
  "questions": [
    "What is your OpenStar version? Run `openstar --version`"
  ],
  "assignee": null,
  "ready": false,
  "notes": "Additional context for maintainers"
}
```

## Automation

This skill is invoked by:
1. `.github/workflows/triage-issue.yml` - on new issues
2. `./scripts/triage.sh` - local triage check
3. Claude Code with `/triage` command

## Owner Routing

Default routing based on area:

| Area | Primary Owner | Secondary Owner |
|------|---------------|-----------------|
| core | @core-team | @architecture |
| cli | @cli-team | @devtools |
| swarm | @agent-team | @orchestration |
| mcp | @protocol-team | @integration |
| ui | @design-team | @frontend |
