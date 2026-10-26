#!/bin/sh
set -e

# TURN_ENABLED=false skips the relay entirely. Peers on one LAN connect
# directly, and an unused relay is only a way into the container's networks.
TURN_ENABLED="${TURN_ENABLED:-true}"

if [ "$TURN_ENABLED" = "true" ]; then
  : "${TURN_SECRET:=$(openssl rand -hex 32)}"
  TURN_HOST="${TURN_HOST:-127.0.0.1}"
  : "${TURN_URLS:=turn:${TURN_HOST}:3478?transport=udp,turn:${TURN_HOST}:3478?transport=tcp}"
  : "${EXTERNAL_IP:=${TURN_HOST}}"
  TURN_REALM="${TURN_REALM:-via}"
  TURN_MIN_PORT="${TURN_MIN_PORT:-49160}"
  TURN_MAX_PORT="${TURN_MAX_PORT:-49200}"

  cat > /etc/turnserver.conf <<TURNEOF
listening-port=3478
fingerprint
listening-ip=0.0.0.0
no-tls
no-dtls
use-auth-secret
static-auth-secret=${TURN_SECRET}
realm=${TURN_REALM}
total-quota=100
stale-nonce=600
no-multicast-peers
no-tcp-relay
# Relays must never reach this host, the Docker networks or link-local space.
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=::1
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
no-cli
min-port=${TURN_MIN_PORT}
max-port=${TURN_MAX_PORT}
external-ip=${EXTERNAL_IP}
TURNEOF

  turnserver -c /etc/turnserver.conf --daemon
  export TURN_URLS TURN_SECRET
else
  unset TURN_URLS TURN_SECRET
fi

redis-server --daemonize yes --port 6379

cd /app/backend
NODE_ENV=production \
PORT=3000 \
REDIS_URL=redis://127.0.0.1:6379 \
node dist/src/server.js &
BACKEND_PID=$!

nginx -g 'daemon off;' &
NGINX_PID=$!

cleanup() {
  kill "$BACKEND_PID" "$NGINX_PID" 2>/dev/null || true
  pkill turnserver 2>/dev/null || true
  redis-cli shutdown nosave 2>/dev/null || true
}
trap cleanup INT TERM

while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$NGINX_PID" 2>/dev/null; do
  sleep 1
done

cleanup
wait "$BACKEND_PID" 2>/dev/null || true
wait "$NGINX_PID" 2>/dev/null || true
