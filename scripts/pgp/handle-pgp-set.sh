#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_pgp_lib.sh"

handle="${HANDLE:-}"
[[ -n "$handle" ]] || die "set HANDLE in scripts/pgp/config.local.sh"

handle_path="$(urlencode_segment "$handle")"
key_file="$(resolve_path "${PUBLIC_KEY_FILE:-}")"
body="$(json_public_key_payload "$key_file" "${ENABLED:-true}" "${HIDE_SUBJECT:-false}")"

curl_api POST "/api/handle/$handle_path/pgp" \
  -H "Content-Type: application/json" \
  --data-binary "$body"
