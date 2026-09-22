FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY web/frontend/package.json web/frontend/package-lock.json ./web/frontend/
RUN npm ci --prefix web/frontend
COPY packages/core/src ./packages/core/src
COPY web/frontend ./web/frontend
RUN bash web/frontend/scripts/fetch-zipformer-assets.sh \
    && npm run build --prefix web/frontend \
    && npm run build:server --prefix web/frontend

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=5000
WORKDIR /app
COPY web/frontend/package.json web/frontend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build --chown=node:node /app/web/frontend/dist ./dist
COPY --from=build --chown=node:node /app/web/frontend/dist-server ./dist-server
COPY LICENSE NOTICE.md app.json ./
COPY licenses ./licenses
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1));"
CMD ["node", "dist-server/index.mjs"]
