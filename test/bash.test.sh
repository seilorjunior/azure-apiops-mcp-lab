#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
MOCK_DIR="$(mktemp -d)"
export MOCK_LOG="$MOCK_DIR/calls.log"
export MOCK_FOLDERS="$MOCK_DIR/folders.log"
export MOCK_SOURCE_COUNT="$MOCK_DIR/source-count"
export MOCK_POLICY_COUNT="$MOCK_DIR/policy-count"
export MOCK_WRONG_BINDING=0 MOCK_BAD_METADATA=0 MOCK_NPM_EXIT=0 MOCK_FAIL_PUBLISH=0 MOCK_BAD_PATH=0 MOCK_CHANGED_SOURCE=0 MOCK_CHANGED_POLICY=0
export MOCK_PROXY_METADATA=canonical MOCK_BAD_PROXY=none
touch "$MOCK_LOG" "$MOCK_FOLDERS"
printf '0\n' > "$MOCK_SOURCE_COUNT"
printf '0\n' > "$MOCK_POLICY_COUNT"

cleanup() {
    local folder
    while IFS= read -r folder; do
        case "$folder" in
            "$ROOT"/artifacts/run-*) rm -rf -- "$folder" ;;
            *) printf 'Unexpected mock artifact path; refusing cleanup.\n' >&2; return 1 ;;
        esac
    done < "$MOCK_FOLDERS"
    rm -rf -- "$MOCK_DIR"
}
trap cleanup EXIT

fail_test() {
    printf 'FAIL: %s\n' "$*" >&2
    exit 1
}

