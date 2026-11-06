#!/bin/sh
# Точка входа контейнера: схема БД → сиды → сервер.
set -e

echo "[entrypoint] Применение схемы PostgreSQL..."
npx prisma db push --skip-generate --schema prisma/postgres/schema.prisma

echo "[entrypoint] Сиды (идемпотентно)..."
node dist/seed.js

echo "[entrypoint] Запуск сервера на порту ${PORT:-4000}..."
exec node dist/server.js
