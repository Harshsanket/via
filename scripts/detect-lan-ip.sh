#!/bin/sh
# Prints the host's LAN IPv4 address. Physical interfaces only, so an active
# VPN (utun/tun) is never mistaken for the home network.
set -eu

is_ipv4() {
  case "${1:-}" in
    ''|*[!0-9.]*) return 1 ;;
  esac
  old_ifs=$IFS
  IFS=.
  # shellcheck disable=SC2086
  set -- $1
  IFS=$old_ifs
  [ "$#" -eq 4 ] || return 1
  for octet in "$@"; do
    [ "$octet" -ge 0 ] 2>/dev/null && [ "$octet" -le 255 ] || return 1
  done
  return 0
}

is_private_ipv4() {
  is_ipv4 "${1:-}" || return 1
  case "$1" in
    10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*) return 0 ;;
    *) return 1 ;;
  esac
}

is_physical_iface() {
  case "$1" in
    en*|eth*|wl*|wlan*) return 0 ;;
    *) return 1 ;;
  esac
}

# macOS: ask the default-route interface first, then the usual Ethernet/Wi-Fi
# slots. Docker Desktop and VPN tunnels are not en*/eth*, so they are skipped.
if command -v ipconfig >/dev/null 2>&1; then
  iface=$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}' || true)
  if [ -n "${iface:-}" ] && is_physical_iface "$iface"; then
    ip=$(ipconfig getifaddr "$iface" 2>/dev/null || true)
    if is_private_ipv4 "${ip:-}"; then
      echo "$ip"
      exit 0
    fi
  fi
  for iface in en0 en1 en2 en3 en4 en5 en6 en7; do
    ip=$(ipconfig getifaddr "$iface" 2>/dev/null || true)
    if is_private_ipv4 "${ip:-}"; then
      echo "$ip"
      exit 0
    fi
  done
fi

# Linux: the source address of the default route, but only on a physical
# interface. Falls back to the first private address on one.
if command -v ip >/dev/null 2>&1; then
  iface=$(ip -4 route show default 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="dev") {print $(i+1); exit}}' || true)
  if [ -n "${iface:-}" ] && is_physical_iface "$iface"; then
    ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}' || true)
    if is_private_ipv4 "${ip:-}"; then
      echo "$ip"
      exit 0
    fi
  fi
  for ip in $(ip -4 -o addr show scope global 2>/dev/null | awk '$2 ~ /^(en|eth|wl|wlan)/ {split($4,a,"/"); print a[1]}'); do
    if is_private_ipv4 "$ip"; then
      echo "$ip"
      exit 0
    fi
  done
fi

# Last resort: the first private address reported by the OS.
if command -v hostname >/dev/null 2>&1; then
  for ip in $(hostname -I 2>/dev/null || true); do
    if is_private_ipv4 "$ip"; then
      echo "$ip"
      exit 0
    fi
  done
fi

echo "Could not detect a private IPv4 address. Set VIA_LAN_IP=<address>." >&2
exit 1