az() {
    if [[ "$1" == account && "$2" == show ]]; then
        printf '{"id":"00000000-0000-4000-8000-000000000001"}\n'
        return
    fi
    [[ "$1" == rest ]] || { printf 'Unexpected mocked Azure command.\n' >&2; return 1; }
    local url='' tail instance path marker='unchanged' read_count request_arguments=" $* "
    while (( $# )); do
        if [[ "$1" == --url ]]; then url="$2"; break; fi
        shift
    done
    tail="${url#*/service/}"
    instance="${tail%%/*}"
    instance="${instance%%\?*}"
    [[ "$instance" == src || "$instance" == dst ]] ||
        { printf 'Unexpected mocked APIM scope.\n' >&2; return 1; }
    if [[ "$url" == *'/listSecrets?'* ]]; then
        printf '{"primaryKey":"%s-key"}\n' "$instance"
    elif [[ "$url" != *'/apis/'* ]]; then
        printf '{"properties":{"gatewayUrl":"https://%s.example.test"}}\n' "$instance"
    else
        path="${url#*/apis/}"
        path="${path%%\?*}"
        if [[ "$path" == poc-rest/operations/get-status/policies/policy ]]; then
            if [[ "$request_arguments" != *' --headers Accept=application/json '* ]]; then
                printf '\357\273\277<policies><inbound /></policies>\n'
                return
            fi
            if [[ "$MOCK_CHANGED_POLICY" == 1 ]]; then
                read_count="$(< "$MOCK_POLICY_COUNT")"
                read_count=$((read_count + 1))
                printf '%s\n' "$read_count" > "$MOCK_POLICY_COUNT"
                if (( read_count > 1 )); then marker='changed'; fi
            fi
        fi
        if [[ "$instance" == src && "$path" == poc-rest && "$MOCK_CHANGED_SOURCE" == 1 ]]; then
            read_count="$(< "$MOCK_SOURCE_COUNT")"
            read_count=$((read_count + 1))
            printf '%s\n' "$read_count" > "$MOCK_SOURCE_COUNT"
            if (( read_count > 1 )); then marker='changed'; fi
        fi
        command node --input-type=module - "$instance" "$path" "$marker" <<'NODE'
const [instance, path, marker] = process.argv.slice(2);
const properties = { path: path === 'poc-proxy' ? 'poc-proxy/mcp' : path, marker };
if (path === 'poc-proxy') {
    properties.type = 'mcp';
    properties.backendId = 'poc-mcp-backend';
    properties.mcpProperties = process.env.MOCK_PROXY_METADATA === 'legacy'
        ? { transportType: 'streamable' }
        : { endpoints: null, federation: null, isFederationRouter: false };
}
if (path.endsWith('/policies/policy')) {
    properties.format = 'xml';
    properties.value = `<policies><inbound><base /></inbound><!-- ${marker} --></policies>`;
}
if (instance === 'dst' && process.env.MOCK_BAD_PATH === '1') properties.path = 'wrong';
if (path === 'poc-native') {
    const target = process.env.MOCK_WRONG_BINDING === '1' ? 'src' : instance;
    properties.mcpTools = [{
        name: 'get_status',
        operationId: `/subscriptions/00000000-0000-4000-8000-000000000001/resourceGroups/test-rg/providers/Microsoft.ApiManagement/service/${target}/apis/poc-rest/operations/get-status`,
    }];
}
console.log(JSON.stringify({ properties }));
NODE
    fi
}

node() {
    if [[ "${1:-}" == */scripts/test-mcp.mjs ]]; then
        printf 'mcp|%s|%s|%s\n' "$2" "$3" "${POC_APIM_KEY:-}" >> "$MOCK_LOG"
    elif [[ "${1:-}" == */@azure-tools/apiops-cli/dist/cli/index.js ]]; then
        shift
        local operation="$1" instance='' folder='' dry_run=false
        [[ "${AZURE_API_VERSION:-}" == '2025-09-01-preview' ]] ||
            { printf 'Wrong API version.\n' >&2; return 1; }
        [[ " $* " == *' --no-transitive '* ]] ||
            { printf 'Missing dependency guard.\n' >&2; return 1; }
        [[ " $* " != *' --delete-unmatched '* && " $* " != *' --overrides '* ]] ||
            { printf 'Unexpected deletion or name override.\n' >&2; return 1; }
        while (( $# )); do
            case "$1" in
                --service-name) instance="$2"; shift ;;
                --output) folder="$2"; shift ;;
                --dry-run) dry_run=true ;;
            esac
            shift
        done
        printf '%s|%s|%s\n' "$operation" "$instance" "$dry_run" >> "$MOCK_LOG"
        if [[ "$operation" == extract ]]; then
            [[ "$instance" == src ]] || { printf 'Extraction used wrong instance.\n' >&2; return 1; }
            printf '%s\n' "$folder" >> "$MOCK_FOLDERS"
            command node --input-type=module - "$folder" <<'NODE'
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
for (const name of ['poc-rest', 'poc-native', 'poc-proxy']) {
    const directory = join(process.argv[2], 'apis', name);
    mkdirSync(directory, { recursive: true });
    const properties = {
        mcpTools: [{ name: process.env.MOCK_BAD_METADATA === '1' ? 'wrong' : 'get_status' }],
        type: 'mcp',
        backendId: 'poc-mcp-backend',
        mcpProperties: process.env.MOCK_PROXY_METADATA === 'legacy'
            ? { transportType: 'streamable' }
            : { endpoints: null, federation: null, isFederationRouter: false },
    };
    if (name === 'poc-proxy') {
        if (process.env.MOCK_BAD_PROXY === 'missing') delete properties.mcpProperties;
        if (process.env.MOCK_BAD_PROXY === 'changed') properties.mcpProperties = { transportType: 'sse' };
        if (process.env.MOCK_BAD_PROXY === 'backend') properties.backendId = 'wrong-backend';
        if (process.env.MOCK_BAD_PROXY === 'type') properties.type = 'http';
    }
    writeFileSync(join(directory, 'apiInformation.json'), JSON.stringify({ properties }));
}
NODE
        elif [[ "$operation" == publish ]]; then
            [[ "$instance" == dst ]] || { printf 'Publication used wrong instance.\n' >&2; return 1; }
            if [[ "$MOCK_FAIL_PUBLISH" == 1 && "$dry_run" == false ]]; then return 9; fi
        else
            printf 'Unexpected CLI operation.\n' >&2
            return 1
        fi
    else
        command node "$@"
    fi
}

npm() {
    [[ "$*" == test ]] || { printf 'Unexpected npm operation.\n' >&2; return 1; }
    printf 'npm-test\n' >> "$MOCK_LOG"
    return "$MOCK_NPM_EXIT"
}

curl() {
    printf '{"status":"ok"}\n'
}
apiops() {
    printf 'global-cli\n' >> "$MOCK_LOG"
    node "$ROOT/node_modules/@azure-tools/apiops-cli/dist/cli/index.js" "$@"
}
export -f az node npm curl apiops
export ROOT
export APIOPS_USE_GLOBAL=false

promote=(bash "$ROOT/scripts/bash/promote.sh" --resource-group test-rg --source-apim-name src --target-apim-name dst)
export AZURE_API_VERSION='previous-version' POC_APIM_KEY='previous-key'
"${promote[@]}"
grep -qx 'extract|src|false' "$MOCK_LOG" || fail_test 'Source extraction missing.'
grep -qx 'publish|dst|true' "$MOCK_LOG" || fail_test 'Dry-run missing.'
! grep -qx 'publish|dst|false' "$MOCK_LOG" || fail_test 'Default run applied changes.'

: > "$MOCK_LOG"
"${promote[@]}" --apply
grep -qx 'publish|dst|true' "$MOCK_LOG" || fail_test 'Apply must preview.'
grep -qx 'publish|dst|false' "$MOCK_LOG" || fail_test 'Apply must publish.'
[[ "$(grep -c '^mcp|' "$MOCK_LOG")" == 3 ]] || fail_test 'Wrong MCP test count.'
grep -qx 'mcp|https://src.example.test|source|src-key' "$MOCK_LOG" || fail_test 'Wrong source key/gateway.'
grep -qx 'mcp|https://dst.example.test|target|dst-key' "$MOCK_LOG" || fail_test 'Wrong target key/gateway.'
[[ "$AZURE_API_VERSION" == previous-version && "$POC_APIM_KEY" == previous-key ]] ||
    fail_test 'Parent environment changed.'

for scenario in MOCK_WRONG_BINDING MOCK_BAD_METADATA MOCK_FAIL_PUBLISH MOCK_BAD_PATH MOCK_CHANGED_SOURCE MOCK_CHANGED_POLICY; do
    export "$scenario=1"
    if "${promote[@]}" --apply > "$MOCK_DIR/failure.log" 2>&1; then
        fail_test "$scenario should have failed."
    fi
    case "$scenario" in
        MOCK_WRONG_BINDING) grep -q 'Target MCP tool still references' "$MOCK_DIR/failure.log" ;;
        MOCK_BAD_METADATA) grep -q 'Extraction lost REST-to-MCP' "$MOCK_DIR/failure.log" ;;
        MOCK_FAIL_PUBLISH) grep -q 'exit 9' "$MOCK_DIR/failure.log" ;;
        MOCK_BAD_PATH) grep -q 'canonical gateway path' "$MOCK_DIR/failure.log" ;;
        MOCK_CHANGED_SOURCE|MOCK_CHANGED_POLICY) grep -q 'Source API configuration changed' "$MOCK_DIR/failure.log" ;;
    esac
    export "$scenario=0"
