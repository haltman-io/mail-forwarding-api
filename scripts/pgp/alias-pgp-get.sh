#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_pgp_lib.sh"

alias_address="${ALIAS:-}"
[[ -n "$alias_address" ]] || die "set ALIAS in scripts/pgp/config.local.sh"

alias_path="$(urlencode_segment "$alias_address")"
curl_api GET "/api/alias/$alias_path/pgp"
