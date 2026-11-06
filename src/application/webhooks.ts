import type { WebhookEvent, WebhookStatus } from '../domain/entities/index';
import { DomainError } from '../domain/errors';
import { requireIdempotencyKey } from '../domain/rules/idempotency';
import { toDomainError } from '../domain/rules/oneCErrors';
import type { AppContext } from './context';
import { audit } from './audit';
import { ingestLead } from './leads';
import { syncSchedule } from './schedule';

export interface WebhookInput {
  source?: string;
  eventType: string;
  payload: unknown;
  idempotencyKey: string;
}

export interface WebhookResult {
  eventId: string;
  status: WebhookStatus;
  duplicate: boolean;
  leadId?: string;
  error?: { code: string; message: string };
}

export function listWebhooks(ctx: AppContext, limit = 100): Promise<WebhookEvent[]> {
  return ctx.repos.webhooks.list(limit);
}

/**
 * Приём входящего события от 1С/ИИ-ассистента.
 * Правило 1: повтор по idempotencyKey → запись-лог со статусом DUPLICATE,
 * бизнес-сущности (Lead/Booking) НЕ создаются.
 */
export async function processWebhook(ctx: AppContext, input: WebhookInput): Promise<WebhookResult> {
  const key = requireIdempotencyKey(input.idempotencyKey);
  const payloadJson = JSON.stringify(input.payload ?? {});

  const seen = await ctx.repos.webhooks.countByKey(key);
  if (seen > 0) {
    const event = await ctx.repos.webhooks.create({
      source: input.source ?? 'unknown',
      eventType: input.eventType,
      payloadJson,
      receivedAt: ctx.clock(),
      status: 'DUPLICATE',
      idempotencyKey: key,
      correlationId: ctx.correlationId ?? null,
      processedAt: ctx.clock(),
    });
    return { eventId: event.id, status: 'DUPLICATE', duplicate: true };
  }

  const event = await ctx.repos.webhooks.create({
    source: input.source ?? 'unknown',
    eventType: input.eventType,
    payloadJson,
    receivedAt: ctx.clock(),
    status: 'RECEIVED',
    idempotencyKey: key,
    correlationId: ctx.correlationId ?? null,
    processedAt: null,
  });

  return dispatch(ctx, event, input.payload);
}

/** Повторная обработка события (Webhook Console «Повторить» / retry ошибки). */
export async function reprocessWebhookEvent(
  ctx: AppContext,
  eventId: string,
): Promise<WebhookResult> {
  const event = await ctx.repos.webhooks.byId(eventId);
  if (!event) {
    throw new DomainError('NOT_FOUND', `Событие ${eventId} не найдено`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(event.payloadJson);
  } catch {
    payload = {};
  }
  return dispatch(ctx, event, payload);
}

async function dispatch(
  ctx: AppContext,
  event: WebhookEvent,
  payload: unknown,
): Promise<WebhookResult> {
  try {
    const extra = await applyEvent(ctx, event, payload);
    const processed = await ctx.repos.webhooks.updateStatus(event.id, 'PROCESSED', ctx.clock());
    await audit(ctx, 'WebhookEvent', processed.id, 'UPDATE', {
      status: 'PROCESSED',
      eventType: event.eventType,
    });
    return { eventId: processed.id, status: processed.status, duplicate: false, ...extra };
  } catch (err) {
    const de = toDomainError(err);
    const failed = await ctx.repos.webhooks.updateStatus(event.id, 'FAILED', ctx.clock());
    await audit(ctx, 'WebhookEvent', failed.id, 'UPDATE', {
      status: 'FAILED',
      eventType: event.eventType,
      code: de.code,
    });
    return {
      eventId: failed.id,
      status: failed.status,
      duplicate: false,
      error: { code: de.code, message: de.message },
    };
  }
}

async function applyEvent(
  ctx: AppContext,
  event: WebhookEvent,
  payload: unknown,
): Promise<{ leadId?: string }> {
  const body = (payload ?? {}) as Record<string, unknown>;

  switch (event.eventType) {
    case 'lead.created': {
      const client = (body.client ?? {}) as { fullName?: string; phone?: string; email?: string };
      const res = await ingestLead(ctx, {
        idempotencyKey: event.idempotencyKey,
        source: typeof body.source === 'string' ? body.source : undefined,
        client: {
          fullName: String(client.fullName ?? ''),
          phone: String(client.phone ?? ''),
          email: client.email ? String(client.email) : undefined,
        },
        payload: body,
      });
      return { leadId: res.lead.id };
    }
    case 'schedule.updated': {
      await syncSchedule(ctx);
      return {};
    }
    case 'booking.confirmed':
    case 'booking.cancelled':
    case 'booking.rescheduled': {
      await applyBookingEvent(ctx, event.eventType, body);
      return {};
    }
    default:
      // неизвестный тип — принято и помечено PROCESSED (совместимость вперёд)
      return {};
  }
}

async function applyBookingEvent(
  ctx: AppContext,
  eventType: string,
  body: Record<string, unknown>,
): Promise<void> {
  const externalId = typeof body.externalId === 'string' ? body.externalId : '';
  if (!externalId) {
    throw new DomainError('VALIDATION', 'В payload события нет externalId');
  }
  const booking = await ctx.repos.bookings.byExternalId(externalId);
  if (!booking) {
    throw new DomainError('NOT_FOUND', `Запись ${externalId} не найдена в трекере`);
  }

  if (eventType === 'booking.cancelled') {
    await ctx.repos.bookings.update(booking.id, {
      status: 'CANCELLED',
      updatedAt: ctx.clock(),
    });
    if (booking.scheduleSlotId) {
      const slot = await ctx.repos.schedule.slotById(booking.scheduleSlotId);
      if (slot && slot.bookedCount > 0) {
        await ctx.repos.schedule.updateSlot(slot.id, {
          bookedCount: Math.max(0, slot.bookedCount - 1),
        });
      }
    }
    return;
  }

  if (eventType === 'booking.rescheduled') {
    const slotStart = body.slotStart ? new Date(String(body.slotStart)) : booking.slotStart;
    const slotEnd = body.slotEnd ? new Date(String(body.slotEnd)) : booking.slotEnd;
    await ctx.repos.bookings.update(booking.id, {
      status: 'RESCHEDULED',
      slotStart,
      slotEnd,
      updatedAt: ctx.clock(),
    });
    return;
  }

  // booking.confirmed
  await ctx.repos.bookings.update(booking.id, {
    status: 'CONFIRMED',
    errorCode: null,
    updatedAt: ctx.clock(),
  });
}
