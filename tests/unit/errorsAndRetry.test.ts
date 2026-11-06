import { describe, expect, it } from 'vitest';
import { mapOneCError } from '../../src/domain/rules/oneCErrors';
import {
  DEFAULT_RETRY_POLICY,
  exhaustedErrorStatus,
  nextRetryDelayMs,
  shouldRetry,
} from '../../src/domain/rules/retryPolicy';

describe('маппинг кодов ошибок 1С', () => {
  it('латинские коды', () => {
    expect(mapOneCError('E_NO_SEATS')).toEqual({ code: 'NO_SEATS', known: true });
    expect(mapOneCError('E_SLOT_BUSY')).toEqual({ code: 'SLOT_TAKEN', known: true });
    expect(mapOneCError('E_CLIENT_INACTIVE')).toEqual({ code: 'CLIENT_INACTIVE', known: true });
    expect(mapOneCError('E_AUTH')).toEqual({ code: 'ONEC_UNAUTHORIZED', known: true });
    expect(mapOneCError('E_TIMEOUT')).toEqual({ code: 'ONEC_UNAVAILABLE', known: true });
  });

  it('кириллические коды 1С', () => {
    expect(mapOneCError('НетМест')).toEqual({ code: 'NO_SEATS', known: true });
    expect(mapOneCError('КлиентНеАктивен')).toEqual({ code: 'CLIENT_INACTIVE', known: true });
    expect(mapOneCError('Дублирование')).toEqual({ code: 'DUPLICATE', known: true });
  });

  it('неизвестный код → ONEC_ERROR (known: false)', () => {
    expect(mapOneCError('Что-то странное')).toEqual({ code: 'ONEC_ERROR', known: false });
  });
});

describe('политика ретраев (max 3, экспоненциальная задержка)', () => {
  it('экспоненциальные задержки 1s, 2s, 4s', () => {
    expect(nextRetryDelayMs(0)).toBe(1000);
    expect(nextRetryDelayMs(1)).toBe(2000);
    expect(nextRetryDelayMs(2)).toBe(4000);
  });

  it('после 3 ретраев — лимит исчерпан (null, shouldRetry=false)', () => {
    expect(nextRetryDelayMs(3)).toBeNull();
    expect(shouldRetry(2)).toBe(true);
    expect(shouldRetry(3)).toBe(false);
  });

  it('лимит по умолчанию равен 3', () => {
    expect(DEFAULT_RETRY_POLICY.maxRetries).toBe(3);
  });

  it('после исчерпания ретраев статус ErrorLog = FAILED', () => {
    expect(exhaustedErrorStatus()).toBe('FAILED');
  });

  it('отрицательный счётчик — ошибка', () => {
    expect(() => nextRetryDelayMs(-1)).toThrow(RangeError);
  });
});
