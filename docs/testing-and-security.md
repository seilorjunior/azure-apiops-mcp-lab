# Testing, acceptance criteria and security boundaries

[Overview](../README.md) | [Architecture](../.github/modernize/assessment/engines/facts/architecture-diagram.md) | [Operations](operations.md) | [Troubleshooting](troubleshooting.md)

## What a passing PoC means

The PoC succeeds only when both MCP scenarios work after cross-instance promotion,
the native tool references the target REST operation, and the source configuration
checked by the script is unchanged. Compilation, an HTTP 200 health check, a
successful package upload, or publisher exit code zero alone is insufficient.

### Evidence levels

| Level | Evidence | Does not prove |
| --- | --- | --- |
| Local application | Backend tests use real local HTTP and the official MCP client. | Azure hosting, APIM routing or management-plane compatibility. |
| Offline orchestration | PowerShell/Bash regression tests mock npm, Azure CLI, Node smoke tests and APIops as appropriate. | Actual APIops service behavior, credential permissions or gateway propagation. |
| Static deployment | Bicep compilation, azd schema validation, package inspection. | Live template acceptance, regional SKU capacity or successful resource creation. |
| Source live test | Backend health and both source MCP tools work after azd deployment. | Target API promotion or target operation binding. |
| Promotion live test | Target binding/path checks, source snapshot comparison, source and target tool calls. | Full APIM backup/restore, global configuration preservation or disaster recovery. |

The checked-in [validation record](validation.md) separates completed
local checks from pending live checks. It must not be interpreted as current Azure
resource health or a fresh dependency scan.

## Run local tests

From the repository root in PowerShell 7 on Windows or Bash on Linux/macOS:

```powershell
npm ci
npm test
```

`npm test` stops when any suite returns nonzero. It runs these suites:

| Suite | Coverage |
| --- | --- |
| [server.test.mjs](../test/server.test.mjs) | Seven tests: absent/short startup key, anonymous health, missing/wrong MCP credentials, official-client initialize/list/call, authenticated GET rejection, invalid tool input, compressed-body rejection. |
| [preflight.test.mjs](../test/preflight.test.mjs) | Read-only source/target dependency checks, hosting/credential drift rejection and bounded readiness retries. |
| [mcp-client.test.mjs](../test/mcp-client.test.mjs) | Per-phase errors, notification/tool-call deadlines, no tool replay and no raw credential/response leakage. |
| [report.test.mjs](../test/report.test.mjs) | Allowlisted summary fields, privacy, CLI/API counts and failed/incomplete/skipped outcomes. |
| [api-snapshot.test.mjs](../test/api-snapshot.test.mjs) | Hash-only snapshots, explicit API filters, subset matching, drift rejection and mocked capture/preview/apply with target native binding checks. |
| [promotion.test.ps1](../test/promotion.test.ps1) | Source-only extraction, target-only publication, preview before apply, separate gateway/key selection, no deletion/affix flags, target binding guard, identical-instance rejection and environment restoration. |
| [preprovision.test.ps1](../test/preprovision.test.ps1) | Missing optional process key is allowed, environment-provided key is allowed, wrong subscription blocks npm, failing npm blocks provisioning, working directory restored. |
| [bash.test.sh](../test/bash.test.sh) | Bash equivalents: dry-run/apply routing, credentials, metadata/path/binding guards, CLI failure propagation, preprovision validation and source verification. |

[run-shell-tests.mjs](../test/run-shell-tests.mjs) selects the two PowerShell suites
on Windows and the Bash suite on Linux/macOS. The backend suite runs on all platforms.
To explicitly exercise Bash as well (for example in Git Bash on Windows), run:

```bash
bash test/bash.test.sh
```

To syntax-check every Bash script:

```bash
for script in scripts/bash/*.sh test/bash.test.sh; do bash -n "$script" || exit; done
```

The backend tests bind a temporary local loopback port and close the server afterward.
The promotion suite writes synthetic artifact directories under ignored `artifacts`
and removes its own directories in `finally`.

The compressed-body test deliberately produces an `UnsupportedMediaTypeError` log.
That log is expected if the test asserts HTTP 415 and the suite passes; do not
confuse it with an unexpected failure in a live deployment.

### Local backend development

To run the actual backend outside Azure:

```powershell
$env:POC_BACKEND_KEY = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:PORT = '8080'
npm start
```

In another terminal, `Invoke-RestMethod http://localhost:8080/health` should return
`status: ok`. Stop the server with Ctrl+C when done. The anonymous health endpoint
does not exercise MCP authentication or an APIM gateway.

The deployed service uses Node 22 LTS and `npm start`; local Node must be 22 or later.
`PORT` defaults to 8080 and must be an integer from 1 to 65535.

## Live acceptance checklist

Complete this only in a dedicated lab after deployment approval:

- [ ] The selected environment/subscription/region are correct and both APIM instances
      are Developer tier, capacity 1, with distinct hostnames.
- [ ] Dependencies and required permissions have been reviewed.
- [ ] App Service `/health` returns `{"status":"ok"}`.
- [ ] Read-only preflight passes: supported paid hosting, Always On, credential
      consistency, backend bindings and both test subscriptions.
- [ ] Source `/poc-native/mcp` initializes, lists `get_status`, and returns text
      containing `apiops-rest-ok`.
- [ ] Source `/poc-proxy/mcp` initializes, lists `echo`, and echoes
      `apiops-proxy-ok`.
- [ ] Dry-run identifies the intended target APIM and exact three API names.
- [ ] Extraction retains native `mcpTools` and proxy `mcpProperties`.
- [ ] Apply creates/updates the target APIs, not the source.
- [ ] Target native `operationId` equals the target APIM's full ARM ID for
      `apis/poc-rest/operations/get-status`.
