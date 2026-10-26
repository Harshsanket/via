# Build stage: devDependencies are needed here for tsc.
FROM node:24-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

# Runtime stage: compiled output and production dependencies only, so the
# TypeScript sources, tsc and the dev tooling never ship.
FROM node:24-alpine AS runtime

WORKDIR /app

# Production keeps pino-pretty and Express' stack-trace error output out.
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# Run as the unprivileged user shipped with the image
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/v1/health || exit 1

CMD ["node", "dist/src/server.js"]
