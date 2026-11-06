import type { User } from '../domain/entities/index';
import { DomainError } from '../domain/errors';
import type { OneCClient, OneCMode } from '../domain/ports/onec';
import type { AppContext } from './context';
import { audit } from './audit';

export interface SettingsView {
  oneCMode: OneCMode;
  realConfigured: boolean;
  tokenConfigured: boolean;
  nodeEnv: string;
  corsOrigin: string;
}

export interface SettingsEnv {
  ONEC_MODE: OneCMode;
  ONEC_BASE_URL: string;
  ONEC_TOKEN: string;
  NODE_ENV: string;
  CORS_ORIGIN: string;
}

/** Текущие настройки (без секретов — только флаги их наличия). */
export function getSettings(env: SettingsViewInput): SettingsView {
  return {
    oneCMode: env.ONEC_MODE,
    realConfigured: Boolean(env.ONEC_BASE_URL && env.ONEC_TOKEN),
    tokenConfigured: Boolean(env.ONEC_TOKEN),
    nodeEnv: env.NODE_ENV,
    corsOrigin: env.CORS_ORIGIN,
  };
}

type SettingsViewInput = SettingsEnv;

/**
 * Переключение mock/real на лету (Settings → admin).
 * real доступен только при наличии ONEC_BASE_URL + ONEC_TOKEN в env.
 * Источник истины для запуска — env ONEC_MODE; переключение фиксируется в audit.
 */
export async function setOneCMode(
  ctx: AppContext,
  env: SettingsEnv,
  mode: OneCMode,
  factory: (mode: OneCMode) => OneCClient,
): Promise<SettingsView> {
  if (mode === 'real' && !(env.ONEC_BASE_URL && env.ONEC_TOKEN)) {
    throw new DomainError(
      'VALIDATION',
      'Переключение в real-режим недоступно: задайте ONEC_BASE_URL и ONEC_TOKEN в окружении',
    );
  }
  ctx.adapter.set(factory(mode));
  env.ONEC_MODE = mode;
  await audit(ctx, 'Settings', 'onec-mode', 'UPDATE', { oneCMode: mode });
  return getSettings(env);
}

export function listUsers(users: User[]): Array<Omit<User, 'passwordHash'>> {
  return users.map(({ passwordHash: _passwordHash, ...safe }) => safe);
}
