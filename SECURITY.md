# Security Policy

## Supported versions

Security fixes are applied to the latest release and the current `main` branch. Older snapshots and unmaintained forks are not supported.

## Reporting a vulnerability

Do not disclose suspected vulnerabilities in a public issue, discussion, pull request, or chat log.

Use GitHub's private vulnerability reporting flow from the repository **Security** tab. Include:

- affected package, component, and version or commit;
- reproduction steps or a minimal proof of concept;
- expected and observed security impact;
- operating system and runtime versions;
- any suggested mitigation, when available.

Remove API keys, tokens, personal data, private repository content, and other secrets from the report and its attachments.

The maintainer will validate the report, coordinate remediation, and publish an advisory when disclosure is appropriate. Please allow a reasonable remediation window before public disclosure.

## Security-sensitive areas

Changes to authentication, filesystem boundaries, process execution, IPC, MCP tools, network access, persistence, secret storage, package signing, and release workflows require focused tests and maintainer review.
