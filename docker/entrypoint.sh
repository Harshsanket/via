#!/bin/sh
set -eu

log() {
  printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"
}

: "${VIA_HOST:?set VIA_HOST}"
: "${LAN_IP:?set LAN_IP}"
: "${DUCKDNS_DOMAIN:?set DUCKDNS_DOMAIN}"
: "${DUCKDNS_TOKEN:?set DUCKDNS_TOKEN}"
: "${REDIS_PASSWORD:?set REDIS_PASSWORD}"
: "${TURN_SECRET:?set TURN_SECRET}"

TURN_MIN_PORT="${TURN_MIN_PORT:-49300}"
TURN_MAX_PORT="${TURN_MAX_PORT:-49340}"

# The tmpfs mounts hide the image's directory tree, and the settings volume
# was created by the old API user. Fix ownership before the processes start.
mkdir -p \
  /var/lib/nginx/tmp/client_body \
  /var/lib/nginx/tmp/proxy \
  /var/lib/nginx/tmp/fastcgi \
  /var/lib/nginx/tmp/uwsgi \
  /var/lib/nginx/tmp/scgi \
  /var/lib/nginx/logs \
  /var/cache/nginx \
  /run/nginx
ln -sf /dev/stdout /var/lib/nginx/logs/access.log
ln -sf /dev/stderr /var/lib/nginx/logs/error.log
# nginx runs its master as root and drops workers to nginx; it creates and
# hands over the temp leaves itself. Keep the parents root-owned so it can.
chown -R root:root /var/lib/nginx /var/cache/nginx
chown -R root:root /config

# coturn config lives on tmpfs: the image root stays read-only.
cat > /tmp/turnserver.conf <<TURNEOF
listening-port=3478
fingerprint
listening-ip=0.0.0.0
no-tls
no-dtls
use-auth-secret
static-auth-secret=${TURN_SECRET}
realm=via
total-quota=100
stale-nonce=600
no-multicast-peers
no-tcp-relay
no-cli
min-port=${TURN_MIN_PORT}
max-port=${TURN_MAX_PORT}
external-ip=${LAN_IP}
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.65.0-192.168.65.255
denied-peer-ip=::1
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
TURNEOF

# Re-assert the DuckDNS A record hourly, like the old ddns service did.
update_ddns() {
  result=$(wget -qO- "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip=${LAN_IP}" || true)
  log "duckdns ${DUCKDNS_DOMAIN} -> ${LAN_IP}: ${result:-no response}"
}

(
  while true; do
    update_ddns
    sleep 3600
  done
) &
DDNS_PID=$!

redis-server \
  --port 6379 \
  --bind 127.0.0.1 \
  --save "" \
  --appendonly no \
  --maxmemory 64mb \
  --maxmemory-policy volatile-ttl \
  --requirepass "$REDIS_PASSWORD" &
REDIS_PID=$!

tries=0
until redis-cli --no-auth-warning -a "$REDIS_PASSWORD" ping >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -gt 30 ]; then
    log "redis did not become ready"
    exit 1
  fi
  sleep 1
done

turnserver -c /tmp/turnserver.conf --log-file=stdout --simple-log &
COTURN_PID=$!

cd /app/backend
NODE_ENV=production \
PORT=3000 \
REDIS_URL="redis://:${REDIS_PASSWORD}@127.0.0.1:6379" \
node dist/src/server.js &
API_PID=$!

tries=0
until wget -q -O /dev/null http://127.0.0.1:3000/api/v1/health; do
  tries=$((tries + 1))
  if [ "$tries" -gt 30 ]; then
    log "api did not become ready"
    exit 1
  fi
  sleep 1
done

nginx -g 'daemon off;' &
NGINX_PID=$!

caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
CADDY_PID=$!

cleanup() {
  trap - INT TERM
  kill "$CADDY_PID" "$NGINX_PID" "$API_PID" "$COTURN_PID" "$REDIS_PID" "$DDNS_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup INT TERM

while true; do
  for pid in "$CADDY_PID" "$NGINX_PID" "$API_PID" "$COTURN_PID" "$REDIS_PID" "$DDNS_PID"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      log "process $pid exited; stopping the container"
      cleanup
      exit 1
    fi
  done
  sleep 2
done
