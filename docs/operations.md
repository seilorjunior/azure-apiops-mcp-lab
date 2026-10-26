# Deployment and operations runbook

[Project overview](../README.md) | [Architecture](../.github/modernize/assessment/engines/facts/architecture-diagram.md) | [Testing and security](testing-and-security.md) | [Troubleshooting](troubleshooting.md)

Run commands from the **repository root**, not from this documentation directory.
PowerShell examples require PowerShell 7.2 or later; Bash examples are provided
for Linux/macOS. This runbook describes the implementation; it is not proof
of a successful live deployment.

## Choose the right operation

| Goal | Operation | Azure changes |
| --- | --- | --- |
| Validate application and script behavior offline | `npm test` | None; Azure/APIops calls in script tests are mocked. |
| Build the deployment archive | `azd package backend` | Local packaging; azd may initialize a local environment if none is selected. |
| Review infrastructure changes | `azd provision --preview` | Preview only; inspect output before proceeding. |
| Provision infrastructure and deploy application | `azd up` | Creates or updates billed resources and source API configuration. |
| Deploy backend code only | `azd deploy backend` | Updates App Service application and runs postdeploy verification. |
| Preview API promotion | `Promote.ps1` without `-Apply` | Reads source and target; publisher runs dry-run only. |
| Apply API promotion | `Promote.ps1 -Apply` | Creates or updates target API configuration. |
| Run promotion in GitHub Actions | [Manual promotion workflow](github-actions.md) | Dry-run by default; explicit apply uses a separately protected environment. |

**Ownership rule:** azd/Bicep owns infrastructure, dependencies and source seed APIs;
APIops owns the three promoted APIs in the target instance. Provisioning again can
reapply the source seed definitions. Do not use it as a substitute for publishing
intentional API configuration changes through APIops.

