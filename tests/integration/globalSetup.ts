import { execSync } from 'node:child_process';

/**
 * Глобальная настройка интеграционных тестов:
 * пересоздаёт тестовую SQLite-базу (prisma/test.db) и применяет сиды.
 */
export function setup(): void {
  const env = { ...process.env, DATABASE_URL: 'file:./test.db' };
  execSync('npx prisma db push --skip-generate --force-reset', { env, stdio: 'inherit' });
  execSync('npx tsx prisma/seed.ts', { env, stdio: 'inherit' });
}
