#!/usr/bin/env bash

# Edit scripts/pgp/config.local.sh for local use.
# Environment variables override these defaults.
BASE_URL="${BASE_URL:-https://mail.thc.org}"
API_KEY="${API_KEY:-REPLACE_WITH_API_KEY}"

HANDLE="${HANDLE:-extencil}"
ALIAS="${ALIAS:-extencil@segfault.net}"

# Relative paths are resolved from scripts/pgp/.
PUBLIC_KEY_FILE="${PUBLIC_KEY_FILE:-public-key.asc}"

ENABLED="${ENABLED:-true}"
HIDE_SUBJECT="${HIDE_SUBJECT:-true}"

# Keep true if the endpoint certificate requires curl -k.
TLS_INSECURE="${TLS_INSECURE:-true}"
