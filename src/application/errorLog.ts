import type { ErrorLogEntry } from '../domain/entities/index';
import { DomainError } from '../domain/errors';
import { toDomainError } from '../domain/rules/oneCErrors';
import type { AppContext } from './context';
import { audit } from './audit';
import { withRetries } from './retry';
import { syncSchedule } from './schedule';
import { reprocessWebhookEvent } from './webhooks';

export function listErrors(
  ctx: AppContext,
  filter?: { status?: string; context?: string },
): Promise<ErrorLogEntry[]> {
  return ctx.repos.errors.list(filter);
}

/**
 * Повтор обработки ошибки: увеличивает retryCount, переводит в RETRYING,
 * выполняет повтор по контексту; успех → RESOLVED, неудача → FAILED.
 * Ретраи внутри повтора — те же max 3 с экспоненциальной задержкой.
 */
export async function retryError(ctx: AppContext, id: string): Promise<ErrorLogEntry> {
  const entry = await ctx.repos.errors.byId(id);
  if (!entry) {
    throw new DomainError('NOT_FOUND', `Ошибка ${id} не найдена`);
  }

  const payload = safeParse(entry.payloadJson);
  await ctx.repos.errors.update(id, {
    status: 'RETRYING',
    retryCount: entry.retryCount + 1,
  });
  await audit(ctx, 'ErrorLog', id, 'RETRY', {
    context: entry.context,
    attempt: entry.retryCount + 1,
  });

  try {
    await replay(ctx, entry, payload);
    const resolved = await ctx.repos.errors.update(id, {
      status: 'RESOLVED',
    });
    await audit(ctx, 'ErrorLog', id, 'UPDATE', { status: 'RESOLVED' });
    return resolved;
  } catch (err) {
    const de = toDomainError(err);
    await ctx.repos.errors.update(id, {
      status: 'FAILED',
      message: `${entry.message} | повтор: ${de.message}`,
    });
    await audit(ctx, 'ErrorLog', id, 'UPDATE', { status: 'FAILED', code: de.code });
    throw de;
  }
}

async function replay(ctx: AppContext, entry: ErrorLogEntry, payload: Record<string, unknown>) {
  switch (entry.context) {
    case 'lead.send': {
      const leadId = String(payload.leadId ?? '');
      const lead = leadId ? await ctx.repos.leads.byId(leadId) : null;
      if (!lead) {
        throw new DomainError('NOT_FOUND', `Заявка ${leadId} не найдена для повтора`);
      }
      if (lead.status === 'SENT_TO_1C') return;
      const client = lead.clientId ? await ctx.repos.clients.byId(lead.clientId) : null;
      const res = await withRetries(ctx, 'lead.send', { leadId: lead.id }, () =>
        ctx.adapter.get().sendLead({ lead, client }),
      );
      await ctx.repos.leads.update(lead.id, {
        status: 'SENT_TO_1C',
        externalId: res.externalId,
        errorCode: null,
        errorMessage: null,
      });
      return;
    }
    case 'schedule.sync':
    case 'schedule.updated': {
      await syncSchedule(ctx);
      return;
    }
    case 'webhook': {
      const eventId = String(payload.eventId ?? entry.correlationId ?? '');
      const result = await reprocessWebhookEvent(ctx, eventId);
      if (result.status !== 'PROCESSED') {
        throw new DomainError(
          (result.error?.code as never) ?? 'ONEC_ERROR',
          result.error?.message ?? `Событие не обработано: ${result.status}`,
        );
      }
      return;
    }
    default:
      throw new DomainError(
        'VALIDATION',
        `Повтор для контекста "${entry.context}" не поддерживается`,
      );
  }
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json || '{}');
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
