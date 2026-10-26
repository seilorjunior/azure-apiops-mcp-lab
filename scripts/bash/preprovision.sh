#!/usr/bin/env bash
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

[[ "${AZURE_SUBSCRIPTION_ID:-}" == "$SUBSCRIPTION_ID" ]] ||
    fail "azd must use the approved subscription: $SUBSCRIPTION_ID"
cd -- "$ROOT"
npm test
