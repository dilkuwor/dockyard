# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-bookworm-slim AS server
WORKDIR /server
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
# Docker CLI + compose plugin; the engine itself is the host's, via the mounted socket.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PUBLIC_DIR=/app/public ASSETS_DIR=/app/assets
COPY --from=server /server/package.json ./
COPY --from=server /server/node_modules ./node_modules
COPY --from=server /server/dist ./dist
COPY --from=server /server/assets ./assets
COPY --from=web /web/dist ./public

VOLUME /data
EXPOSE 3000
# Traefik won't route to the container until the first check passes, so probe quickly during startup.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=2s CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "dist/index.js"]
