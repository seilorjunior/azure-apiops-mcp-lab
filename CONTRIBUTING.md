# Contributing

Contributions are welcome through pull requests. This is an independent community
example; contributions must not contain customer information or employer-owned
material you are not authorized to share.

## Local validation

Use Node.js 22 or later and PowerShell 7.2+ on Windows, or Bash on Linux/macOS.
`.nvmrc` selects Node 22 and `.editorconfig` defines shared whitespace defaults.
The optional devcontainer installs Node, Azure CLI/Bicep, azd and Docker; it
does not authenticate or deploy resources.

From the repository root:

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
feedback and keep required CI checks passing. The
[CODEOWNERS file](.github/CODEOWNERS) assigns every file to `@seilorjunior`.
PRs into `main` require code-owner approval unless the owner explicitly uses the
PR-only review bypass. The owner uses this bypass for their own PRs because GitHub
does not allow self-approval. It can also bypass approval for other authors' PRs;
the agreed policy is to review and approve those PRs normally.
Required CI and conversation resolution still apply. Automatic merging is disabled.
Copilot feedback does not count as a code-owner approval.

Fork maintainers must configure their own repository protections and Copilot
ruleset using the [setup checklist](docs/github-actions.md#repository-setup-checklist).
These GitHub settings are not installed by copying repository files.

- Keep changes focused and update directly related documentation and tests.
- Preserve dry-run defaults, source/target isolation, explicit API-only filters,
  secret-redaction checks and source-preservation assertions.
- Keep PowerShell and Bash behavior aligned; use LF for shell scripts.
- Extend `test/shell-matrix.json` for shared preprovision/proxy scenarios; both
  shell suites must consume the same case rather than diverging.
- Do not commit `.env` files, azd state, raw APIM artifacts, backend credentials,
  subscription keys, access tokens or generated deployment archives.
- [Hash-only API snapshots](docs/api-snapshots.md) may be committed after reviewing
  their API IDs and resource-file names. They must not contain exported values
  or policy text. Review the actual configuration privately before accepting hashes.
- Use fictional Azure IDs in fixtures. Public client/subscription identifiers
  are not passwords, but there is no reason to embed a contributor's real IDs.
- Do not force dependency overrides or SDK/Express downgrades to hide audit
  warnings. Document upstream blockers and validate compatible fixes.
- Review the separate [dependency-risk audit](docs/dependency-risks.md#automated-tracking)
  when changing dependencies. Any proposed exception needs an exact advisory,
  package and scope, a responsible owner, a reason and a UTC expiry date. Keep
  expired or resolved exceptions out of the policy; do not renew them automatically.

Contributions are provided under the [MIT license](LICENSE). Security issues
must follow [the private reporting policy](SECURITY.md), not public issue templates.

## Releases

Record user-visible changes under `Unreleased` in [CHANGELOG.md](CHANGELOG.md).
Only maintainers publish releases; preparing a PR does not publish or deploy.
For a release, update `package.json` and the lockfile with `npm version <patch|minor|major> --no-git-tag-version`,
move the relevant changelog entries to `## [<version>] - YYYY-MM-DD`, and commit
the reviewed changes through the normal PR process.

After merging and checking CI, create an annotated `v<version>` tag on that
reviewed commit and push it. The release workflow checks that the stable SemVer
tag exactly matches the package version and has a nonempty versioned changelog,
runs tests/lint/types and builds the image, then publishes those changelog notes
as a GitHub Release. It does not publish npm packages or images, deploy Azure,
or grant Azure permissions. Protect `v*` tags with a repository ruleset that
restricts creation/update/deletion to maintainers; copying the workflow does
not configure repository rulesets.
