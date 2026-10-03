FROM node:20-bullseye-slim AS builder

WORKDIR /app

# Install dependencies for building better-sqlite3 natively on Linux
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./

# Install with optimizations for faster npm ci
RUN npm ci --prefer-offline --no-audit --progress=false

COPY . .

# Build Next.js application
RUN npm run build

# --- Production Runtime Stage ---
FROM node:20-bullseye-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy standalone output from builder (doesn't need build tools)
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/CHANGELOG.md ./CHANGELOG.md

# Create data and cache directories writable by node user
RUN mkdir -p /app/data /app/.next/cache && chown -R node:node /app/data /app/.next

USER node

EXPOSE 3000

# Start standalone server
CMD ["node", "server.js"]
