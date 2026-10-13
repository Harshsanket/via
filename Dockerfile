# Use the official Node 24 Alpine image as the base
FROM node:24-alpine

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install all dependencies (devDependencies included: the build needs tsc)
RUN npm ci

# Copy everything into docker
COPY . .

# Build once (tsc)
RUN npm run build

# Production must be set after the build: with NODE_ENV=production before
# `npm ci`, devDependencies would be skipped and the build would fail. It also
# keeps pino-pretty and Express' stack-trace error output out of production.
ENV NODE_ENV=production

# Set port
ENV PORT=3000

# Run as the unprivileged user shipped with the image
USER node

# Expose port
EXPOSE 3000

CMD ["node","dist/src/server.js"]
