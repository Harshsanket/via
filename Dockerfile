# syntax=docker/dockerfile:1.7

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
RUN apk add --no-cache nginx redis coturn openssl
WORKDIR /app
COPY --from=backend-build /src/backend /app/backend
COPY --from=frontend-build /src/frontend/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/http.d/default.conf
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 80
EXPOSE 3478/tcp 3478/udp
EXPOSE 49160-49200/udp
CMD ["/entrypoint.sh"]
