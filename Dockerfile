# Use the official Node 24 Alpine image as the base
FROM node:24-alpine

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install app dependency
RUN npm ci

# Copy everything into docker
COPY . .

# Build once
RUN npm run build

# Set port
ENV PORT=3000

# Expose port
EXPOSE 3000

CMD ["node","dist/src/server.js"]