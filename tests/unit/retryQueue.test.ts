import { describe, expect, it } from 'vitest';
import { RetryQueue, type ExhaustedInfo } from '../../src/infrastructure/queue/retryQueue';
import { DomainError, OneCError } from '../../src/domain/errors';

describe('RetryQueue', () => {
  it('ретраит с экспоненциальной задержкой и возвращает успех', async () => {
    const delays: number[] = [];
    const queue = new RetryQueue({ sleep: async (ms) => void delays.push(ms) });
    let attempts = 0;

    const result = await queue.run('op', async () => {
      attempts += 1;
      if (attempts < 3) throw new OneCError('E_TIMEOUT', 'временный сбой');
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
    expect(delays).toEqual([1000, 2000]);
  });

  it('после 3 ретраев — onExhausted со статусом FAILED и ошибка пробрасывается', async () => {
    const exhausted: ExhaustedInfo[] = [];
    const queue = new RetryQueue({
      sleep: async () => {},
      onExhausted: (info) => void exhausted.push(info),
    });
    let attempts = 0;

    await expect(
      queue.run('webhook.process', async () => {
        attempts += 1;
        throw new OneCError('HTTP_500', '1С недоступна');
      }),
    ).rejects.toMatchObject({ code: 'ONEC_UNAVAILABLE' });

    expect(attempts).toBe(4);
    expect(queue.exhaustedStatus).toBe('FAILED');
    expect(exhausted).toHaveLength(1);
    expect(exhausted[0]).toMatchObject({
      name: 'webhook.process',
      retries: 3,
      error: expect.objectContaining({ code: 'ONEC_UNAVAILABLE' }),
    });
  });

  it('детерминированные ошибки (NO_SEATS) не ретраятся — сразу exhausted', async () => {
    const exhausted: ExhaustedInfo[] = [];
    const queue = new RetryQueue({
      sleep: async () => {
        throw new Error('sleep не должен вызываться');
      },
      onExhausted: (info) => void exhausted.push(info),
    });
    let attempts = 0;

    await expect(
      queue.run('booking.create', async () => {
        attempts += 1;
        throw new DomainError('NO_SEATS', 'нет мест');
      }),
    ).rejects.toMatchObject({ code: 'NO_SEATS' });

    expect(attempts).toBe(1);
    expect(exhausted[0]).toMatchObject({ retries: 0, error: { code: 'NO_SEATS' } });
  });

  it('неизвестная ошибка → INTERNAL и ретраится', async () => {
    const queue = new RetryQueue({ sleep: async () => {} });
    let attempts = 0;
    await expect(
      queue.run('x', async () => {
        attempts += 1;
        throw new Error('что-то сломалось');
      }),
    ).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(attempts).toBe(4);
  });
});
