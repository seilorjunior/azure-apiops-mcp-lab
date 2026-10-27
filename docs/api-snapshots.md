# Version extracted API configuration in Git

Use the local, cross-platform `snapshot:apis` command to capture a hash-only
snapshot and publish an explicit subset of APIs that matches it.
This is separate from the existing three-API promotion workflow. It does not
change MCP endpoint versions, automatically select newly discovered APIs or run
from GitHub Actions.

## What goes into Git

| File | Purpose |
| --- | --- |
| [snapshot-apis.json](../config/snapshot-apis.json) | Complete explicit list of API IDs to capture; initially the three sample APIs. |
| [publish-apis.json](../config/publish-apis.json) | Explicit subset to preview/publish; initially empty so publication fails closed. |
| `api-snapshots/lab.json` | Generated manifest with schema version, selected API IDs, resource-file names and SHA-256 hashes. |

The manifest contains **no exported property values, policy text, credentials,
URLs or ARM resource IDs**. API IDs and resource-file names remain visible; review
their names before committing. A hash is a change detector, not encryption or a
secret-storage mechanism. Review sensitive configuration locally and never
publish raw exports. Do not rely on hashes to protect guessable secrets.

No sample manifest is fabricated or populated from a user's Azure environment
automatically. Capture the first snapshot against your own source.

## Prerequisites

1. Run `npm ci` and sign in to Azure CLI.
2. Deploy and verify the lab using [the operations guide](operations.md).
3. Set `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`, `SOURCE_APIM_NAME`,
   `TARGET_APIM_NAME` and `AZURE_WEBAPP_NAME` in your local process.
   Never paste identifier values or credentials into public logs.
4. Ensure the source and target names differ. The authenticated subscription must
   match the configured subscription. All commands run the existing read-only
   lab preflight, including backend readiness and credential consistency.
5. Pre-provision target dependencies. This flow remains API-only and excludes
   backends, named values, products, version sets and other resource families.

This command is designed for APIs in the existing lab, not arbitrary APIM services
without its shared backend and test subscriptions.

## 1. Capture the source snapshot

Add reviewed API IDs to [snapshot-apis.json](../config/snapshot-apis.json).
For example, retain the sample APIs and add `new-mcp-api` after creating it in source:

```json
{
  "apis": ["poc-rest", "poc-native", "poc-proxy", "new-mcp-api"]
}
```

Run the same command in PowerShell or Bash:

```text
npm run snapshot:apis -- capture
```

Capture reads source configuration and writes `api-snapshots/lab.json`. It never
calls the publisher. Raw exports, generated filter files and APIops logs stay
under ignored `artifacts/snapshot-*` directories.

Review the raw configuration privately, then open a PR containing only the
allowlist and hash manifest. Its diff shows which resource files were added,
removed or changed; it does not show semantic policy or tool-contract changes.
Do not treat a hash diff as a substitute for reviewing the actual source.

Keep one manifest path per source environment. Hashes cover exact file bytes,
including environment-specific references and formatting. Even a formatting-only
change requires recapture and review. Do not hand-edit hashes to bypass drift.

## 2. Select only the APIs to publish

Update [publish-apis.json](../config/publish-apis.json), for example:

```json
{
  "apis": ["new-mcp-api"]
}
```

Commit and review this selection too. Every selected API must already appear in
the reviewed full manifest. The default empty list is rejected.
Wildcards, duplicates and API revision suffixes are rejected.

Selection means **create or update**, not create-only. If `new-mcp-api` already
exists on target, publishing can update it. Nothing infers that an API is new by
comparing Git history or listing target APIs.

## 3. Preview and explicitly apply

```text
npm run snapshot:apis -- preview
```

Preview freshly extracts only the publication allowlist using a filter with all
other resource families explicitly empty and `--no-transitive`. It compares every
selected API's files and hashes with its portion of the manifest. Extra, missing
or modified files fail before publisher preview. Unselected APIs are not extracted
or passed to the publisher. Nothing enables unmatched-resource deletion.

Inspect the private publisher plan locally, then explicitly apply:

```text
npm run snapshot:apis -- apply
```

Apply extracts again and must match the same manifest, previews publication,
rechecks the local artifact hashes, then publishes. A changed selected source API
blocks the run. Apply does not reuse an earlier runner's raw export or restore
redacted secrets. The publisher's own redaction checks remain in force.

For another reviewed selection or manifest, supply explicit paths:

```text
npm run snapshot:apis -- preview --allowlist config/publish-apis.json --snapshot api-snapshots/lab.json
```

## Dependencies and verification boundaries

- Referenced target backends must exist. Named values, policy fragments and other
  references in policy text must also be provisioned; this command does not parse
  arbitrary policies or promote those dependencies.
- For native MCP, include its dependent REST API in the selection when needed.
  Otherwise the referenced REST operation must already exist on target.
  Native operation bindings must refer to the configured source service; after
  publication, the command verifies they point to the target service.
- APIs referencing APIM version sets are rejected before publisher preview.
- After publication, path, API type and explicit backend/MCP metadata are checked. Configuration publication
  alone is not MCP acceptance: run `initialize`, `tools/list` and `tools/call` for
  every new or changed MCP scenario using the correct target credentials.
  Existing sample checks cover only their original tools.
- This flow has no atomic transaction or automatic rollback. A failed publication
  can leave partial target changes. It does not prove unrelated target state is
  unchanged or replace the original promotion flow's source snapshot assertions.
- The source and target still share a backend. Deploying a changed backend can
  affect both gateways independently of APIM configuration promotion.
- Preserve raw exports/logs only as long as needed for private review and
  troubleshooting, then remove the specific run directory. Never upload them.

No Git commit, push, live extraction or publication occurs just by installing the
scripts or running offline tests.
