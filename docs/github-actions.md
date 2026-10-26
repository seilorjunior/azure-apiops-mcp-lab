# GitHub Actions API promotion

[Project overview](../README.md) | [Operations](operations.md) | [Testing and security](testing-and-security.md)

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

## 1. Deploy and verify the lab first

Follow the [deployment runbook](operations.md). Both Developer APIM instances,
their backend configurations and `poc-test-client` subscriptions, and the shared
App Service backend must already exist. Source must contain `poc-rest`,
`poc-native` and `poc-proxy`. The runner must be able to reach Azure Resource
Manager and both gateway HTTPS endpoints.

The workflow uses Azure CLI from the GitHub-hosted Ubuntu image. APIops uses that
authenticated CLI context; it does not need a client secret or an azd environment.
The subscription must match the approved subscription in
[common.sh](../scripts/bash/common.sh). Configuring a different subscription in
GitHub does not bypass that guard.

## 2. Create the GitHub environments

In **Settings > Environments**, create these environments before running:

1. **`apim-preview`**: restrict deployment branches to the repository default branch.
2. **`apim-promotion`**: restrict to the default branch, enable required reviewers,
   and prevent self-review. Disable administrator bypass where your policy allows.

Required reviewers and some protection rules depend on repository visibility and
GitHub plan. Verify availability before enabling apply. **Naming an environment
in YAML does not create approval protection.** If it does not exist, GitHub can
create an unprotected environment automatically. Do not use apply until a
maintainer has configured and verified the protection rules.

The environment gate applies to the entire job, including tests. After approval,
configuration validation and `npm test` run before Azure login.

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

For this dedicated PoC, the operator instead explicitly authorized **Contributor**
on `rg-apiops`. That role covers preflight and management of all resources in
the group, including App Service, and permits writes and deletes. It is broader
than the recommended Reader plus APIM-scoped roles and does not grant role-
assignment permissions. The original two APIM assignments remain but are
redundant under the resource-group Contributor assignment.

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

## 4. Set configuration variables

Under each environment's **Environment variables**, create:

| Variable | Value |
| --- | --- |
| `AZURE_CLIENT_ID` | Application/client ID of the trusted identity (not its object ID). |
| `AZURE_TENANT_ID` | Identity's Microsoft Entra directory/tenant ID. |
| `AZURE_SUBSCRIPTION_ID` | Subscription allowed by the script guard. |
| `AZURE_RESOURCE_GROUP` | Existing lab resource group (`AZURE_RESOURCE_GROUP` from azd outputs). |
| `SOURCE_APIM_NAME` | Existing source instance (`SOURCE_APIM_NAME` output). |
| `TARGET_APIM_NAME` | Existing target instance (`TARGET_APIM_NAME` output). |

Use the same resource group and APIM names in both environments. Client IDs may
differ if you use separate identities. Repository-level Actions variables can
hold shared values; environment variables take precedence.

The workflow also exposes these deployment-context variables when configured.
They do not provision resources or replace the promotion script's live gateway
discovery:

| Variable | Value |
| --- | --- |
| `AZURE_ENV_NAME` | Existing azd environment name, such as `apiops`. |
| `AZURE_LOCATION` | Deployed Azure region, such as `brazilsouth`. |
| `AZURE_WEBAPP_NAME` | Existing shared MCP App Service name. |
| `BACKEND_URL` | Existing shared backend HTTPS base URL. |
| `SOURCE_GATEWAY_URL` | Source APIM HTTPS gateway base URL. |
| `TARGET_GATEWAY_URL` | Target APIM HTTPS gateway base URL. |

These are identifiers, not passwords. No `AZURE_CLIENT_SECRET`, backend credential
or APIM subscription key should be stored for this workflow. It fetches the two
test keys at runtime using the authenticated management identity. Do not copy or
upload the local azd environment file. Keep shell tracing and CLI debug logging off.

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
