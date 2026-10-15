#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_pgp_lib.sh"

alias_address="${ALIAS:-}"
[[ -n "$alias_address" ]] || die "set ALIAS in scripts/pgp/config.local.sh"

alias_path="$(urlencode_segment "$alias_address")"
key_file="$(resolve_path "${PUBLIC_KEY_FILE:-}")"
body="$(json_public_key_payload "$key_file" "${ENABLED:-true}" "${HIDE_SUBJECT:-false}")"

curl_api POST "/api/alias/$alias_path/pgp" \
  -H "Content-Type: application/json" \
  --data-binary "$body"