- [ ] Target API paths remain `poc-rest`, `poc-native`, and `poc-proxy/mcp`.
- [ ] Source snapshot comparison passes.
- [ ] Both source and both target MCP tool calls pass using the respective keys.

The script's snapshot covers the three source API `properties`, the REST operation
`properties`, and that operation's policy `properties`. It is **not** a snapshot of
every source APIM resource or every property outside those payloads.

### Manual protocol verification

Obtain the correct instance's `poc-test-client` subscription key through an authorized
mechanism. Supply it in `POC_APIM_KEY`, not a command argument. Then run:

```powershell
$gateway = azd env get-value SOURCE_GATEWAY_URL
npm run test:mcp -- $gateway source
```

For target, replace `POC_APIM_KEY` with the target subscription key:

```powershell
$gateway = azd env get-value TARGET_GATEWAY_URL
npm run test:mcp -- $gateway target
```

In Bash, read the gateway with `gateway="$(azd env get-value SOURCE_GATEWAY_URL)"`
or `TARGET_GATEWAY_URL` and run `npm run test:mcp -- "$gateway" source` or `target`.
Provide `POC_APIM_KEY` securely in the process environment; do not put it in arguments.

`source` and `target` are report labels; the script uses the gateway URL you pass.
It does not select a gateway or change paths automatically. Gateway URLs must use HTTPS.

The verifier connects with the official SDK, lists tools, calls each expected tool,
rejects MCP `isError`, checks returned text and closes the client.

For interactive inspection in VS Code, use **MCP: Add Server**, choose HTTP and
enter the appropriate full MCP endpoint. Configure `Ocp-Apim-Subscription-Key`
through a secret input rather than committing a literal key to workspace settings.
No VS Code MCP settings or AI model usage are required for the automated test.

## Security model

### Separate identity and credential layers

| Layer | Credential/identity | Purpose | Scope and limitation |
| --- | --- | --- | --- |
| Deployment and promotion | Azure login identity | Create/update resources and manage APIM configuration. | Needs subscription deployment/resource-group creation permissions and service-level management rights. No automatic RBAC grants are provided. |
| MCP client -> APIM | `Ocp-Apim-Subscription-Key` | Authorize use of gateway APIs. | Separate key per instance; lab test subscription covers all APIs in that instance. Not per-user OAuth. |
| APIM -> backend | `x-poc-backend-key` | Authenticate direct backend requests. | Same secret shared by both gateways and App Service in this lab. |
| Operator -> health | None | Check application liveness. | Health is intentionally public and returns only status. |

The backend secret is **not** the APIM subscription key or an Azure service-principal
secret. An infrastructure secured parameter is not the same thing as an Azure Key
Vault deployment; a 32-character minimum is length validation, not proof of entropy.

### Controls present in the implementation

- Secure Bicep `backendKey` parameter with a 32-character minimum; server validates
  the same minimum at startup.
- APIM API subscriptions required for all PoC APIs.
- Backend key checked before MCP JSON processing, with constant-time comparison
  for same-length values.
- HTTPS-only App Service; minimum TLS 1.2; FTP disabled.
- APIM backend URL uses HTTPS with certificate-name and chain validation enabled.
- JSON body size limited to 64 KB and compressed-body inflation disabled.
- Echo message validated to 1-200 characters.
- Stateless server with no session store; authenticated non-POST MCP calls get 405.
- No application response-body logging, MCP buffering policy or tracing configuration
  is intentionally added by this project.
- Explicit API filter, `--no-transitive`, no `--delete-unmatched`, and separate
  source/target instance guard.
- Deployment archive contains only application manifests and source, not `.azure`
  environment files or extracted APIM artifacts.

### Sensitive local material

| Location | Handling |
| --- | --- |
| `.azure/<environment>` and other azd state | Treat as sensitive; do not print complete values or commit state. |
| Process variables `POC_BACKEND_KEY`, `POC_APIM_KEY` | Do not put into screenshots, command arguments or chat. Clear when no longer needed. |
| APIM named values and App Service settings | Restrict Azure configuration access; secret masking is not full access isolation. |
| `artifacts/run-*` | Inspect privately; filtering limits scope but artifacts/logs can still reveal configuration or policy content. |
| Test reports and assertion errors | Review before sharing; a failed tool call can include returned tool content. |

Git exclusions reduce accidental commits; they are not encryption or a substitute
for inspecting staged files. Never publish a local `.env` file as project documentation.

## Dependency and production readiness

The earlier full audit reported ten findings, including development-only CLI paths;
the production-only audit reported five. Those counts are a historical snapshot,
not a current clean bill of health. Re-evaluate before exposing the lab:

See [the dependency risk register](dependency-risks.md) for the dated advisory
identifiers, compatibility constraints and Azure workflow opt-in policy.

```powershell
npm audit
npm audit --omit=dev
```

Do not apply `npm audit fix --force` or unsupported major overrides blindly. APIops
is a development dependency but still runs with an Azure management identity during
promotion. A production-only audit does not cover the operator toolchain.

Production hardening would require deliberate design and verification of:

- Supported production APIM tier, capacity, budget and reliability requirements.
- Per-user/workload authentication and authorization, preferably identity-based.
- Secret storage/rotation and reduced trust across source/target environments.
- Network exposure restrictions and independent environment/resource boundaries.
- Appropriate monitoring, safe logs, alerting, rate limits and abuse controls.
- Audited dependency remediation and a secured CI/CD identity.
- Artifact review/versioning, controlled approval, rollback and failure recovery.

None of these are implicitly delivered by a successful PoC run.
