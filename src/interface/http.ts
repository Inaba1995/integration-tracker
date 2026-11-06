import { z } from 'zod';
import { DomainError, type ErrorCode } from '../domain/errors';

/**
 * HTTP-хелперы интерфейсного слоя: маппинг кодов домена на статусы,
 * валидация входящих payload через zod, роли и заголовки.
 */

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  DUPLICATE: 409,
  NO_SEATS: 409,
  SLOT_TAKEN: 409,
  CLIENT_INACTIVE: 409,
  BOOKING_NOT_CONFIRMED: 409,
  BOOKING_NOT_FOUND: 404,
  SLOT_NOT_FOUND: 404,
  RATE_LIMITED: 429,
  ONEC_ERROR: 502,
  ONEC_UNAVAILABLE: 503,
  ONEC_UNAUTHORIZED: 502,
  INTERNAL: 500,
};

export function statusForErrorCode(code: ErrorCode): number {
  return STATUS_BY_CODE[code] ?? 500;
}

export function parseInput<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new DomainError(
      'VALIDATION',
      'Ошибка валидации запроса',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

export function isZodError(err: unknown): err is z.ZodError {
  return err instanceof z.ZodError;
}
