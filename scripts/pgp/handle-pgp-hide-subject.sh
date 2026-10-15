#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_pgp_lib.sh"

handle="${HANDLE:-}"
[[ -n "$handle" ]] || die "set HANDLE in scripts/pgp/config.local.sh"

handle_path="$(urlencode_segment "$handle")"
body="$(json_bool_patch_payload hide_subject true)"

curl_api PATCH "/api/handle/$handle_path/pgp" \
  -H "Content-Type: application/json" \
  --data-binary "$body"
