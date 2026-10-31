# syntax=docker/dockerfile:1.7

# Via runs as one container: Caddy terminates TLS and answers the DuckDNS
# ACME challenge, nginx serves the frontend and proxies to the API, and Redis
# and coturn run beside them. docker-compose.yml starts only this image.

FROM caddy:2.10-builder AS caddy-build
RUN xcaddy build --with github.com/caddy-dns/duckdns

FROM node:24-alpine AS backend-build
WORKDIR /src/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine AS frontend-build
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm ci
ARG VITE_SOCKET_SERVER_URL=""
ARG VITE_API_BASE_URL=""
ARG VITE_ERROR_REPORTING_URL=""
ENV VITE_SOCKET_SERVER_URL=${VITE_SOCKET_SERVER_URL} \
    VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_ERROR_REPORTING_URL=${VITE_ERROR_REPORTING_URL}
COPY frontend/ ./
RUN npm run build

FROM node:24-alpine AS runtime
RUN apk add --no-cache nginx redis coturn ca-certificates wget \
    && mkdir -p /caddy-data /caddy-config /config \
    && ln -sf /dev/stdout /var/log/nginx/access.log \
    && ln -sf /dev/stderr /var/log/nginx/error.log
WORKDIR /app
COPY --from=caddy-build /usr/bin/caddy /usr/bin/caddy
COPY --from=backend-build /src/backend /app/backend
COPY --from=frontend-build /src/frontend/dist /usr/share/nginx/html
COPY docker/web.nginx.conf /etc/nginx/http.d/default.conf
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Caddy keeps its state in these directories; docker-compose.yml mounts
# volumes over them so certificates survive a rebuild.
ENV XDG_DATA_HOME=/caddy-data \
    XDG_CONFIG_HOME=/caddy-config

EXPOSE 80 443 443/udp 8081
EXPOSE 3478 3478/udp
EXPOSE 49300-49340/udp

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

CMD ["/entrypoint.sh"]
