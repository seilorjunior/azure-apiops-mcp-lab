# Changelog

Notable changes are recorded here. Versions follow Semantic Versioning.
The package version identifies the lab, not the upstream APIops CLI.

## [Unreleased]

### Added

- Non-root Docker image with health checks and an opt-in containerized App Service
  deployment using ACR and managed-identity image pulls.
- Structured, credential-safe request/error logs and graceful server shutdown.
- Bounded MCP request timeouts and exponential-backoff retries for initialization
  and discovery, without replaying tool calls.
- Shared Bash/PowerShell test scenarios, Node/editor defaults and a devcontainer.
- Tag-triggered GitHub releases, feature requests and community support guidance.
- Optional resource-group monthly budget alerts and one-command teardown guidance.

### Fixed

- Accept supported App Service hosting tiers regardless of Azure's response casing
  during promotion preflight, while continuing to reject Free/Shared and unknown tiers.

## [1.0.0]

### Added

- Initial lab baseline: two Developer-tier APIM instances, a shared Node.js
  App Service MCP backend with `/health`, and APIops promotion.
- Offline application and shell tests, deployment preflight, API snapshots,
  dependency-risk tracking and opt-in GitHub Actions promotion.
