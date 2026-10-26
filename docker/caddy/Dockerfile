# Caddy with the DuckDNS provider, for the ACME DNS-01 challenge: Let's Encrypt
# checks a TXT record instead of connecting to this machine, so a name that
# points at a LAN IP can still get a publicly trusted certificate.
FROM caddy:2.10-builder AS build
RUN xcaddy build --with github.com/caddy-dns/duckdns

FROM caddy:2.10
COPY --from=build /usr/bin/caddy /usr/bin/caddy
