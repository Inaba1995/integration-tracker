#!/bin/sh
# Точка входа контейнера: схема БД → сиды → сервер.
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "[entrypoint] ОШИБКА: не задана переменная DATABASE_URL."
  echo "[entrypoint] В Railway добавьте базу: + New → Database → PostgreSQL"
  echo "[entrypoint] (Railway сам подставит DATABASE_URL в этот сервис) и выполните Redeploy."
  exit 1
fi

case "$DATABASE_URL" in
  postgres://*|postgresql://*) ;;
  *)
    echo "[entrypoint] ОШИБКА: DATABASE_URL должен начинаться с postgresql:// (получено: ${DATABASE_URL%%:*}://...)"
    exit 1
    ;;
esac

echo "[entrypoint] Применение схемы PostgreSQL..."
npx prisma db push --skip-generate --schema prisma/postgres/schema.prisma

echo "[entrypoint] Сиды (идемпотентно)..."
node dist/seed.js

echo "[entrypoint] Запуск сервера на порту ${PORT:-4000}..."
exec node dist/server.js
