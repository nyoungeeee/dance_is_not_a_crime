# syntax=docker/dockerfile:1
# NestJS + Prisma(SQLite) 서버가 /api와 정적 화면(dist/)을 함께 제공한다.
FROM node:22-bookworm-slim AS build
# better-sqlite3 prebuilt가 없는 플랫폼에서 소스 빌드용(런타임 이미지에는 포함하지 않음)
# openssl: Prisma가 마이그레이션 엔진 종류를 고를 때 필요
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json server/tsconfig.build.json server/prisma.config.ts ./
COPY server/prisma ./prisma
COPY server/src ./src
COPY server/test ./test
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production TZ=Asia/Seoul PORT=3000 DATA_DIR=/data BACKUP_DIR=/backups WEB_DIST=/app/dist
WORKDIR /app/server
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY server/package.json server/prisma.config.ts ./
COPY server/prisma ./prisma
COPY dist /app/dist
RUN mkdir -p /data /backups && chown -R node:node /data /backups
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# 시작할 때마다 DB 마이그레이션을 적용한다(이미 적용된 것은 건너뜀).
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node dist/src/main.js"]
