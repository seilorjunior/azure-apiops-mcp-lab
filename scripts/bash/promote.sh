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
case "${APIOPS_USE_GLOBAL:-false}" in
    true)
        command -v apiops > /dev/null || fail 'Install the global APIops CLI before promoting.'
        cli=(apiops)
        ;;
    false)
        cli_path="$ROOT/node_modules/@azure-tools/apiops-cli/dist/cli/index.js"
        [[ -f "$cli_path" ]] || fail 'Run npm ci before promoting.'
        cli=(node "$cli_path")
        ;;
    *) fail 'APIOPS_USE_GLOBAL must be true or false.' ;;
esac
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
        az_json rest --url "$service/apis/$path?api-version=$API_VERSION" --headers Accept=application/json |
            node --input-type=module -e '
                import { readFileSync } from "node:fs";
                const value = JSON.parse(readFileSync(0, "utf8")).properties;
                if (!value) throw new Error("Source resource properties are missing.");
                process.stdout.write(JSON.stringify({ [process.argv[1]]: value }) + "\n");
            ' "$path"
    done | node --input-type=module -e '
        import { readFileSync } from "node:fs";
        const entries = readFileSync(0, "utf8").trim().split("\n").map((line) => JSON.parse(line));
        process.stdout.write(JSON.stringify(Object.assign({}, ...entries)));
    '
}

cd -- "$ROOT"
export AZURE_API_VERSION="$API_VERSION"
test_preflight "$resource_group" "$source_apim" "$target_apim"
start_stage source-mcp
test_mcp_endpoints "$gateway" source "$key"
pass_stage source-mcp
start_stage source-snapshot
before="$(source_snapshot)"
pass_stage source-snapshot
run_id="$(node --input-type=module -e 'import { randomUUID } from "node:crypto"; console.log(randomUUID());')"
folder="$ROOT/artifacts/run-$run_id"
filter="$ROOT/config/source-filter.yaml"
context=(--subscription-id "$SUBSCRIPTION_ID" --resource-group "$resource_group")
start_stage extraction
"${cli[@]}" extract "${context[@]}" --service-name "$source_apim" \
    --output "$folder" --filter "$filter" --no-transitive
pass_stage extraction
start_stage artifact-validation
printf '%s' "$before" | node "$ROOT/scripts/validate-extraction.mjs" "$folder"
publish=(publish "${context[@]}" --service-name "$target_apim" --source "$folder" --filter "$filter" --no-transitive)
start_stage publisher-preview
"${cli[@]}" "${publish[@]}" --dry-run
pass_stage publisher-preview
if [[ "$apply" == false ]]; then
    printf 'Dry-run complete. Artifacts: %s\n' "$folder"
    printf 'Review changes to %s, then re-run with --apply to publish and test.\n' "$target_apim"
    exit 0
fi
start_stage publication
"${cli[@]}" "${publish[@]}"
pass_stage publication
start_stage target-validation
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
pass_stage target-validation
start_stage source-preservation
after="$(source_snapshot)"
[[ "$after" == "$before" ]] || fail 'Source API configuration changed during promotion.'
pass_stage source-preservation
start_stage source-mcp
test_mcp_endpoints "$gateway" source "$key"
pass_stage source-mcp
start_stage target-mcp
test_mcp_endpoints "$target_gateway" target "$target_key"
pass_stage target-mcp
printf 'PASS: both MCP modes promoted; source configuration unchanged. Artifacts: %s\n' "$folder"
