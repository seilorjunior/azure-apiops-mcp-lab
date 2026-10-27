# Contributing

Contributions are welcome through pull requests. This is an independent community
example; contributions must not contain customer information or employer-owned
material you are not authorized to share.

## Local validation

Use Node.js 22 or later and PowerShell 7.2+ on Windows, or Bash on Linux/macOS:

```text
npm ci
npm test
az bicep build --file infra/main.bicep --stdout
```

The tests use fictional subscription IDs and mock Azure and APIops publication.
They must work without Azure authentication. CI runs them on Windows and Ubuntu,
and compiles Bicep without logging in.

Do not deploy resources, grant roles or run a live promotion as part of a pull
request. Never use `pull_request_target` to execute untrusted contributor code
with an Azure identity. Dependabot PRs are subject to the same review and CI.

## Changes and review

The upstream repository requests Copilot reviews automatically for new PRs targeting
any branch, including drafts. New pushes do not automatically trigger another
review; request a fresh Copilot review manually when needed. Address relevant
feedback and keep required CI checks passing. Copilot feedback does not count as
the required human approval, and authors cannot approve their own PRs.

Fork maintainers must configure their own repository protections and Copilot
ruleset using the [setup checklist](docs/github-actions.md#repository-setup-checklist).
These GitHub settings are not installed by copying repository files.

- Keep changes focused and update directly related documentation and tests.
- Preserve dry-run defaults, source/target isolation, explicit API-only filters,
  secret-redaction checks and source-preservation assertions.
- Keep PowerShell and Bash behavior aligned; use LF for shell scripts.
- Do not commit `.env` files, azd state, APIM artifacts, backend credentials,
  subscription keys, access tokens or generated deployment archives.
- Use fictional Azure IDs in fixtures. Public client/subscription identifiers
  are not passwords, but there is no reason to embed a contributor's real IDs.
- Do not force dependency overrides or SDK/Express downgrades to hide audit
  warnings. Document upstream blockers and validate compatible fixes.

Contributions are provided under the [MIT license](LICENSE). Security issues
must follow [the private reporting policy](SECURITY.md), not public issue templates.
