# syntax=docker/dockerfile:1

# --- Сборка ---------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY ui/package.json ui/package-lock.json ./ui/
RUN npm --prefix ui ci
COPY . .
# Клиент генерируется под PostgreSQL (docker-compose), локально — под SQLite
RUN npx prisma generate --schema prisma/postgres/schema.prisma
RUN npm run build

# --- Рантайм --------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=4000
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN PRISMA_SKIP_POSTINSTALL_GENERATE=1 npm ci --omit=dev
# Сгенерированный Prisma-клиент (PostgreSQL) из стадии сборки
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/ui/dist ./ui/dist
COPY docs ./docs
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 4000
ENTRYPOINT ["/entrypoint.sh"]
