import type { MinimalLogger } from '../../domain/ports/logger';
import type { Env } from '../../config/env';
import type { OneCClient } from '../../domain/ports/onec';
import { MockOneCClient } from './MockOneCClient';
import { RealOneCClient } from './RealOneCClient';

/**
 * Фабрика адаптера 1С. Режим определяется только env ONEC_MODE (default: mock).
 * Реальные вызовы к 1С по умолчанию не выполняются.
 */
export function createOneCClient(env: Env, logger?: MinimalLogger): OneCClient {
  if (env.ONEC_MODE === 'real') {
    return new RealOneCClient({
      baseUrl: env.ONEC_BASE_URL,
      token: env.ONEC_TOKEN,
      timeoutMs: env.ONEC_TIMEOUT_MS,
      logger,
    });
  }
  return new MockOneCClient();
}
