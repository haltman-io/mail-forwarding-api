#!/usr/bin/env bash
set -euo pipefail

PGP_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "$PGP_SCRIPT_DIR/config.local.sh" ]]; then
  # shellcheck source=/dev/null
  source "$PGP_SCRIPT_DIR/config.local.sh"
else
  # shellcheck source=/dev/null
  source "$PGP_SCRIPT_DIR/config.example.sh"
fi

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

python_bin() {
  if command -v python3 >/dev/null 2>&1; then
    printf 'python3'
    return
  fi

  if command -v python >/dev/null 2>&1; then
    printf 'python'
    return
  fi

  die "python3 or python is required to encode JSON safely"
}

bool_value() {
  local name="$1"
  local value="${2:-}"
  local normalized

  normalized="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  case "$normalized" in
    1|true|yes|on)
      printf 'true'
      ;;
    0|false|no|off)
      printf 'false'
      ;;
    *)
      die "$name must be true or false"
      ;;
  esac
}

require_config() {
  [[ -n "${BASE_URL:-}" ]] || die "set BASE_URL in scripts/pgp/config.local.sh"
  [[ -n "${API_KEY:-}" ]] || die "set API_KEY in scripts/pgp/config.local.sh"
  [[ "$API_KEY" != "REPLACE_WITH_API_KEY" ]] || die "replace API_KEY in scripts/pgp/config.local.sh"
}

resolve_path() {
  local raw="$1"

  [[ -n "$raw" ]] || die "missing path"
  case "$raw" in
    /*|[A-Za-z]:/*|[A-Za-z]:\\*)
      printf '%s' "$raw"
      ;;
    *)
      printf '%s/%s' "$PGP_SCRIPT_DIR" "$raw"
      ;;
  esac
}

urlencode_segment() {
  local raw="$1"
  local py

  py="$(python_bin)"
  RAW_SEGMENT="$raw" "$py" -c 'import os, urllib.parse; print(urllib.parse.quote(os.environ["RAW_SEGMENT"], safe=""))'
}

api_url() {
  local path="$1"
  local base="${BASE_URL%/}"

  printf '%s%s' "$base" "$path"
}

curl_api() {
  local method="$1"
  local path="$2"
  local url
  local tls_insecure
  local curl_args

  shift 2
  require_config

  url="$(api_url "$path")"
  tls_insecure="$(bool_value TLS_INSECURE "${TLS_INSECURE:-false}")"
  curl_args=(-sS -i)

  if [[ "$tls_insecure" == "true" ]]; then
    curl_args+=(-k)
  fi

  curl "${curl_args[@]}" -X "$method" "$url" -H "X-API-Key: $API_KEY" "$@"
}

json_public_key_payload() {
  local key_file="$1"
  local enabled="$2"
  local hide_subject="$3"
  local py

  [[ -f "$key_file" ]] || die "public key file not found: $key_file"
  grep -q "BEGIN PGP PUBLIC KEY BLOCK" "$key_file" || die "$key_file must contain an armored PGP public key"
  grep -q "END PGP PUBLIC KEY BLOCK" "$key_file" || die "$key_file must contain a complete armored PGP public key"

  py="$(python_bin)"
  KEY_FILE="$key_file" \
  ENABLED_VALUE="$(bool_value ENABLED "$enabled")" \
  HIDE_SUBJECT_VALUE="$(bool_value HIDE_SUBJECT "$hide_subject")" \
  "$py" -c 'import json, os
with open(os.environ["KEY_FILE"], "r", encoding="utf-8") as f:
    public_key = f.read()
payload = {
    "public_key": public_key,
    "enabled": os.environ["ENABLED_VALUE"] == "true",
    "hide_subject": os.environ["HIDE_SUBJECT_VALUE"] == "true",
}
print(json.dumps(payload, separators=(",", ":")))'
}

json_bool_patch_payload() {
  local field="$1"
  local value="$2"
  local py

  py="$(python_bin)"
  FIELD="$field" \
  VALUE="$(bool_value "$field" "$value")" \
  "$py" -c 'import json, os
print(json.dumps({os.environ["FIELD"]: os.environ["VALUE"] == "true"}, separators=(",", ":")))'
}
