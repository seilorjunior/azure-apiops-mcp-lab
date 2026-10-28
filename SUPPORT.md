# Support

This is an independent community lab, not a Microsoft product. Support is
best-effort through this repository's issues; there is no support SLA.

Start with the [operations runbook](docs/operations.md),
[troubleshooting guide](docs/troubleshooting.md) and
[known dependency risks](docs/dependency-risks.md). For a reproducible defect,
use the bug-report template. For an enhancement, use the feature-request template.
Include your OS, shell, Node/APIops/azd versions, deployment mode, failing stage,
expected behavior and a minimal sanitized reproduction.

Never attach `.azure` state, `.env` files, raw APIM exports, credentials,
subscription keys or unredacted logs. Review logs before sharing, even when
structured logging is enabled. Report vulnerabilities privately as described
in [SECURITY.md](SECURITY.md), not in a public issue.

Azure account, billing, quota and service availability problems belong with
Azure Support. Upstream APIops CLI defects belong in the upstream project after
isolating them from this lab. Do not copy private configuration into either venue.

Billing continues until resources are deleted. After checking the selected azd
environment and its dedicated resource group, use `azd down` to tear down the lab;
see [cost controls](docs/operations.md#cleanup-and-cost-control).
