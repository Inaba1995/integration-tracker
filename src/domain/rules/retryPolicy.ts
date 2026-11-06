/**
 * Правило 4: ретраи с экспоненциальной задержкой, максимум 3 попытки,
 * затем запись в ErrorLog со статусом FAILED.
 */
import type { ErrorCode } from '../errors';

export interface RetryPolicy {
  /** Максимум повторных попыток после первой (max 3 по ТЗ). */
  maxRetries: number;
  baseDelayMs: number;
  factor: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 1000,
  factor: 2,
  maxDelayMs: 60_000,
};

/**
 * Детерминированные ошибки — повторы бессмысленны:
 * ретраи прекращаются сразу, ошибка сразу уходит в ErrorLog (FAILED).
 */
const NON_RETRYABLE_CODES = new Set<ErrorCode>([
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
  'ONEC_UNAUTHORIZED',
  'CONFLICT',
]);

export function isRetryableErrorCode(code: ErrorCode): boolean {
  return !NON_RETRYABLE_CODES.has(code);
}

/**
 * Задержка перед следующей попыткой.
 * @param retriesDone сколько ретраев уже выполнено (0 = перед первым повтором)
 * @returns миллисекунды или null, если лимит исчерпан
 */
export function nextRetryDelayMs(
  retriesDone: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): number | null {
  if (retriesDone < 0) {
    throw new RangeError('retriesDone не может быть отрицательным');
  }
  if (retriesDone >= policy.maxRetries) {
    return null;
  }
  const delay = policy.baseDelayMs * Math.pow(policy.factor, retriesDone);
  return Math.min(delay, policy.maxDelayMs);
}

export function shouldRetry(
  retriesDone: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): boolean {
  return nextRetryDelayMs(retriesDone, policy) !== null;
}

/** Статус ErrorLog после исчерпания ретраев. */
export function exhaustedErrorStatus(): 'FAILED' {
  return 'FAILED';
}
