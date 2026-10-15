#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_pgp_lib.sh"

handle="${HANDLE:-}"
[[ -n "$handle" ]] || die "set HANDLE in scripts/pgp/config.local.sh"

handle_path="$(urlencode_segment "$handle")"
curl_api GET "/api/handle/$handle_path/pgp"
