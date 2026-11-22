# syntax=docker/dockerfile:1

# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
COPY tsconfig*.json prisma.config.ts ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---------- runtime ----------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl tini \
  && addgroup -S app && adduser -S app -G app \
  && mkdir -p /app/uploads && chown app:app /app/uploads

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/prisma ./prisma
COPY --chown=app:app package.json prisma.config.ts ./
COPY --chown=app:app src/views ./dist/views
# `npm run db:seed` (first super admin) runs from source via tsx and needs the permission list.
COPY --chown=app:app src/constants/permissions.ts ./src/constants/permissions.ts
COPY --chown=app:app docker/entrypoint.sh ./entrypoint.sh

USER app
EXPOSE 5007
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-5007}/api/v1/health || exit 1

# tini forwards SIGTERM so the app shuts down gracefully
ENTRYPOINT ["/sbin/tini", "--", "./entrypoint.sh"]
CMD ["node", "dist/server.js"]
