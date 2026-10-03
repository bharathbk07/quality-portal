FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
FROM deps AS frontend-build
COPY . .
RUN NEXT_TELEMETRY_DISABLED=1 npx next build --webpack
FROM node:24-bookworm-slim AS frontend
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --chown=node:node configuration.ini ./configuration.ini
COPY --from=frontend-build --chown=node:node /app/.next/standalone ./
COPY --from=frontend-build --chown=node:node /app/.next/static ./.next/static
COPY --from=frontend-build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node","server.js"]
FROM node:24-bookworm-slim AS service
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY services/package.json services/package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node configuration.ini ./configuration.ini
COPY --chown=node:node services ./services
COPY --chown=node:node lib/quality.ts ./lib/quality.ts
USER node
ENV NODE_ENV=production
CMD ["node","services/bff/index.mjs"]
