# GitHub Actions workflows

[Project overview](../README.md) | [Operations](operations.md) | [Testing and security](testing-and-security.md)

The **Actions > Workflows** sidebar includes both workflows stored in this
repository and workflows managed by GitHub. They have different purposes:
testing code, reviewing changes, maintaining dependencies, publishing releases
and explicitly promoting APIs. A green run in one does not prove that the others
passed or that the Azure lab works.

## Workflow overview

| Sidebar name | Definition or owner | When it runs | Purpose |
| --- | --- | --- | --- |
| [CI](#ci) | [ci.yml](../.github/workflows/ci.yml) | Push to `main`, any pull request, or manual dispatch. | Test application/scripts, enforce quality, validate Bicep and smoke-test the container. |
| [CodeQL](#codeql) | [codeql.yml](../.github/workflows/codeql.yml) | Push to `main`, any pull request, and Mondays at 04:17 UTC. | Static security analysis of JavaScript/TypeScript and Actions workflows. |
| [Copilot](#copilot) | GitHub-managed code review. | A manual review request or an automatic review rule. | Gather review context and provide feedback on proposed changes. |
| [Copilot cloud agent](#copilot-cloud-agent) | GitHub-managed coding agent. | A task is delegated to the agent, or an existing task is continued. | Investigate or implement a requested change in a cloud environment. |
| [Dependabot Updates](#dependabot-updates) | GitHub-managed; configured by [dependabot.yml](../.github/dependabot.yml). | Weekly version-update checks; checks can also be requested from Dependabot's UI. | Propose npm dependency and GitHub Actions updates. |
| [Dependabot auto-merge](#dependabot-auto-merge) | [dependabot-auto-merge.yml](../.github/workflows/dependabot-auto-merge.yml) | Dependabot PR creation, reopening, new commits, edits or readiness for review. | Queue eligible npm patch/minor updates after verifying file scope and required branch rules. |
| [Dependency risk audit](#dependency-risk-audit) | [dependency-audit.yml](../.github/workflows/dependency-audit.yml) | Mondays at 09:23 UTC or manual dispatch. | Evaluate known dependency advisories and time-limited exceptions. |
| [Promote APIM APIs](#promote-apim-apis) | [promote.yml](../.github/workflows/promote.yml) | Manual dispatch only, with environment approval. | Preview or apply API configuration promotion to an existing Azure lab. |
| [Release](#release) | [release.yml](../.github/workflows/release.yml) | Push of a tag matching `v*.*.*`. | Verify the tagged code and publish versioned changelog notes as a GitHub release. |
| [Supply chain](#supply-chain) | [supply-chain.yml](../.github/workflows/supply-chain.yml) | Push to `main`, selected dependency/workflow PR changes, or manual dispatch. | Verify npm signatures/provenance and upload a production dependency inventory. |

Scheduled runs use the default branch and can be delayed by GitHub. Fork owners
must enable Actions and scheduled workflows in their own repository. The YAML
push filters explicitly name `main`; changing the default branch does not update
those filters automatically.

The three GitHub-managed entries do **not** have matching files under
`.github/workflows`. GitHub currently identifies them with the paths
`dynamic/agents/copilot-pull-request-reviewer`,
`dynamic/copilot-swe-agent/copilot` and
`dynamic/dependabot/dependabot-updates`, respectively. These are service-managed
identifiers, not files to create or edit. Their availability and behavior depend
on GitHub settings and access; copying this repository does not copy those
settings. The sidebar pin icons only organize your workflow shortcuts; pinning
does not enable, trigger or protect a workflow.

## CI

**Trigger:** push to `main`, any pull request, or **Run workflow**.
The [definition](../.github/workflows/ci.yml) runs four independent job types:

| Job | What it checks |
| --- | --- |
| `Test (ubuntu-24.04)` and `Test (windows-2025)` | Restore the lockfile with `npm ci`, then run `npm test`. The shared Node tests run on both platforms; shell regressions select Bash on Linux and PowerShell on Windows. The matrix does not stop the other platform on failure. |
| `Lint, types and coverage` | ESLint, TypeScript checks, Node coverage thresholds, ShellCheck and PSScriptAnalyzer. Coverage requires at least 75% lines, 85% branches and 80% functions for the selected Node test suites; shell tests are not included in those coverage figures. |
| `Validate infrastructure` | Lint and compile both `infra/main.bicep` and `infra/container.bicep`, without signing in to Azure. Compilation does not prove a live deployment will succeed. |
| `Container smoke test` | Build and run the Docker image locally on the runner; verify non-root execution, health, unauthenticated MCP rejection, authenticated `echo`, sanitized JSON logs and graceful shutdown. It does not publish an image. |

CI uses the Node version in `.nvmrc`, read-only repository permissions and no
Azure credentials. Its application/script tests use mocks or local services, not
the APIM gateways. Dependency installation and tool setup still require network
access; "offline tests" means no live Azure or advisory-registry acceptance gate,
not an air-gapped workflow.

New runs cancel older in-progress CI runs for the same Git ref. Read the failed
job's logs to identify whether the problem is platform-specific, code quality,
Bicep or Docker. The five checks required for dependency auto-merge are documented
under [PR protection setup](#configure-pull-request-protection-and-copilot);
creating workflow files alone does not make every job a required merge check.

## CodeQL

**Trigger:** push to `main`, any pull request, or the weekly Monday schedule.
There is no `workflow_dispatch`, so this definition does not provide a
**Run workflow** button.

The [analysis job](../.github/workflows/codeql.yml) scans
`javascript-typescript` and `actions` using CodeQL with `build-mode: none`.
It does not run the backend, perform MCP acceptance tests or audit npm dependency
versions. It has `contents: read` and job-scoped `security-events: write` to
publish code-scanning results, not Azure access.

Review findings in **Security > Code scanning** and the PR's scanning results.
A completed analysis can still report vulnerabilities: workflow success means
analysis completed, not necessarily zero alerts. Alert-based merge blocking
requires the corresponding repository protection settings. Investigate job
failures in the analysis logs rather than treating missing results as a clean
scan. Code scanning availability depends on repository visibility and GitHub
security features.

## Copilot

This is the GitHub-managed **Copilot code review** entry, not the cloud coding
agent and not a test suite. Its Actions work supports agentic review capabilities,
such as gathering repository context. The useful output is review feedback on
the PR; workflow logs help diagnose context-gathering failures.

The configured ruleset automatically requests review for new PRs targeting any
branch, including drafts. Enable **Review new pushes** using
[the review ruleset setup](#configure-pull-request-protection-and-copilot)
so new commits receive another review. Existing PRs may need an initial request
from their **Reviewers** menu.

Review suggestions before applying them. Copilot comments do not count as an
approval. With auto-approval explicitly enabled, Copilot can submit approvals
that count toward the generic approval requirement for the two root npm paths.
It does not replace code-owner review for other paths, CI or Azure authorization.
A successful context-gathering run does not establish that the reviewed code is
correct. GitHub may still provide a more limited review if its agentic Actions
work is unavailable. Access, policies and usage charges are controlled by GitHub
Copilot settings; see [GitHub's code review guide](https://docs.github.com/en/copilot/concepts/agents/code-review).

## Copilot cloud agent

This GitHub-managed entry represents delegated coding work. Depending on the
request, the agent can investigate the repository, edit files, run commands and
propose changes through a branch and PR. It is not automatically started by this
repository's CI, release or promotion YAML.

Start or continue work through GitHub's Copilot task/session controls, such as
delegating an issue or requesting changes on an agent PR. Inspect the agent session
and associated Actions logs for the actual commands and results. A completed
agent run is not proof that every test ran or that its changes are safe; review
the diff, CI results and any stated limitations before merging.

There is no agent-specific Azure deployment configuration supplied here. Do not
provide promotion credentials to an agent merely to fix offline tests, and do
not use an agent session as a substitute for the protected promotion workflow.
Enabling Copilot in a fork is a separate repository/account setting, not a result
of copying the source. See [GitHub's cloud agent overview](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)
for capabilities, access and session controls.

## Dependabot Updates

This is GitHub's dependency-update service, configured through
[.github/dependabot.yml](../.github/dependabot.yml), not an editable Actions
workflow. Two entries check weekly: npm manifests/lockfiles in the repository
root, and action references in `.github/workflows`. Each ecosystem allows up to
five open version-update PRs. No explicit weekday or time is configured here.

Its output is proposed updates, not an audit report or an automatic merge.
Review the changed versions, lockfile and action pins, then let the applicable PR
checks run. A successful update check can produce no PR when nothing eligible is
available. Inspect Dependabot update logs for registry, resolution or access
failures.

Use the repository's **Insights > Dependency graph > Dependabot** area to inspect
checks and request another update check. Dependabot alerts and automatic
**security updates** are separate repository settings; the weekly version-update
configuration is not proof that either is enabled. This file configures neither
Docker image updates nor private-registry credentials, and grants no Azure access.
See [GitHub's Dependabot configuration reference](https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference).

## Dependabot auto-merge

The [workflow](../.github/workflows/dependabot-auto-merge.yml) only handles
same-repository Dependabot PRs targeting the default branch. Every updated
dependency must be an npm patch/minor update, verified by the SHA-pinned
`dependabot/fetch-metadata` action with its default commit verification enabled.
Only modifications to root `package.json` and `package-lock.json` are allowed;
major or unknown updates, Actions changes, renames, other files, forks and drafts
are left for manual review with a notice.

It uses `pull_request_target` for job-scoped `contents: write` and
`pull-requests: write` with the built-in token. It never checks out PR code,
installs dependencies, runs PR scripts, grants approval or accesses Azure.
It clears any existing auto-merge request before checking eligibility again,
including when metadata verification subsequently fails.

Before queueing a squash merge, it checks that repository auto-merge is enabled,
all five CI checks are required from the GitHub Actions integration in a strict
branch ruleset, and required approval, Code Owner review and stale-review
dismissal remain enabled. Missing configuration and API errors fail the job.
It rechecks the head revision before requesting auto-merge. GitHub then waits
for its protected checks and approvals. If the PR is already ready to merge,
the workflow instead requests a protected squash merge with that exact head SHA.
Neither path uses an admin bypass.
It does not fix failed builds.

**Administrator setup is required:** repository files cannot enable Copilot
approvals, auto-merge or branch rules. Follow the
[protection setup](#configure-pull-request-protection-and-copilot) before expecting
hands-off merging. Merge this workflow and CODEOWNERS into the default branch
first. For an existing eligible PR, request Copilot review and reopen or edit the
PR to trigger evaluation after configuration is complete.

## Dependency risk audit

**Trigger:** Mondays at 09:23 UTC or **Run workflow**.
The [workflow](../.github/workflows/dependency-audit.yml) installs the locked tree
with `npm ci --ignore-scripts --no-audit`, then runs
`npm run audit:dependencies` against both the production and full dependency trees.
It uses read-only repository permissions and no Azure identity.

The job summary shows findings, production/development scope and exception expiry.
Unaccepted high/critical advisories and expired exceptions fail the gate; registry,
process, setup or policy errors fail rather than report a clean result. A passing
run can still contain lower-severity or explicitly accepted risks. See the
[risk register](dependency-risks.md#automated-tracking) for exit codes and the
reviewed, time-limited exception process.

This workflow neither updates packages nor opens issues, uploads raw reports,
merges Dependabot PRs or automatically changes the promotion opt-in. It is separate
from ordinary PR CI and is not a dependency of the promotion job. Maintainers
must inspect its current results before Azure execution. Its shared concurrency
group does not cancel an active audit.

## Release

**Trigger:** pushing a tag matching `v*.*.*`; there is no manual-dispatch input.
The [workflow](../.github/workflows/release.yml) first runs a read-only `verify`
job. The [release-notes script](../scripts/release-notes.mjs) requires a stable
`vMAJOR.MINOR.PATCH` tag that exactly matches `package.json` and a nonempty
versioned entry in `CHANGELOG.md`. The trigger's glob alone does not validate
SemVer.

Verification then runs `npm ci`, `npm test`, lint and type checks, and builds the
Docker image. Only after that succeeds does `publish` receive `contents: write`
and create a GitHub release using the matching changelog section. There is no npm
package publication, image push, attached build artifact or Azure deployment.

Prepare the version and changelog in a reviewed change, merge it, then create and
push the matching tag at the intended commit. The workflow does not itself enforce
that the tag points to `main` or wait for CI, CodeQL or the dependency audit; use
reviewed repository/tag protections and inspect those results before tagging.
Verification is also narrower than full CI: it does not repeat the Windows matrix,
coverage gate, Bicep checks or running-container smoke test.

Inspect `verify` failures before expecting a release. If publishing fails, inspect
its logs and whether a release already exists before rerunning; creation is not an
update operation. Runs for the same tag share a concurrency group without
automatically cancelling an active run.

## Supply chain

**Trigger:** every push to `main`, manual dispatch, or a PR changing
`package.json`, `package-lock.json` or `.github/workflows/supply-chain.yml`.
Other PR changes do not trigger this workflow.

The [job](../.github/workflows/supply-chain.yml) restores dependencies, runs
`npm audit signatures` to check registry signatures and available provenance,
then generates `sbom.cdx.json` with
`npm sbom --sbom-format cyclonedx --omit dev`. It uploads that file as the
**`sbom-cyclonedx`** Actions artifact with a requested retention of **90 days**,
subject to repository/organization retention limits.

An SBOM (software bill of materials) inventories production dependencies;
development-only tooling such as APIops is excluded. Download it from the
successful run's **Artifacts** area. It is not an APIM export, a release asset,
an image scan or a newly issued build attestation. Signature/provenance checks
do not prove vulnerability-free packages and do not replace the advisory audit.
If installation, verification or generation fails, inspect that step's error;
the later artifact upload may not have run.

The job has read-only repository permissions, uses no Azure credentials and
does not publish packages or deploy anything.

## Running workflows and reading results

Open **Actions**, select a workflow, then select a run to inspect its event, ref,
commit, jobs and failed steps. Where present, read the job summary as well as logs;
for Supply chain, also inspect its uploaded artifact. Skipped, cancelled or absent
runs are not successful validation.

Only CI, Dependency risk audit, Promote APIM APIs and Supply chain currently
declare manual dispatch. For example:

```bash
gh workflow run ci.yml --ref main
gh workflow run dependency-audit.yml --ref main
gh workflow run supply-chain.yml --ref main
gh run list --workflow ci.yml --limit 5
gh run watch RUN_ID --exit-status
```

Replace `RUN_ID` with the selected run. Manual dispatch requires appropriate
repository access and the workflow to exist on the default branch. For the
GitHub-managed entries, use the relevant review, agent or Dependabot controls
instead of trying to dispatch a nonexistent YAML file.

These workflows are not one chained deployment pipeline. Within Release,
`publish` depends on `verify`; within promotion, the Azure job depends on
authorization and environment approval. The other workflows run independently.
Only **Promote APIM APIs** is configured to authenticate to Azure, and even it
does not provision the lab. Its setup and operating procedure follow.

## Promote APIM APIs

The [Promote APIM APIs workflow](../.github/workflows/promote.yml) runs the existing
[Bash promotion script](../scripts/bash/promote.sh) on an Ubuntu runner with
Node.js 22. It is **manual**, defaults to **dry-run**, and does not run `azd up`,
deploy backend code or provision infrastructure.

The action installs the tested global CLI before Azure login:

```bash
npm install -g @azure-tools/apiops-cli@1.0.5
apiops --version
```

The promotion step sets `APIOPS_USE_GLOBAL=true`, so extraction, publisher dry-run
and publication invoke the `apiops` executable. Node.js 22 is configured before
installation. `npm ci` is still required for the MCP verification clients and
regression tests. Local Bash runs default to the project-installed CLI unless
`APIOPS_USE_GLOBAL=true` is explicitly set; a missing global executable fails
rather than silently falling back to another installation.

## What each mode does

| Mode | GitHub environment | Behavior |
| --- | --- | --- |
| `dry-run` (default) | `apim-preview` | Run local tests, authenticate, test source MCP endpoints, extract the three APIs, validate artifacts and preview publication to target. No target API writes. |
| `apply` | `apim-promotion` | Repeat tests, source checks, extraction and dry-run; then publish, validate target bindings/paths, check the source snapshot is unchanged and call both tools on both gateways. |

Both modes require Azure access, including permission to retrieve each APIM's
test subscription key. A dry-run is not an offline test. An apply run **extracts
the current source again**; it does not publish an immutable artifact from an
earlier preview. Review its fresh publisher output too, and avoid editing the
source between preview and apply.

Only the repository default branch is accepted. Runs share one concurrency group
and never automatically cancel an in-progress run. GitHub concurrency is not a
FIFO queue: a newer pending run can replace an older pending run. This group does
not coordinate local scripts, azd, portal edits or other workflows; do not run those
against the same lab concurrently.

## Repository setup checklist

A fork or source copy supplies files, not a configured Azure-connected repository.
Configure and verify these settings in your own repository. Do not assume upstream
rulesets, branch protections, environment approvals, secrets, variables or Azure
OIDC trust apply to the copy.

- [ ] Keep `ENABLE_AZURE_PROMOTION` unset or `false` during setup.
- [ ] Run offline CI and configure the default branch's required checks and human
      review using [PR protection setup](#configure-pull-request-protection-and-copilot).
- [ ] Configure your own automatic Copilot review ruleset if your account supports it.
      Copilot availability does not replace the human-review requirement.
- [ ] Deploy and verify your own lab using [step 1](#1-deploy-and-verify-the-lab-first).
- [ ] Create and verify both protected environments using
      [step 2](#2-create-the-github-environments). The environment names alone do
      not configure approval gates.
- [ ] Configure Azure OIDC trust for your repository and both environments, then
      grant scoped authorization using
      [step 3](#3-configure-azure-oidc-trust-and-authorization).
- [ ] Add your own three identifier secrets and required resource variables using
      [step 4](#4-set-private-identifiers-and-configuration-variables).
      Check for environment-level values that override repository settings.
- [ ] Set `APIM_PROMOTION_ALLOWED_ACTOR_ID` to your numeric user ID and configure
      that same user as the only reviewer on both environments.
- [ ] Review the [dependency risks](dependency-risks.md), then explicitly set
      `ENABLE_AZURE_PROMOTION=true`.
- [ ] Complete an approved dry-run and inspect its sanitized summary before
      requesting apply using [step 5](#5-run-preview-then-apply).

### Configure pull request protection and Copilot

In **Settings > Rules > Rulesets**, or the branch-protection settings, protect
your default branch with:

- Required conversation resolution. Configure approval in the separate review
  ruleset below so its owner bypass does not bypass CI or conversation resolution.
- An active **Required CI** branch ruleset targeting the default branch, with
  an empty bypass list, **Require branches to be up to date before merging**,
  and all five required checks below. Select **GitHub Actions** as the expected
  source for each check (integration ID `15368`). Run CI first so GitHub can
  discover the names. The auto-merge workflow verifies this ruleset; legacy
  branch-protection checks alone are not sufficient for its configuration gate.
- Administrator enforcement, with force pushes and branch deletion disabled.

For the upstream repository's solo-maintainer policy, keep the legacy branch
protection's required approving-review count at zero, then create a separate
**Owner review** branch ruleset:

| Setting | Value |
| --- | --- |
| Enforcement | Active |
| Target branches | Default branch |
| Bypass actor | Repository owner, only for pull requests |
| Require a pull request before merging | Enabled |
| Required approvals | One |
| Require review from Code Owners | Enabled |
| Dismiss stale approvals on new commits | Enabled |

The five required CI checks are `Test (ubuntu-24.04)`, `Test (windows-2025)`,
`Lint, types and coverage`, `Validate infrastructure` and `Container smoke test`.
Keep existing required checks and independent protections; do not replace them
with only this list or add CI to the bypassable review ruleset.

The [CODEOWNERS file](../.github/CODEOWNERS) contains `* @seilorjunior`, followed
by ownerless exceptions for `/package.json` and `/package-lock.json`. All other
files, including CODEOWNERS and workflows, retain owner review. The npm
exceptions apply to every author, not just Dependabot; those paths still require
the generic approval, and the auto-merge workflow accepts only verified
Dependabot updates. Fork maintainers must replace the owner login
with their own eligible code owner and configure the bypass actor in GitHub.
CODEOWNERS must be present on the PR's base branch for GitHub to apply it.
This setup protects PRs targeting the default branch; other base branches need
their own protection and CODEOWNERS.

The owner reviews other authors' PRs and submits an approving review. For their
own PRs, the owner reviews the changes and manually merges using the review-only
bypass after CI passes. GitHub does not allow self-approval.
The bypass is **not conditional on authorship**: the owner can also bypass review
on others' PRs. This is a trusted-maintainer policy, not strict enforcement of an
author-dependent rule. Do not grant the auto-merge workflow a review bypass.

Keep required CI checks, administrator enforcement and conversation resolution
outside the bypassable review ruleset. Its bypass does not override those
independent protections or the Copilot ruleset.

Automatic Copilot review is a separate native branch ruleset. In
**Settings > Rules > Rulesets**, edit **Automatic Copilot review for all pull
requests** (or create it in a fork) with:

| Setting | Value |
| --- | --- |
| Enforcement | Active |
| Target branches | Include all branches; no exclusions |
| Bypass list | Empty |
| Automatically request Copilot code review | Enabled |
| Review draft pull requests | Enabled |
| Review new pushes | Enabled |

This requests automatic review for new PRs and new pushes, including drafts,
targeting any branch. For PRs already
open when the rule is enabled, request Copilot from the PR's **Reviewers** menu.
Availability and usage limits depend on your Copilot access and GitHub settings;
see [GitHub's configuration guide](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/configure-code-review).

In **Settings > Copilot > Code review > Auto-approval**, enable both
**Allow Copilot to approve pull requests** and
**Allow Copilot approvals to count toward merge requirements**. Set **File paths**
to exactly these two globs, one per line:

```text
package.json
package-lock.json
```

An approval counts only when every changed file matches. Copilot comments alone
are not approvals, and these settings do not satisfy owner review on other files.
If the controls are unavailable under your plan or account policy, retain manual
approval rather than reducing required approvals to zero.

In **Settings > General > Pull Requests**, enable **Allow auto-merge** and leave
squash merging enabled. Do not enable a blanket auto-approve workflow: only the
guarded dependency workflow should automatically request merging.

These are administrator settings, not defaults installed by this repository.
Verify them in GitHub after saving. A session whose token returns HTTP 403 cannot
apply them even if the user's account is a repository administrator.
The single-user environment approval policy below controls Azure jobs separately;
it is unrelated to the review-only owner bypass above. Do not add an
Azure-connected PR workflow to request reviews or merge dependencies.

## 1. Deploy and verify the lab first

Follow the [deployment runbook](operations.md). Both Developer APIM instances,
their backend configurations and `poc-test-client` subscriptions, and the shared
App Service backend must already exist. Source must contain `poc-rest`,
`poc-native` and `poc-proxy`. The runner must be able to reach Azure Resource
Manager and both gateway HTTPS endpoints.

The workflow uses Azure CLI from the GitHub-hosted Ubuntu image. APIops uses that
authenticated CLI context; it does not need a client secret or an azd environment.
The `AZURE_SUBSCRIPTION_ID` variable chooses the intended subscription.
[common.sh](../scripts/bash/common.sh) requires it to match the authenticated
Azure CLI account; no personal subscription ID is embedded in the scripts.

## 2. Create the GitHub environments

In **Settings > Environments**, create these environments before running:

1. **`apim-preview`**: use a custom deployment-branch policy allowing only the exact
   default branch (branch type, no tag policy). Set the permitted user as the
   only required reviewer, allow self-review and disable administrator bypass.
2. **`apim-promotion`**: apply the same branch and reviewer rules.

Required reviewers and some protection rules depend on repository visibility and
GitHub plan. Verify availability before enabling apply. **Naming an environment
in YAML does not create approval protection.** If it does not exist, GitHub can
create an unprotected environment automatically. Do not use apply until a
maintainer has configured and verified the protection rules.

The environment gate applies to the entire job, including tests. After approval,
configuration validation and `npm test` run before Azure login.

Azure execution is disabled by default. After reviewing
[dependency risks](dependency-risks.md), configure both environments, then set
the repository variable `APIM_PROMOTION_ALLOWED_ACTOR_ID` to your GitHub user's
numeric ID, then set `ENABLE_AZURE_PROMOTION=true`. Find that ID with:

```bash
gh api users/YOUR_GITHUB_LOGIN --jq .id
```

A separate job without OIDC permissions checks the original dispatcher's numeric
ID and resolves the user starting each re-run to the same numeric ID. Other users
fail before environment access or Azure authentication. The gate also verifies
the default branch, both environments' exact branch restrictions, the single
permitted reviewer, self-review enabled and administrator bypass disabled.
Missing or unsupported protections fail closed. Both preview and apply still
require manual approval by the permitted user, including their own runs.
The Azure-connected job repeats the identity check before any checkout or Azure
login: a failed-job-only re-run can otherwise reuse an earlier authorization result.

This is an explicitly single-user lab policy, not two-person approval. Anyone
with repository administration or workflow-editing privileges could change the
allowlist or workflow; this is not a boundary against a malicious administrator.
GitHub may still show the workflow controls to other users with write access,
but their runs are rejected by the authorization job. Forks must configure their
own user ID and opt in separately; do not enable promotion on untrusted PR events.

## 3. Configure Azure OIDC trust and authorization

Use a dedicated Microsoft Entra application/service principal or a user-assigned
managed identity. An administrator must configure federated credentials; this
workflow does not create them or assign roles.

For each environment that identity will use, configure:

| Federated credential field | Value |
| --- | --- |
| Issuer | `https://token.actions.githubusercontent.com` |
| Audience | `api://AzureADTokenExchange` |
| Preview subject | `PREFIX:environment:apim-preview` |
| Apply subject | `PREFIX:environment:apim-promotion` |

Discover the repository's actual subject configuration before creating the trusts:

```bash
gh api repos/OWNER/REPOSITORY/actions/oidc/customization/sub
```

Replace `OWNER/REPOSITORY` with the exact repository name and `PREFIX` in the table
with the returned `sub_claim_prefix`. For an immutable subject, the prefix contains
both names and numeric IDs, such as
`repo:OWNER@OWNER_ID/REPOSITORY@REPOSITORY_ID`. Older repositories may use
`repo:OWNER/REPOSITORY`. Do not assume these formats are interchangeable.
The exact `subject claim` reported by `azure/login` is authoritative; custom
subject configurations can require a different full subject.

Environment subjects are used instead of `ref:refs/heads/main` because the job
references a GitHub environment. A branch subject alone will not match.
Environment deployment branch restrictions are therefore essential, in addition
to the workflow guard. Keep immutable subjects enabled; update Entra trusts to
match rather than weakening GitHub's subject configuration.
See [Microsoft's OIDC setup guide](https://learn.microsoft.com/azure/developer/github/connect-from-azure-openid-connect).

If you rename or transfer your repository, pause promotion before the change.
Read its OIDC subject configuration again afterward: an immutable subject can
contain both repository names and IDs, so stable numeric IDs alone do not keep
the old subject valid. Update both existing Entra federated credentials to the
new exact environment subjects while preserving their issuer and audience.
Verify both trusts, repository protections and environment policies before
restoring the promotion opt-in. Update the clone's Git remote and repository
links too; a GitHub URL redirect does not repair Azure federation.

For a straightforward **dedicated-lab** setup, assign **API Management Service
Contributor** to the identity at each of the two APIM **resource scopes**, not
the whole subscription:

```text
/subscriptions/SUBSCRIPTION_ID/resourceGroups/RESOURCE_GROUP/providers/Microsoft.ApiManagement/service/SOURCE_APIM_NAME
/subscriptions/SUBSCRIPTION_ID/resourceGroups/RESOURCE_GROUP/providers/Microsoft.ApiManagement/service/TARGET_APIM_NAME
```

Also grant **Reader** at the containing resource-group scope. APIops 1.0.5
performs a resource-group GET during publisher preflight, including dry-run;
roles scoped only to child APIM resources do not authorize that parent read.
No subscription-wide assignment is necessary.

Preflight additionally reads the backend App Service, its plan/configuration,
application settings and both APIM named-value contents. The management identity
needs the read actions plus `Microsoft.Web/sites/config/list/Action` at the
backend application scope and
`Microsoft.ApiManagement/service/namedValues/listValue/action` on both named
values. Reader alone cannot list these secret values. Use administrator-reviewed
scoped permissions; the workflow never creates role assignments or prints values.

An owner can explicitly choose resource-group **Contributor** for a disposable
lab, but it covers all resources in the group, including App Service, and permits
writes and deletes. It is broader than Reader plus APIM-scoped roles and is not
the recommended reusable-example default. Preparing this public example does
not automatically change existing Azure role assignments.

This built-in role is intentionally broad within each service: it permits source
writes as well as target writes and access to secrets. The script only reads the
source and checks a limited source snapshot; that is not an RBAC write barrier
or a full backup. Preview also has write-capable authorization if the same
identity/roles are used. Review
[the role definition](https://learn.microsoft.com/azure/role-based-access-control/built-in-roles/integration#api-management-service-contributor)
and the [lab security boundaries](testing-and-security.md) before granting it.

For stronger isolation, use separate identities for preview/apply and administrator-
reviewed custom roles: source extraction/inspection, target inspection for
preview, target API publication for apply, plus
`Microsoft.ApiManagement/service/subscriptions/listSecrets/action` on both test
subscriptions. Plain Reader access is insufficient for the live MCP checks.
Custom role definitions and least-privilege validation are not supplied by this PoC.
No App Service deployment permissions, Owner role or role-assignment permissions
are needed by the promotion workflow.

## 4. Set private identifiers and configuration variables

Create these **Actions secrets**, at repository level or on both environments:

| Secret | Value |
| --- | --- |
| `AZURE_CLIENT_ID` | Application/client ID of the trusted identity (not its object ID). |
| `AZURE_TENANT_ID` | Identity's Microsoft Entra directory/tenant ID. |
| `AZURE_SUBSCRIPTION_ID` | Your intended subscription UUID, checked against the authenticated account. |

These are identifiers rather than authentication secrets, but storing them as
Actions secrets registers their exact values for log masking. OIDC still uses no
client secret. Do not retain duplicate identifier variables after migrating the
workflow; variables alone do not provide masking. This does not erase older logs
or conceal resource names and every possible identifier in third-party output.

Under **Actions variables**, create:

| Variable | Value |
| --- | --- |
| `AZURE_RESOURCE_GROUP` | Existing lab resource group (`AZURE_RESOURCE_GROUP` from azd outputs). |
| `AZURE_WEBAPP_NAME` | Existing shared MCP App Service, required by preflight. |
| `SOURCE_APIM_NAME` | Existing source instance (`SOURCE_APIM_NAME` output). |
| `TARGET_APIM_NAME` | Existing target instance (`TARGET_APIM_NAME` output). |

Use the same resource group and APIM names in both environments. Client-ID secrets
may differ if you use separate identities. Environment configuration takes
precedence over repository-level configuration.

The workflow also exposes these deployment-context variables when configured.
They do not provision resources or replace the promotion script's live gateway
discovery:

| Variable | Value |
| --- | --- |
| `AZURE_ENV_NAME` | Existing azd environment name, such as `apiops`. |
| `AZURE_LOCATION` | Deployed Azure region, such as `brazilsouth`. |
| `BACKEND_URL` | Existing shared backend HTTPS base URL. |
| `SOURCE_GATEWAY_URL` | Source APIM HTTPS gateway base URL. |
| `TARGET_GATEWAY_URL` | Target APIM HTTPS gateway base URL. |

No `AZURE_CLIENT_SECRET`, backend credential
or APIM subscription key should be stored for this workflow. It fetches the two
test keys at runtime using the authenticated management identity. Do not copy or
upload the local azd environment file. Keep shell tracing and CLI debug logging off.
`APIM_PROMOTION_ALLOWED_ACTOR_ID` restricts dispatch and re-runs to one numeric
GitHub user ID; configure that same user as the only reviewer on both environments.
`ENABLE_AZURE_PROMOTION` is a separate repository-level opt-in variable, not an
Azure credential; leave it unset or `false` until all setup and risk review is done.

## 5. Run preview, then apply

Commit and push the reviewed workflow, scripts and lockfile to your repository's
default branch. This local preparation does not push anything or configure the
remote repository automatically.

1. Open **Actions > Promote APIM APIs > Run workflow**.
2. Select the default branch and `dry-run`.
3. Review the source smoke tests, extracted API metadata checks and publisher plan.
   Confirm the expected target and only the three PoC APIs.
4. Run the workflow again with `apply`.
5. An authorized reviewer checks the requested environment and approves the job.
6. Require the final success summary: publication alone is not acceptance.

The summary runs even after failure. It contains only allowlisted stage names,
phase/status/timing, preview/apply mode, validated API count and CLI version. It
distinguishes publication from publisher preview and marks unfinished stages
incomplete instead of claiming success. Failures before checkout get a static
setup summary; authorization failure gets a separate no-Azure-job summary.
No raw error bodies, endpoints, identifiers, credentials or exports are included.

The detailed preflight executes before source MCP checks and extraction. It
rejects Free/Shared hosting, disabled Always On, missing dependencies and mismatched
credentials. Failed-job re-runs still enforce the enabled flag and permitted user
before checkout/login. No new Azure access is granted automatically.

GitHub CLI equivalents, from a clone with the correct remote:

```bash
gh workflow run promote.yml --ref main -f mode=dry-run
gh run list --workflow promote.yml --limit 5
gh run watch RUN_ID --exit-status

# Only after reviewing preview; required environment approval still applies.
gh workflow run promote.yml --ref main -f mode=apply
```

Replace `main` if your default branch has another name, and `RUN_ID` with the run
being inspected. Nothing runs automatically on push or pull requests.

## Logs, failures and recovery

- Checkout, Node setup and Azure login actions are pinned to full commit SHAs.
  Maintain and review these pins along with the npm lockfile.
- The token has only repository content-read and OIDC issuance permissions.
  Azure authorization is separately controlled by RBAC.
- Extracted `artifacts/run-*` files are intentionally **not uploaded**, cached or
  reused by later runs. They can contain sensitive configuration. The hosted
  runner is disposable, but ordinary step logs remain in GitHub: restrict access
  and apply your organization's log retention policy.
- A failed test, Azure command, extraction, publication or MCP check fails the
  job. The success summary is written only after the script succeeds.
- Failed or manually cancelled publication can leave a partially updated target.
  There is no automatic rollback or atomic transaction. Investigate with the
  [troubleshooting guide](troubleshooting.md), correct the cause, preview and
  reapply. Do not delete the lab or rerun azd merely to repair an API promotion.
- `AADSTS700213` means no federated credential matches the issued subject,
  issuer and audience. Compare the full `azure/login` subject with the Entra
  credential, including numeric owner/repository IDs for immutable subjects.
  Update both environment trusts if they use the wrong prefix.
- The login step overrides `AZURE_CORE_OUTPUT` to `json` because `azure/login`
  parses `az version` output. Globally suppressing that output without this
  override produces a separate CLI-version parsing warning.
- `403` on `listSecrets` means management permissions
  are insufficient; gateway `401` is a separate APIM client authentication issue.
- Correct federation alone does not grant subscription or APIM access. Without
  Azure RBAC assignments, login can next fail with no accessible subscriptions.
  Do not add permissions or bypass this with `allow-no-subscriptions` when access
  has deliberately been withheld pending environment protection.
- Existing dependency-advisory review gates still apply before giving this
  repository an Azure identity. Local/static validation is not proof of a
  successful GitHub-hosted or live Azure run.
