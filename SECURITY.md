# Security policy

This is an independent educational lab, not a supported production deployment.
Only the default branch is maintained; there is no security-update SLA.

## Report privately

Use this repository's **Security > Advisories > Report a vulnerability** option.
If private reporting is unavailable, contact the repository owner privately
through an existing trusted channel. Do not post exploit details, keys, tokens,
local environment files, APIM artifacts or unredacted workflow logs in public
issues or pull requests.

If credentials are exposed, revoke or rotate them immediately. Removing a file
from the latest commit does not remove it from history, forks or workflow logs.

## Known limitations

Review [dependency risks](docs/dependency-risks.md) before deploying or enabling
Azure-connected workflows. Do not assume an offline CI pass means no advisory
findings. The CLI operates with management-plane permissions.

The public promotion workflow is disabled unless a maintainer explicitly sets
`ENABLE_AZURE_PROMOTION=true`. It checks environment branch restrictions and
required reviewers before starting the Azure job. Forks must configure their own
identity, immutable OIDC subjects, resource variables and protections; the example
does not distribute Azure credentials.

See [the security model](docs/testing-and-security.md) for shared-backend,
subscription-key, network-exposure and rollback limitations.
