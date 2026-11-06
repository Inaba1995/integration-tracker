import { DomainError } from '../errors';

/**
 * Правило 1 (идемпотентность): любая входящая заявка/запись/событие
 * имеет idempotencyKey. Провтор с тем же ключом → DUPLICATE,
 * без создания новой сущности.
 */

export type IdempotencyOutcome = 'PROCEED' | 'DUPLICATE';

export function evaluateIdempotency(
  existingKey: string | null | undefined,
  incomingKey: string,
): IdempotencyOutcome {
  if (existingKey && existingKey === incomingKey.trim()) {
    return 'DUPLICATE';
  }
  return 'PROCEED';
}

/** Ключ обязателен и непустой — иначе ошибка валидации. */
export function requireIdempotencyKey(key: string | null | undefined): string {
  const normalized = key?.trim();
  if (!normalized) {
    throw new DomainError('VALIDATION', 'idempotencyKey обязателен');
  }
  return normalized;
}