done

MOCK_PROXY_METADATA=legacy "${promote[@]}"
for scenario in missing changed backend type; do
    : > "$MOCK_LOG"
    if MOCK_BAD_PROXY="$scenario" "${promote[@]}" --apply > "$MOCK_DIR/failure.log" 2>&1; then
        fail_test "Proxy metadata $scenario must fail."
    fi
    grep -q 'Extraction lost\|Extraction changed' "$MOCK_DIR/failure.log"
    ! grep -q '^publish|' "$MOCK_LOG" || fail_test 'Invalid proxy metadata must block all publisher calls.'
done

: > "$MOCK_LOG"
APIOPS_USE_GLOBAL=true "${promote[@]}"
[[ "$(grep -c '^global-cli$' "$MOCK_LOG")" == 2 ]] || fail_test 'Global CLI must extract and preview.'
! grep -qx 'publish|dst|false' "$MOCK_LOG" || fail_test 'Global default run applied changes.'
: > "$MOCK_LOG"
APIOPS_USE_GLOBAL=true "${promote[@]}" --apply
[[ "$(grep -c '^global-cli$' "$MOCK_LOG")" == 3 ]] || fail_test 'Global CLI must extract, preview and publish.'
grep -qx 'publish|dst|true' "$MOCK_LOG" || fail_test 'Global apply must preview.'
grep -qx 'publish|dst|false' "$MOCK_LOG" || fail_test 'Global apply must publish.'
grep -qx 'mcp|https://dst.example.test|target|dst-key' "$MOCK_LOG" || fail_test 'Global target verification missing.'
if APIOPS_USE_GLOBAL=true MOCK_FAIL_PUBLISH=1 "${promote[@]}" --apply > "$MOCK_DIR/failure.log" 2>&1; then
    fail_test 'Global CLI publication failure must propagate.'
