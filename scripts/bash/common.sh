#!/usr/bin/env bash
set -Eeuo pipefail
trap 'status=$?; printf "ERROR: command failed in %s:%s (exit %s)\n" "${BASH_SOURCE[0]}" "$LINENO" "$status" >&2; exit "$status"' ERR

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
SUBSCRIPTION_ID="${AZURE_SUBSCRIPTION_ID:-}"
API_VERSION='2025-09-01-preview'

fail() {
    printf 'ERROR: %s\n' "$*" >&2
    exit 1
}

az_json() {
    az "$@" --only-show-errors --output json
}

json_get() {
    node --input-type=module -e '
        import { readFileSync } from "node:fs";
        const value = process.argv[1].split(".").reduce((item, key) => item?.[key],
            JSON.parse(readFileSync(0, "utf8")));
        if (value === undefined || value === null || value === "") {
            throw new Error(`Required JSON field missing: ${process.argv[1]}`);
        }
        process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));
    ' "$1"
}

assert_subscription() {
    local account
    [[ "$SUBSCRIPTION_ID" =~ ^[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}$ ]] ||
        fail 'Set AZURE_SUBSCRIPTION_ID to the intended Azure subscription UUID.'
    account="$(az_json account show | json_get id)"
    [[ "$account" == "$SUBSCRIPTION_ID" ]] ||
        fail "Select the configured subscription first: az account set --subscription $SUBSCRIPTION_ID"
}

service_url() {
    printf 'https://management.azure.com/subscriptions/%s/resourceGroups/%s/providers/Microsoft.ApiManagement/service/%s' \
        "$SUBSCRIPTION_ID" "$1" "$2"
}

get_test_key() {
    az_json rest --method post --url \
        "$1/subscriptions/poc-test-client/listSecrets?api-version=$API_VERSION" |
        json_get primaryKey
}

test_mcp_endpoints() {
    POC_APIM_KEY="$3" node "$ROOT/scripts/test-mcp.mjs" "$1" "$2"
}
