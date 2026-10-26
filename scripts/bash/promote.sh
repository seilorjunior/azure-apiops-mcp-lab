#!/usr/bin/env bash
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

resource_group=''
source_apim=''
target_apim=''
apply=false
while (( $# )); do
    case "$1" in
        --resource-group|--source-apim-name|--target-apim-name)
            (( $# >= 2 )) && [[ -n "$2" && "$2" != --* ]] || fail "Missing value for $1."
            case "$1" in
                --resource-group) resource_group="$2" ;;
                --source-apim-name) source_apim="$2" ;;
                --target-apim-name) target_apim="$2" ;;
            esac
            shift 2
            ;;
        --apply) apply=true; shift ;;
        --help)
            printf '%s\n' 'Usage: bash scripts/bash/promote.sh --resource-group NAME --source-apim-name NAME --target-apim-name NAME [--apply]'
            exit 0
            ;;
        *) fail "Unknown argument: $1" ;;
    esac
done
[[ -n "$resource_group" && -n "$source_apim" && -n "$target_apim" ]] ||
    fail 'Resource group, source APIM name and target APIM name are required.'
assert_subscription
[[ "$source_apim" != "$target_apim" ]] || fail 'Source and target APIM instances must be different.'
service="$(service_url "$resource_group" "$source_apim")"
target_service="$(service_url "$resource_group" "$target_apim")"
gateway="$(az_json rest --url "$service?api-version=$API_VERSION" | json_get properties.gatewayUrl)"
target_gateway="$(az_json rest --url "$target_service?api-version=$API_VERSION" | json_get properties.gatewayUrl)"
key="$(get_test_key "$service")"
target_key="$(get_test_key "$target_service")"

source_snapshot() {
    local path
    for path in poc-rest poc-native poc-proxy poc-rest/operations/get-status poc-rest/operations/get-status/policies/policy; do
        az_json rest --url "$service/apis/$path?api-version=$API_VERSION" |
            node --input-type=module -e '
                import { readFileSync } from "node:fs";
                const value = JSON.parse(readFileSync(0, "utf8")).properties;
                if (!value) throw new Error("Source resource properties are missing.");
                process.stdout.write(JSON.stringify(value) + "\n");
            '
    done
}

cd -- "$ROOT"
export AZURE_API_VERSION="$API_VERSION"
test_mcp_endpoints "$gateway" source "$key"
before="$(source_snapshot)"
run_id="$(node --input-type=module -e 'import { randomUUID } from "node:crypto"; console.log(randomUUID());')"
folder="$ROOT/artifacts/run-$run_id"
cli="$ROOT/node_modules/@azure-tools/apiops-cli/dist/cli/index.js"
[[ -f "$cli" ]] || fail 'Run npm ci before promoting.'
filter="$ROOT/config/source-filter.yaml"
context=(--subscription-id "$SUBSCRIPTION_ID" --resource-group "$resource_group")
node "$cli" extract "${context[@]}" --service-name "$source_apim" \
    --output "$folder" --filter "$filter" --no-transitive
node --input-type=module - "$folder" <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const root = process.argv[2];
const apis = readdirSync(join(root, 'apis'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
assert.deepEqual(apis, ['poc-native', 'poc-proxy', 'poc-rest'],
    'Extraction did not return exactly the three source APIs.');
const info = (name) => JSON.parse(readFileSync(join(root, 'apis', name, 'apiInformation.json'), 'utf8'));
assert.equal(info('poc-native').properties?.mcpTools?.[0]?.name, 'get_status',
    'Extraction lost REST-to-MCP tool bindings.');
assert.equal(info('poc-proxy').properties?.mcpProperties?.transportType, 'streamable',
    'Extraction lost external MCP transport configuration.');
NODE
publish=(publish "${context[@]}" --service-name "$target_apim" --source "$folder" --filter "$filter" --no-transitive)
node "$cli" "${publish[@]}" --dry-run
if [[ "$apply" == false ]]; then
    printf 'Dry-run complete. Artifacts: %s\n' "$folder"
    printf 'Review changes to %s, then re-run with --apply to publish and test.\n' "$target_apim"
    exit 0
fi
node "$cli" "${publish[@]}"
for name in poc-rest poc-native poc-proxy; do
    target="$(az_json rest --url "$target_service/apis/$name?api-version=$API_VERSION")"
    if [[ "$name" == poc-native ]]; then
        expected="${target_service#https://management.azure.com}/apis/poc-rest/operations/get-status"
        actual="$(printf '%s' "$target" | json_get properties.mcpTools.0.operationId)"
        [[ "$actual" == "$expected" ]] ||
            fail 'Target MCP tool still references the source REST API or an unexpected operation.'
    fi
    expected_path="$name"
    [[ "$name" != poc-proxy ]] || expected_path='poc-proxy/mcp'
    actual_path="$(printf '%s' "$target" | json_get properties.path)"
    [[ "$actual_path" == "$expected_path" ]] ||
        fail "Target API $name did not preserve the canonical gateway path."
done
after="$(source_snapshot)"
[[ "$after" == "$before" ]] || fail 'Source API configuration changed during promotion.'
test_mcp_endpoints "$gateway" source "$key"
test_mcp_endpoints "$target_gateway" target "$target_key"
printf 'PASS: both MCP modes promoted; source configuration unchanged. Artifacts: %s\n' "$folder"