fi
grep -q 'exit 9' "$MOCK_DIR/failure.log"
if APIOPS_USE_GLOBAL=invalid "${promote[@]}" > "$MOCK_DIR/failure.log" 2>&1; then
    fail_test 'Invalid CLI selection must fail.'
fi
grep -q 'APIOPS_USE_GLOBAL must be true or false' "$MOCK_DIR/failure.log"

if bash "$ROOT/scripts/bash/promote.sh" --resource-group test-rg --source-apim-name src --target-apim-name src \
    > "$MOCK_DIR/failure.log" 2>&1; then
    fail_test 'Identical instances must fail.'
fi
grep -q 'must be different' "$MOCK_DIR/failure.log"
if bash "$ROOT/scripts/bash/promote.sh" --resource-group > "$MOCK_DIR/failure.log" 2>&1; then
    fail_test 'Missing option value must fail.'
fi

export AZURE_SUBSCRIPTION_ID='00000000-0000-4000-8000-000000000001'
unset POC_BACKEND_KEY
bash "$ROOT/scripts/bash/preprovision.sh"
POC_BACKEND_KEY='test-only-key-with-at-least-32-characters' bash "$ROOT/scripts/bash/preprovision.sh"
if AZURE_SUBSCRIPTION_ID=wrong bash "$ROOT/scripts/bash/preprovision.sh" > "$MOCK_DIR/failure.log" 2>&1; then
    fail_test 'Wrong subscription must fail.'
fi
if MOCK_NPM_EXIT=1 bash "$ROOT/scripts/bash/preprovision.sh" > "$MOCK_DIR/failure.log" 2>&1; then
    fail_test 'Failed local tests must block provisioning.'
fi

export AZURE_RESOURCE_GROUP=test-rg SOURCE_APIM_NAME=src TARGET_APIM_NAME=dst
export SOURCE_GATEWAY_URL=https://src.example.test BACKEND_URL=https://backend.example.test
bash "$ROOT/scripts/bash/verify-source.sh"
if BACKEND_URL='' bash "$ROOT/scripts/bash/verify-source.sh" > "$MOCK_DIR/failure.log" 2>&1; then
    fail_test 'Missing azd output must fail.'
fi
printf '%s\n' 'PASS: Bash dry-run/apply, gateway/key selection, metadata/path/binding guards, CLI failures, preprovision and source verification.'
