#!/bin/bash
set -euo pipefail

CONF="$PWD/redis.conf"
ENVOUT="$PWD/.env.redis"

echo "[*] Generating redis.conf..."

PASS="$(openssl rand -hex 32 | tr -d '\n')"

cat > "$CONF" <<EOF
bind 0.0.0.0
protected-mode yes
requirepass $PASS
appendonly yes
EOF

echo "[*] Starting Redis container..."

# remove container antigo se existir (opcional)
docker rm -f redis-rate-limit >/dev/null 2>&1 || true

docker run -d --name redis-rate-limit \
  -p 127.0.0.1:6379:6379 \
  -v "$CONF:/usr/local/etc/redis/redis.conf:ro" \
  --restart unless-stopped \
  redis:7-alpine redis-server /usr/local/etc/redis/redis.conf

cat > "$ENVOUT" <<EOF
REDIS_URL=redis://:$PASS@127.0.0.1:6379
EOF

echo "[+] Redis is up."
echo "[+] Wrote $ENVOUT (contains REDIS_URL). Keep it secret."
