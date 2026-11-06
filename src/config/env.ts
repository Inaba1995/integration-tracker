import { z } from 'zod';

/**
 * Конфигурация приложения. Все секреты — только из переменных окружения.
 * Значения по умолчанию предназначены для локальной разработки (mock-режим).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1).default('file:./dev.db'),

  ONEC_MODE: z.enum(['mock', 'real']).default('mock'),
  ONEC_BASE_URL: z.string().default(''),
  ONEC_TOKEN: z.string().default(''),
  ONEC_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),

  JWT_SECRET: z.string().min(8).default('dev-jwt-secret-change-me'),
  WEBHOOK_SECRET: z.string().min(8).default('dev-webhook-secret-change'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Некорректные переменные окружения: ${issues}`);
  }
  const env = parsed.data;
  if (env.ONEC_MODE === 'real' && (!env.ONEC_BASE_URL || !env.ONEC_TOKEN)) {
    throw new Error('ONEC_MODE=real требует ONEC_BASE_URL и ONEC_TOKEN');
  }
  return env;
}
