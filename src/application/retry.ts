import type { AppContext } from './context';

/**
 * Обёртка над очередью ретраев с контекстом для журнала ошибок.
 * При исчерпании ретраев очередь пишет ErrorLog (FAILED) — см. композицию в interface/app.
 */
export async function withRetries<T>(
  ctx: AppContext,
  context: string,
  payload: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  return ctx.retry.run(context, fn, {
    context,
    payloadJson: safeJson(payload),
    correlationId: ctx.correlationId,
  });
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '{}';
  } catch {
    return '{"error":"non-serializable"}';
  }
}
