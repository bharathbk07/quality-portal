FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
COPY backend/package.json ./backend/package.json
RUN npm ci
FROM deps AS frontend-build
COPY . .
RUN NEXT_TELEMETRY_DISABLED=1 npm run build:frontend
FROM node:24-bookworm-slim AS frontend
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 CONFIG_FILE=/app/deployment/configuration.ini
COPY --chown=node:node deployment/configuration.ini ./deployment/configuration.ini
COPY --from=frontend-build --chown=node:node /app/frontend/.next/standalone ./
COPY --from=frontend-build --chown=node:node /app/frontend/.next/static ./frontend/.next/static
COPY --from=frontend-build --chown=node:node /app/frontend/public ./frontend/public
USER node
EXPOSE 3000
CMD ["node","frontend/server.js"]
FROM node:24-bookworm-slim AS service
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node deployment/configuration.ini ./deployment/configuration.ini
COPY --chown=node:node deployment/infrastructure/postgres ./deployment/infrastructure/postgres
COPY --chown=node:node backend ./backend
COPY --chown=node:node middleware ./middleware
COPY --chown=node:node prompts ./prompts
USER node
ENV NODE_ENV=production
CMD ["node","middleware/bff/index.mjs"]
