#!/bin/sh
# Start Via and keep the DuckDNS/TURN address in step with this machine.
#
# Detects the host's LAN IPv4, writes it to LAN_IP in .env, then runs
# `docker compose up -d --build`. Re-run it whenever the machine changes
# networks. Set VIA_LAN_IP to override detection (multiple NICs, unusual LAN).
set -eu
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Missing .env. Copy .env.example to .env and fill in its secrets first." >&2
  exit 1
fi

if [ -n "${VIA_LAN_IP:-}" ]; then
  lan_ip=$VIA_LAN_IP
else
  lan_ip=$(./scripts/detect-lan-ip.sh)
fi

if [ -z "$lan_ip" ]; then
  echo "No LAN address detected; nothing was changed." >&2
  exit 1
fi

case "$lan_ip" in
  *[!0-9.]*|'') echo "Refusing invalid LAN address: $lan_ip" >&2; exit 1 ;;
esac

# Rewrite only the LAN_IP line; secrets and comments stay untouched.
tmp=$(mktemp "${TMPDIR:-/tmp}/via-env.XXXXXX")
trap 'rm -f "$tmp"' EXIT INT TERM
awk -v ip="$lan_ip" '
  BEGIN { done = 0 }
  /^LAN_IP=/ { print "LAN_IP=" ip; done = 1; next }
  { print }
  END { if (!done) print "LAN_IP=" ip }
' .env > "$tmp"
chmod 600 "$tmp"
mv "$tmp" .env
trap - EXIT INT TERM

echo "LAN_IP=$lan_ip"
exec docker compose up -d --build "$@"
