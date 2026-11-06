import type { ErrorCode } from '../domain/errors';

/**
 * Политика журнала ошибок: в ErrorLog попадают только сбои
 * (1С/транспорт/внутренние), а не бизнес-отказы, показываемые пользователю
 * напрямую (нет мест, дубль, не тот статус и т.п.).
 */
const NON_LOGGED_CODES = new Set<ErrorCode>([
  'VALIDATION',
  'DUPLICATE',
  'NO_SEATS',
  'SLOT_TAKEN',
  'CLIENT_INACTIVE',
  'BOOKING_NOT_CONFIRMED',
  'BOOKING_NOT_FOUND',
  'SLOT_NOT_FOUND',
  'NOT_FOUND',
  'FORBIDDEN',
  'UNAUTHORIZED',
  'RATE_LIMITED',
  'CONFLICT',
]);

export function shouldLogErrorCode(code: ErrorCode): boolean {
  return !NON_LOGGED_CODES.has(code);
}
