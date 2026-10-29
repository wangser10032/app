FROM node:22-bookworm-slim AS frontend
WORKDIR /build
COPY web/package*.json ./web/
COPY admin/package*.json ./admin/
RUN cd web && npm ci --no-audit --no-fund
RUN cd admin && npm ci --no-audit --no-fund
COPY web ./web
COPY admin ./admin
RUN cd web && npm run build
RUN cd admin && npm run build

FROM node:22-bookworm-slim AS dependencies
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production TZ=Asia/Shanghai PORT=8080 GATEWAY_PORT=3128 DB_PATH=/app/server/data/resihub.db
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tzdata && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY --from=dependencies --chown=node:node /app/server/node_modules ./node_modules
COPY --chown=node:node server/package.json ./package.json
COPY --chown=node:node server/src ./src
COPY --chown=node:node server/scripts ./scripts
COPY --from=frontend --chown=node:node /build/web/dist /app/web/dist
COPY --from=frontend --chown=node:node /build/admin/dist /app/admin/dist
RUN mkdir -p /app/server/data && chown node:node /app/server/data
USER node
EXPOSE 8080 3128
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
