/**
 * Доменные ошибки. Коды — внутренний словарь приложения
 * (маппинг из кодов 1С — в rules/oneCErrors.ts).
 */
export const ERROR_CODES = [
  'VALIDATION',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  // идемпотентность
  'DUPLICATE',
  // запись на занятие
  'NO_SEATS',
  'SLOT_TAKEN',
  'CLIENT_INACTIVE',
  'BOOKING_NOT_CONFIRMED',
  'BOOKING_NOT_FOUND',
  'SLOT_NOT_FOUND',
  // 1С / инфраструктура
  'ONEC_ERROR',
  'ONEC_UNAVAILABLE',
  'ONEC_UNAUTHORIZED',
  'RATE_LIMITED',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class DomainError extends Error {
  override readonly name = 'DomainError';

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError;
}

/** Ошибка, пришедшая от адаптера 1С (rawCode — оригинальный код/статус 1С). */
export class OneCError extends Error {
  override readonly name = 'OneCError';

  constructor(
    readonly rawCode: string,
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
  }
}

export function isOneCError(err: unknown): err is OneCError {
  return err instanceof OneCError;
}
