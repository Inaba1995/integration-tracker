import type { DomainError } from '../../domain/errors';
import type { RetryMeta } from '../../domain/ports/retry';
import {
  DEFAULT_RETRY_POLICY,
  exhaustedErrorStatus,
  isRetryableErrorCode,
  nextRetryDelayMs,
  type RetryPolicy,
} from '../../domain/rules/retryPolicy';
import { toDomainError } from '../../domain/rules/oneCErrors';

/**
 * Очередь ретраев: экспоненциальная задержка, максимум 3 повтора,
 * затем onExhausted (в приложении — запись в ErrorLog со статусом FAILED).
 */

export type SleepFn = (ms: number) => Promise<void>;

export interface ExhaustedInfo {
  /** Имя операции (контекст для ErrorLog). */
  name: string;
  error: DomainError;
  /** Сколько ретраев фактически выполнено. */
  retries: number;
  meta?: RetryMeta;
}

export interface RetryQueueOptions {
  policy?: RetryPolicy;
  sleep?: SleepFn;
  onExhausted?: (info: ExhaustedInfo) => void | Promise<void>;
}

export class RetryQueue {
  private readonly policy: RetryPolicy;
  private readonly sleep: SleepFn;
  private readonly onExhausted: ((info: ExhaustedInfo) => void | Promise<void>) | undefined;

  constructor(options: RetryQueueOptions = {}) {
    this.policy = options.policy ?? DEFAULT_RETRY_POLICY;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.onExhausted = options.onExhausted;
  }

  /**
   * Выполняет fn с ретраями. Детерминированные ошибки (NO_SEATS, DUPLICATE, ...)
   * не ретраятся — сразу считаются исчерпанными.
   */
  async run<T>(name: string, fn: () => Promise<T>, meta?: RetryMeta): Promise<T> {
    let retriesDone = 0;

    for (;;) {
      try {
        return await fn();
      } catch (err) {
        const domainError = toDomainError(err);
        const retryable = isRetryableErrorCode(domainError.code);
        const delay = retryable ? nextRetryDelayMs(retriesDone, this.policy) : null;

        if (delay === null) {
          await this.onExhausted?.({
            name,
            error: domainError,
            retries: retriesDone,
            meta,
          });
          throw domainError;
        }

        retriesDone += 1;
        await this.sleep(delay);
      }
    }
  }

  get exhaustedStatus(): 'FAILED' {
    return exhaustedErrorStatus();
  }
}
