import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { Env } from '../config/env';
import { loadEnv } from '../config/env';
import { buildApp } from './app';

/** Минимальный загрузчик .env без внешних зависимостей (не перезаписывает env). */
function loadDotEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const env: Env = loadEnv();
  const app = await buildApp({ env });

  const close = async (signal: string) => {
    app.log.info({ signal }, 'остановка сервера');
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void close('SIGINT'));
  process.on('SIGTERM', () => void close('SIGTERM'));

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info({ port: env.PORT, oneCMode: env.ONEC_MODE }, 'Трекер интеграции запущен');
}

main().catch((err) => {
  console.error('Не удалось запустить сервер:', err);
  process.exit(1);
});
