import { describe, expect, it } from 'vitest';
import { evaluateIdempotency, requireIdempotencyKey } from '../../src/domain/rules/idempotency';
import { DomainError } from '../../src/domain/errors';

describe('правило идемпотентности', () => {
  it('повтор с тем же ключом → DUPLICATE', () => {
    expect(evaluateIdempotency('key-1', 'key-1')).toBe('DUPLICATE');
    expect(evaluateIdempotency('key-1', '  key-1  ')).toBe('DUPLICATE');
  });

  it('новый ключ → PROCEED', () => {
    expect(evaluateIdempotency('key-1', 'key-2')).toBe('PROCEED');
    expect(evaluateIdempotency(null, 'key-1')).toBe('PROCEED');
    expect(evaluateIdempotency(undefined, 'key-1')).toBe('PROCEED');
  });

  it('пустой ключ — ошибка валидации', () => {
    expect(() => requireIdempotencyKey('')).toThrow(DomainError);
    expect(() => requireIdempotencyKey('   ')).toThrow(DomainError);
    expect(() => requireIdempotencyKey(undefined)).toThrow(DomainError);
    expect(requireIdempotencyKey(' abc ')).toBe('abc');
  });
});
