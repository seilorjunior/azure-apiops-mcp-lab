#!/usr/bin/env bash
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

for name in AZURE_RESOURCE_GROUP SOURCE_APIM_NAME TARGET_APIM_NAME SOURCE_GATEWAY_URL BACKEND_URL; do
    [[ -n "${!name:-}" ]] || fail "Missing azd output $name. Provision the selected environment first."
done
assert_subscription
test_preflight "$AZURE_RESOURCE_GROUP" "$SOURCE_APIM_NAME" "$TARGET_APIM_NAME"
health="$(curl --fail --silent --show-error --max-time 60 "$BACKEND_URL/health" | json_get status)"
[[ "$health" == 'ok' ]] || fail 'Backend health check failed.'
service="$(service_url "$AZURE_RESOURCE_GROUP" "$SOURCE_APIM_NAME")"
key="$(get_test_key "$service")"
test_mcp_endpoints "$SOURCE_GATEWAY_URL" source "$key"
printf '%s\n' 'Source MCP tests passed. Next, preview APIops promotion:'
printf 'bash ./scripts/bash/promote.sh --resource-group %q --source-apim-name %q --target-apim-name %q\n' \
    "$AZURE_RESOURCE_GROUP" "$SOURCE_APIM_NAME" "$TARGET_APIM_NAME"
