import type { AppContext } from './context';

/** Запись в audit-лог (правило 6: все действия пишутся в audit). */
export async function audit(
  ctx: AppContext,
  model: string,
  recordId: string,
  action: string,
  data: unknown,
): Promise<void> {
  await ctx.repos.audit.write({
    model,
    recordId,
    action,
    actorId: ctx.actor?.id ?? null,
    actorEmail: ctx.actor?.email ?? 'system',
    dataJson: safeJson(data),
    correlationId: ctx.correlationId ?? null,
  });
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '{}';
  } catch {
    return '{"error":"non-serializable"}';
  }
}
