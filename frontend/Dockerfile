# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

ARG VITE_SOCKET_SERVER_URL=""
ARG VITE_API_BASE_URL=""
ARG VITE_ERROR_REPORTING_URL=""
ARG VITE_MAX_RECOVERY_ATTEMPTS=""

ENV VITE_SOCKET_SERVER_URL=${VITE_SOCKET_SERVER_URL} \
    VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_ERROR_REPORTING_URL=${VITE_ERROR_REPORTING_URL} \
    VITE_MAX_RECOVERY_ATTEMPTS=${VITE_MAX_RECOVERY_ATTEMPTS}

COPY . .

RUN npm run build

FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
