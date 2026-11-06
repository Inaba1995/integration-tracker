/**
 * Порт очереди ретраев (реализация — infrastructure/queue/retryQueue).
 */
export interface RetryMeta {
  /** Контекст операции для журнала ошибок (lead, booking.create, ...). */
  context?: string;
  payloadJson?: string;
  correlationId?: string;
}

export interface RetryRunner {
  run<T>(name: string, fn: () => Promise<T>, meta?: RetryMeta): Promise<T>;
}
