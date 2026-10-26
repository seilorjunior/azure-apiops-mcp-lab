#!/usr/bin/env bash
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/common.sh"

stage="$ROOT/.local/backend"
if [[ -e "$stage" || -L "$stage" ]]; then
    rm -rf -- "$stage"
fi
mkdir -p -- "$stage"
cp -- "$ROOT/package.json" "$ROOT/package-lock.json" "$stage/"
cp -R -- "$ROOT/src" "$stage/"
printf '%s\n' 'Staged backend application only; no Azure state, APIops artifacts or credentials included.'
