import type { Logger } from 'pino';

/**
 * Минимальный интерфейс логгера адаптера:
 * совместим и с pino-логгером, и с FastifyBaseLogger.
 */
export type MinimalLogger = Pick<Logger, 'info' | 'warn' | 'error' | 'debug'>;
