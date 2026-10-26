# Troubleshooting

[Overview](../README.md) | [Operations](operations.md) | [Testing and security](testing-and-security.md)

## Start with the failing stage

| Stage | First evidence to inspect | What may already exist |
| --- | --- | --- |
| Parameter resolution | Exact parameter name, selected environment, non-secret region/subscription settings | Local azd state; possibly resources from an earlier attempt. |
| `preprovision` | Script path and first failing assertion/test | Packaging may have started; this is not a rollback guarantee. |
| Infrastructure provisioning | ARM deployment operations and first failed resource | Resource group, one APIM, hosting or other partial resources. |
| Application deployment | azd service output, App Service build/startup logs | Infrastructure can be fully provisioned. |
| `postdeploy` | Health versus MCP failure, gateway/key pairing | Application upload can have succeeded. |
| APIops extraction | Exact API names and MCP metadata in private artifacts | Source/target infrastructure unchanged by extraction. |
| APIops apply | Publisher error, target API properties and binding | Some target resources can already be changed. |

Keep the same environment when troubleshooting. Do not create a new environment,
delete the group, rotate credentials or alter the region simply to silence an error.

## Backend secured parameter and preprovision errors

### `backendKey` must be at least 32 characters

Bicep and the backend enforce the same minimum. Use a strong randomly generated
credential, not a short password padded to pass the check. Supply it through the
secured azd prompt or the optional process variable described in
[credential setup](operations.md#deploy-with-azd-only-after-explicit-approval).

Do not paste the credential into a support request. The prompt is expected to mask it.

### azd accepted the key, but the hook asks for `POC_BACKEND_KEY`

An earlier hook duplicated parameter validation and required the process variable
even when azd had resolved the secured parameter interactively. The current
[Preprovision.ps1](../scripts/ps1/Preprovision.ps1) and
[preprovision.sh](../scripts/bash/preprovision.sh) check the subscription and run
tests; it does **not** require that variable.

1. Use the current script and run `npm test`.
2. Select the same existing azd environment.
3. Rerun `azd up`; reuse the same backend credential if prompted.

The regression test covers the missing-process-variable path. Do not bypass the
subscription guard or remove the Bicep minimum-length requirement.

## Wrong subscription or region

Azure CLI and azd authentication/settings are independent. Compare only non-secret
values:

```powershell
az account show --query "{name:name,id:id}" --output json
azd env get-value AZURE_SUBSCRIPTION_ID
azd env get-value AZURE_LOCATION
```

The approved subscription is fixed in
[Common.ps1](../scripts/ps1/Common.ps1) and [common.sh](../scripts/bash/common.sh).
Correct the selected account/environment or
deliberately adapt the guard and tests together.

The templates use `AZURE_LOCATION` from azd, not the region shown in a documentation
example. Brazil South is `brazilsouth`; selecting it does not verify service/SKU
capacity. APIM Developer and Linux B1 plan availability, quota and policy must all
be checked for the chosen subscription and region.

Do not try to move partially provisioned resources just by changing this variable.
Inspect what exists first and plan any replacement deliberately.

## `backend` is shown as skipped

Packaging can overlap provisioning. A failed `preprovision` hook can prevent backend
deployment and display `Skipped`. Fix the **first hook error**, not the skipped
service line. Check whether a previous attempt created billed resources before retrying.

## Shell or script path errors after reorganizing

PowerShell scripts now live in `scripts/ps1`; Bash equivalents live in
`scripts/bash`. Use the current `azure.yaml`, not an older hook path.
On Linux/macOS, install Bash and `curl`, run shell scripts with `bash`, and use
native Node.js 22 or later. Do not run the Bash entry points through plain `sh`.
On Windows, azd selects PowerShell hooks even when launched from a Git Bash terminal.
Run Bash scripts explicitly if testing them on Windows.

Shell sources use LF line endings, enforced by `.gitattributes`. If an older local
copy reports a carriage-return or bad-interpreter error, restore LF endings rather
than modifying commands or disabling error handling.

## Bicep `BCP081` on preview APIM API types

The installed Bicep may lack metadata for
`Microsoft.ApiManagement/service/apis@2025-09-01-preview`. A warning does not
necessarily prevent compilation, but it also means static validation cannot check
all MCP properties. Live ARM validation and successful provisioning remain required.

Do not switch the APIops management version to an older stable version solely to
remove the warning: older versions can omit or reject MCP APIs. Promotion explicitly
uses `AZURE_API_VERSION=2025-09-01-preview`; CLI 1.0.5 has no registered
`--api-version` flag.

## App Service health or startup fails

Check, in order:

1. `azd env get-value AZURE_WEBAPP_NAME` identifies the intended app.
2. The azd package contains `package.json`, `package-lock.json` and `src/server.mjs`.
3. The Oryx build restored runtime dependencies.
4. App startup uses Node 22 LTS and `npm start`.
5. App settings include a valid `POC_BACKEND_KEY`, without revealing its value.
6. Startup and request logs show the actual failure.

A missing/short backend key intentionally fails startup. Do not weaken startup
validation to get a green health probe. Health is `GET /health`; `/mcp` is not a
generic liveness URL.

## HTTP and MCP failures

| Symptom | Likely boundary | Checks |
| --- | --- | --- |
| Gateway 401/403 | Client -> APIM | Correct gateway's subscription key, subscription state/scope, expected header. Management-plane 403 is instead an Azure permission issue. |
| Proxy call reaches backend but returns 401 | APIM -> App Service | Backend credential/header injection, named value, app setting consistency; do not print secrets for comparison. |
| Authenticated backend GET returns 405 | Backend transport | Expected: stateless MCP accepts POST, not a browser GET or session endpoint. |
| HTTP 415 on compressed body | Backend JSON parsing | Expected rejection; remove request compression. |
| HTTP 413 | Backend body limit | JSON body exceeded 64 KB. |
| MCP tool returns `isError` | Tool input or tool execution | `echo.message` must be a string of 1-200 characters; inspect safe error details. |
| `get_status missing from tools/list` | Native MCP configuration | Tool name and `mcpTools` binding in the correct instance. |
| `echo missing from tools/list` | Proxy/transport/backend selection | Proxy backend ID, `/mcp` URL and `streamable` transport configuration. |

Use the official MCP smoke test rather than treating a single raw HTTP request as
proof of protocol compliance. It performs initialization before tool discovery/calls.

## Source snapshot fails parsing `<policies>` as JSON

If source MCP calls pass but the snapshot fails with `Unexpected token` and
`<policies>` (possibly preceded by a UTF-8 BOM), the policy GET returned XML
instead of the JSON resource envelope. Azure CLI's `--output json` controls CLI
formatting; it does not force the ARM endpoint to return JSON.

Both promotion scripts explicitly send `--headers Accept=application/json` on
snapshot reads. The JSON `properties.value` still contains the XML policy, so
source policy content remains part of the before/after preservation check.
Use the updated scripts; do not strip the BOM and parse XML as JSON or skip the
policy snapshot. This failure occurs before APIops extraction or publication.

## Extraction loses an MCP API or its metadata

Check [source-filter.yaml](../config/source-filter.yaml), source instance name,
installed APIops version, and ARM version. The script requires exactly:

```text
poc-rest
poc-native
poc-proxy
```

The native API must retain `mcpTools`; the proxy must retain
`mcpProperties.transportType: streamable`. Lack of an exported OpenAPI document for
a native MCP API is expected, not automatically a failure.

Do not compensate by creating the target APIs with Bicep or the portal: that bypasses
the behavior the PoC is intended to test.

## Target native tool still references source APIM

The expected operation ID must contain the **target** service scope and end with:

```text
/apis/poc-rest/operations/get-status
```

An operation ID pointing at the source can make a tool appear callable while hiding
a failed cross-instance promotion. The script rejects that binding even if names match.
Inspect the extracted native API JSON and publisher behavior/version. Do not manually
rewrite the live binding just to claim the APIops test passed.

## Publication succeeds but verification fails

Configuration propagation can lag management-plane completion. Check target properties
and backend readiness, allow reasonable propagation, then retry the verification.
Rerunning the promotion script re-extracts and re-publishes when `-Apply` is supplied;
it is not a verification-only command.

For verification only, use [the manual MCP tests](testing-and-security.md#manual-protocol-verification)
with each gateway's key. A health check or publisher success is not enough to close
the incident.

If the source snapshot check fails, investigate source changes or concurrent
operators. The snapshot scope is documented in
[the acceptance checklist](testing-and-security.md#live-acceptance-checklist).

## Partial failure, recovery and evidence sharing

- No automated rollback exists. A failed APIops publish can leave some target changes.
- Reuse the same environment. Read ARM deployment operations and inventory the group
  before deciding to repair, retry or delete.
- Do not assume `azd up` rolls back the resource group if a later hook fails.
- Backend-only redeployment is `azd deploy backend`; it does not perform APIops promotion.
- Reprovisioning reapplies source seed definitions; do not erase intentional source
  changes unintentionally while troubleshooting backend code.

For a support report, collect the failed stage, command, tool versions, non-secret
resource names, selected region, HTTP status and redacted first error. Never include
local `.env` contents, subscription keys, backend keys, full environment dumps or
unreviewed debug logs.