Test [Azure/apiops-cli](https://github.com/Azure/apiops-cli) **1.0.5** against both APIM MCP modes:

1. **REST-to-MCP:** APIM exposes a mock REST operation as the `get_status` tool.
2. **Existing MCP proxy:** APIM forwards the `echo` tool to a small Node.js MCP server on App Service.

## Design

```text
MCP client / automated smoke test
  |
  +-- Source APIM poc-native/mcp -> source poc-rest/status (mock response)
  +-- Source APIM poc-proxy/mcp --> App Service /mcp (official MCP SDK)

APIops extract (only poc-rest, poc-native, poc-proxy)
  -> local artifacts -> dry-run -> publish to target APIM (same API names/paths)

  +-- Target APIM poc-native/mcp -> target poc-rest/status
  +-- Target APIM poc-proxy/mcp --> same App Service backend
```

Two Developer-tier APIM instances and one Linux Basic B1 App Service plan are provisioned
in the selected `AZURE_LOCATION`. East US 2 is an example, not a required region.
Brazil South was selected in a reported user run, but regional capacity is not
established by that selection. All resources incur charges while provisioned, even when idle; APIM Developer has
no production SLA. APIM provisioning can take tens of minutes. No OpenAI deployment,
model usage, database, or container registry is needed.

Source and target API names and paths are identical; separate gateway hostnames
provide isolation. The script requires distinct source and target instance names,
extracts only the three PoC APIs from the source, and publishes only to the target.

Each instance has its own backend configuration, secret named value and test
subscription. Both backends intentionally point to the same App Service and use
the same backend credential. Bicep seeds these dependencies in both instances;
`--no-transitive` restricts APIops extraction/publication to APIs and their children,
without exporting backend secrets. No environment-prefix override is needed.
The scripts never pass `--delete-unmatched`. Use dedicated PoC instances, not
production/shared services. Two APIM instances cost more than the previous single-instance design.

## Prerequisites

- Node.js 22 or later, npm, Azure CLI with Bicep, and Azure Developer CLI (`azd`).
- Windows: PowerShell 7.2 or later. Linux/macOS: Bash and `curl`; no PowerShell or
  `jq` installation is required for the Bash path.
- Azure login with permission to create a dedicated resource group, APIM and App
  Service, run subscription-scope deployments, read APIM subscription secrets, and manage APIs.
- Approved subscription: `seilorjunior-all`
  (`00000000-0000-4000-8000-000000000001`).
- Review [the deployment plan](../.azure/deployment-plan.md) before deploying.

The subscription ID is currently fixed in [Common.ps1](../scripts/ps1/Common.ps1)
and [common.sh](../scripts/bash/common.sh).
Both the Azure CLI account and azd environment must match it. To adapt this PoC to
another subscription, review that guard and its corresponding tests together;
changing only the azd environment variable is intentionally insufficient.

```powershell
npm ci
npm test
az bicep build --file .\infra\main.bicep --stdout
```

Compilation reports BCP081 warnings because the installed Bicep does not have API
type definitions for `2025-09-01-preview`. MCP fields follow Microsoft's samples;
ARM validation/live deployment is the remaining authority.
The promotion script sets `AZURE_API_VERSION=2025-09-01-preview` so MCP APIs are not
silently omitted; CLI 1.0.5 does not register an `--api-version` command-line flag.

### Deployment blockers

Do not treat local tests or Bicep compilation as approval to expose this PoC:

- Quota/capacity checks are incomplete because the local quota CLI extension is
  unavailable. Region listings do not guarantee SKU capacity.
- The npm audit reports five runtime findings (two moderate, three high) and ten
  findings including development dependencies (two moderate, six high, two critical).
  These include runtime dependency paths
  (`body-parser`, `fast-uri`) and development-only APIops paths (`simple-git`,
  `@simple-git/argv-parser`, `@azure/msal-node`). Compatible patch versions suggested
  by the audit were not available in the registry when checked. No forced major
  overrides or SDK downgrades are applied. Re-run `npm audit` and review remediation
  before deployment. Rejecting compressed backend requests reduces one input
  surface but does **not** resolve or clear the audit findings.
- Live ARM validation, gateway propagation and both APIM MCP modes remain untested
  until a separately approved deployment.

Local validation passed: seven backend tests, offline PowerShell promotion tests,
clean lockfile installation, Node syntax checks, PowerShell parsing, Bicep compilation
and parameter mapping checks. The azd manifest passes its public JSON schema, and
`azd package backend` successfully produced an archive containing only package manifests
and server source (no environment state or secrets). The offline promotion tests mock Azure and APIops;
they verify source/target routing, distinct keys, dry-run/apply behavior, incorrect
ARM binding rejection and environment restoration. Compiled-template checks confirm
two Developer-tier instances and source-only API seeding.
The Azure promotion scripts have not been exercised against live Azure; they must
pass the live acceptance tests before the PoC can be declared successful.

## Deploy with azd (only after explicit approval)

**Preparation does not create any Azure resources.** `azd up` is an opt-in billed
operation. It provisions both APIM instances and App Service, then packages and
deploys the MCP backend. APIops promotion remains a separate, deliberate step.

```powershell
npm ci
azd auth login
az login
az account set --subscription 00000000-0000-4000-8000-000000000001
azd env new apiops-mcp-poc --no-prompt
azd env set AZURE_SUBSCRIPTION_ID 00000000-0000-4000-8000-000000000001
azd env set AZURE_LOCATION eastus2
# azd will prompt for backendKey if no value has been supplied.
# Enter a strong credential of at least 32 characters and retain it securely.
azd provision --preview
# After reviewing the preview and clearing the documented deployment blockers:
azd up
```

The same azd setup commands work in Bash. For local Bicep compilation, use
`az bicep build --file infra/main.bicep --stdout` instead of a PowerShell-style path.
azd selects PowerShell hooks on Windows and Bash hooks on Linux/macOS; no manifest
edits are needed when switching platforms.

### Continuing an existing environment

Do **not** run `azd env new` again after a failed deployment. Select the same local
environment and inspect only the non-secret settings you need:

```powershell
azd env list
azd env select <existing-environment-name>
azd env get-value AZURE_SUBSCRIPTION_ID
azd env get-value AZURE_LOCATION
az account show --query "{name:name,id:id}" --output json
azd provision --preview
azd up
```

If Brazil South is the intended region, set `AZURE_LOCATION` to `brazilsouth`
**before initial provisioning**, then check availability and capacity there.
Do not change the region of an existing deployment casually: a resource group's
location and resource locations are not a supported automatic migration plan.
Do not dump `azd env get-values` or local `.env` contents into tickets or chat.

Use a **new, dedicated environment name**. Bicep creates `rg-<environment-name>`;
unlike the former deployment script, azd supports repeat deployments into that group.
Do not select an environment name whose group contains unrelated resources.
Azure CLI and azd maintain separate authentication/context, so both logins and the
explicit subscription settings above are needed. No template initialization is required.

### Lifecycle hooks

| Hook | Script | Responsibility |
| --- | --- | --- |
| `preprovision` | [Preprovision.ps1](../scripts/ps1/Preprovision.ps1) / [preprovision.sh](../scripts/bash/preprovision.sh) | Validate configured azd subscription and run local tests. No requirement for a process key after an interactive azd prompt. |
| Backend `prepackage` | [Package-Backend.ps1](../scripts/ps1/Package-Backend.ps1) / [package-backend.sh](../scripts/bash/package-backend.sh) | Rebuild `.local/backend` with only manifests and server source. Previous staging contents are replaced. |
| `postdeploy` | [Verify-Source.ps1](../scripts/ps1/Verify-Source.ps1) / [verify-source.sh](../scripts/bash/verify-source.sh) | Check backend health, get source test subscription key in memory, and run source MCP tests. |

The manifest is [azure.yaml](../azure.yaml). Its service name `backend` matches the
App Service `azd-service-name` tag and the `AZURE_WEBAPP_NAME` output. Packaging
can overlap provisioning; a displayed `Skipped` service after a hook failure is not
evidence that the application was deployed or that all infrastructure was rolled back.

The preprovision hook verifies the approved subscription and runs local tests.
azd resolves infrastructure parameters, and Bicep enforces the secure `backendKey`
minimum length of 32 characters. The hook does not require a process variable when
the credential was supplied through azd's secured parameter prompt.
The backend prepackage hook stages only the application manifest,
lockfile and source into `.local/backend`, excluding Azure environment state and
APIops artifacts from the deployment archive. App Service builds production
dependencies through Oryx. The postdeploy hook checks backend health and both source
MCP endpoints. Target APIs are **not** seeded by Bicep: only APIops creates them.

The credential can be supplied through azd's secured parameter prompt or, optionally,
through `POC_BACKEND_KEY` in the process environment. For a new credential:

```powershell
$env:POC_BACKEND_KEY = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Optional Bash equivalent (do not regenerate an existing deployment's credential):

```bash
export POC_BACKEND_KEY="$(node --input-type=module -e 'import { randomBytes } from "node:crypto"; process.stdout.write(randomBytes(32).toString("hex"));')"
```

It is passed into a secure Bicep parameter, then stored in App Service settings and
each APIM's secret named value. It is not an infrastructure output. Keep the same
credential for subsequent `azd provision`/`azd up` runs; reuse azd's resolved value or
restore it from your secure store if prompted again.
Do not regenerate it casually or use `azd env set` to persist it as plaintext.
Treat azd local state, deployment logs and Azure configuration access as sensitive.
The `.azure` environment directory is ignored by Git except for the deployment plan.
This is PoC credential management, not a production Key Vault design.

If a previous run accepted `backendKey` and then failed in the preprovision hook
because `POC_BACKEND_KEY` was absent, rerun `azd up` in the **same azd environment**
after applying the hook fix. Re-enter the same credential if prompted. Do not
create a new environment or rotate the credential just to bypass that error.

For subsequent backend-only changes:

```powershell
azd deploy backend
```

If a deployment partially fails, inspect the selected environment and retry it after
fixing the cause. Do not create another environment and leave paid resources behind.
If gateway propagation delays the postdeploy test, investigate and rerun `azd deploy backend`;
a successful upload alone is not a passing MCP test.

## Extract, preview, publish, verify

For CI execution of the same promotion logic, use the
[GitHub Actions setup and approval runbook](github-actions.md). It reuses the Bash
script and does not replace azd for infrastructure or backend deployment.

The postdeploy hook prints the promotion command. Alternatively, read azd outputs:

```powershell
$resourceGroup = azd env get-value AZURE_RESOURCE_GROUP
$sourceApim = azd env get-value SOURCE_APIM_NAME
$targetApim = azd env get-value TARGET_APIM_NAME
.\scripts\ps1\Promote.ps1 -ResourceGroup $resourceGroup -SourceApimName $sourceApim -TargetApimName $targetApim
# Review dry-run output: only the target instance should receive API changes.
.\scripts\ps1\Promote.ps1 -ResourceGroup $resourceGroup -SourceApimName $sourceApim -TargetApimName $targetApim -Apply
```

Bash equivalent:

```bash
resource_group="$(azd env get-value AZURE_RESOURCE_GROUP)"
source_apim="$(azd env get-value SOURCE_APIM_NAME)"
target_apim="$(azd env get-value TARGET_APIM_NAME)"
bash ./scripts/bash/promote.sh \
  --resource-group "$resource_group" \
  --source-apim-name "$source_apim" \
  --target-apim-name "$target_apim"
# After reviewing the target and dry-run:
bash ./scripts/bash/promote.sh \
  --resource-group "$resource_group" \
  --source-apim-name "$source_apim" \
  --target-apim-name "$target_apim" \
  --apply
```

The `.sh` entry points use Bash arrays and strict error handling. Run them through
`bash`, not `sh`, and do not source them into an interactive shell. `common.sh`
is the helper sourced by those scripts. Script execution uses a child process so
temporary directory/environment changes do not leak to the calling shell.

Each run uses a fresh ignored artifacts directory. The script:

1. Tests both source endpoints with the official MCP client (including initialization).
2. Snapshots source APIs, REST operation and mock policy.
3. Extracts exactly the three source APIs and checks MCP tool/transport metadata.
4. Runs the publisher dry-run against the separate target APIM.
5. With `-Apply`, publishes the target APIs and asserts the native tool references
   **poc-rest in the target APIM's ARM scope**, not the source instance's operation.
6. Checks source configuration and canonical paths are unchanged and invokes both
   source and target tools with their respective gateway URLs and subscription keys.

### Inspect the artifact contract

The run directory is printed by [Promote.ps1](../scripts/ps1/Promote.ps1)
or [promote.sh](../scripts/bash/promote.sh):

```text
artifacts/
  run-<unique-id>/
    apis/
      poc-rest/
        apiInformation.json
        ... REST specification, operations and policies from extraction
      poc-native/
        apiInformation.json
      poc-proxy/
        apiInformation.json
```

This is a schematic layout, not a promise of every extractor filename.
`poc-native` must retain `properties.mcpTools` containing `get_status`.
`poc-proxy` must retain its MCP API type, backend binding and the complete
`properties.mcpProperties` returned by the source management API. The shared
[artifact validator](../scripts/validate-extraction.mjs) compares these against
the pre-extraction source snapshot. Azure can return canonical MCP metadata
without `transportType`, even when the deployed request specified `streamable`;
the validator does not invent a missing transport field.
MCP APIs intentionally do not receive an OpenAPI specification export.

Only APIs and their children are selected by
[source-filter.yaml](../config/source-filter.yaml) with `--no-transitive`.
Backends, secret named values and test subscriptions are pre-provisioned independently
in **both** APIM instances. This PoC does not test exporting or promoting those dependencies.

APIops treats an omitted filter resource family as **include all**, not exclude.
The filter therefore explicitly sets every non-API family to `[]`, including
named values, backends, products, subscriptions, gateways and service policies.
`--no-transitive` prevents dependency expansion; it does not exclude those
otherwise selected families. The artifact validator rejects any top-level entry
other than `apis` before publisher dry-run or apply.

Every invocation creates a fresh extraction, including when rerunning with `-Apply`
(PowerShell) or `--apply` (Bash).
The applied invocation performs its own dry-run first; it does not freeze the
previous invocation's artifact snapshot or introduce an interactive approval pause.
Keep the source stable between preview and apply. There is no automated rollback:
a failed publish or verification can leave partially changed target configuration.
Investigate before retrying; consult [troubleshooting](troubleshooting.md).

Expected tool responses contain `apiops-rest-ok` and `apiops-proxy-ok`. A successful
publish without successful MCP tool calls **does not** count as a passing PoC.
New gateway configuration can take time to propagate; an immediate smoke-test failure
must be investigated or retried after propagation, not recorded as success.

For a manual MCP test, set `POC_APIM_KEY` to the source instance's subscription key
for the first command, then replace it with the target instance's key for the second:

```powershell
npm run test:mcp -- https://<source-apim>.azure-api.net source
npm run test:mcp -- https://<target-apim>.azure-api.net target
```

Do not paste keys into chat, commit them, or put them in command-line arguments.
For VS Code use **MCP: Add Server**, HTTP, and one of the four URLs in the diagram;
set the `Ocp-Apim-Subscription-Key` header using a secret input rather than a literal.

## Security and boundaries

- All APIM APIs require a subscription key. The test subscription covers all APIs
  in its respective dedicated PoC instance; it is deliberately not a production authorization design.
- The external backend independently requires `x-poc-backend-key`; APIM supplies it.
  Only `/health` is anonymous. HTTPS and TLS certificate validation are enabled.
- Stateless Streamable HTTP is tested; SSE, OAuth, MCP prompts/resources, workspaces,
  multiple revisions and cross-subscription promotion are out of scope.
- No response-body logging or buffering is configured for MCP traffic.
- Cross-instance promotion tests ARM-prefix rewriting for MCP operation references.
  The backend, region, subscription and resource group remain shared; this is not
  full environment isolation or a disaster recovery test.
- APIops deploys APIM configuration, **not** the external MCP application. App Service
  deployment is a separate step.
- Native MCP APIs have no OpenAPI specification export; inspect their API JSON and
  bindings. CLI MCP handling is version-specific; keep the lockfile.
- Bicep seeds source APIs; APIops owns target configuration. Do not use Bicep to
  recreate the target APIs as a shortcut around the CLI being tested.

## Configuration reference

| Name | Source | Meaning |
| --- | --- | --- |
| `AZURE_ENV_NAME` | azd environment | Forms resource group name `rg-<environment-name>`. |
| `AZURE_SUBSCRIPTION_ID` | azd environment | Must match repository guard and Azure CLI account. |
| `AZURE_LOCATION` | azd environment or parameter resolution | Location for the resource group and resources. |
| `POC_BACKEND_KEY` | Optional process environment | Alternative to the azd secure prompt; at least 32 characters. |
| `backendKey` | Secure infrastructure parameter | Shared backend credential provisioned into App Service and both APIM named values. |
| `POC_APIM_KEY` | Process environment for manual smoke tests | Subscription key for the gateway being tested, not the backend credential. |
| `AZURE_API_VERSION` | Temporarily set by promotion | ARM `2025-09-01-preview`; previous process value restored afterward. |

| Infrastructure output | Used for |
| --- | --- |
| `AZURE_RESOURCE_GROUP` | Resource lookup and APIops commands. |
| `SOURCE_APIM_NAME`, `TARGET_APIM_NAME` | Separate extract/publish targets. |
| `SOURCE_GATEWAY_URL`, `TARGET_GATEWAY_URL` | MCP client endpoints. |
| `AZURE_WEBAPP_NAME` | azd backend service resource discovery. |
| `BACKEND_URL` | Backend health check. |

There are no secret outputs. Use individual `azd env get-value <name>` commands
instead of printing the complete environment. The publisher email defaults to the
value in [main.bicep](../infra/main.bicep); review it before reusing the project.

## Cleanup and cost control

There is no automatic deletion. After finishing, confirm the resource group contains
only this PoC, then deliberately delete it in Azure Portal or with Azure CLI.
Deleting API artifacts or stopping the Node process does not stop APIM/App Service billing.
Local generated artifacts and ZIP packages are excluded from Git.

Before deleting anything, check the selected azd environment, subscription, group,
and its resource inventory. `azd down` is a **destructive alternative** for removing
the environment's Azure resources; do not run it until a human has verified the
scope. Local environment deletion alone does not delete Azure resources or end billing.
No cleanup command is executed automatically by this project.

## References

- [APIops configuration-as-code](https://github.com/Azure/apiops-cli/tree/v1.0.5)
- [Expose REST APIs as MCP](https://learn.microsoft.com/azure/api-management/export-rest-mcp-server)
- [Proxy existing MCP servers](https://learn.microsoft.com/azure/api-management/expose-existing-mcp-server)
- [Microsoft native MCP Bicep sample](https://github.com/Azure-Samples/AI-Gateway/blob/main/labs/mcp-from-api/src/weather/mcp-server/mcp.bicep)
- [Microsoft streamable MCP Bicep sample](https://github.com/Azure-Samples/AI-Gateway/blob/main/modules/apim-streamable-mcp/api.bicep)
