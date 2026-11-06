import type { Booking, Client } from '../domain/entities/index';
import { DomainError } from '../domain/errors';
import {
  assertModifiable,
  checkBookingEligibility,
  releaseSeat,
  reserveSeat,
} from '../domain/rules/bookingRules';
import { requireIdempotencyKey } from '../domain/rules/idempotency';
import { toDomainError } from '../domain/rules/oneCErrors';
import type { AppContext } from './context';
import { audit } from './audit';
import { withRetries } from './retry';

export interface CreateBookingInput {
  clientId: string;
  slotId: string;
  idempotencyKey: string;
}

export interface BookingResult {
  booking: Booking;
  duplicate: boolean;
}

/**
 * Запись на занятие (use-case):
 * идемпотентность → проверка допустимости → подтверждение в 1С → слот.
 * Ошибки: NO_SEATS / SLOT_TAKEN / CLIENT_INACTIVE (бизнес-коды без ретраев).
 */
export async function createBooking(
  ctx: AppContext,
  input: CreateBookingInput,
): Promise<BookingResult> {
  const key = requireIdempotencyKey(input.idempotencyKey);

  const existing = await ctx.repos.bookings.byIdempotencyKey(key);
  if (existing) {
    return { booking: existing, duplicate: true };
  }

  const slot = await ctx.repos.schedule.slotById(input.slotId);
  if (!slot) {
    throw new DomainError('SLOT_NOT_FOUND', `Слот ${input.slotId} не найден`);
  }
  const client = await ctx.repos.clients.byId(input.clientId);
  if (!client) {
    throw new DomainError('NOT_FOUND', `Клиент ${input.clientId} не найден`);
  }

  const check = checkBookingEligibility({ slot, client, now: ctx.clock() });
  if (!check.ok) {
    throw new DomainError(check.code, check.message, { slotId: slot.id, clientId: client.id });
  }

  const booking = await ctx.repos.bookings.create({
    externalId: null,
    clientId: client.id,
    serviceId: slot.serviceId,
    specialistId: slot.specialistId,
    scheduleSlotId: slot.id,
    slotStart: slot.startAt,
    slotEnd: slot.endAt,
    status: 'PENDING',
    idempotencyKey: key,
    errorCode: null,
    createdAt: ctx.clock(),
    updatedAt: ctx.clock(),
  });
  await audit(ctx, 'Booking', booking.id, 'CREATE', {
    bookingId: booking.id,
    slotId: slot.id,
    clientId: client.id,
  });

  try {
    const res = await withRetries(ctx, 'booking.create', { bookingId: booking.id }, () =>
      ctx.adapter.get().createBooking({ booking, slot, client }),
    );
    const confirmed = await ctx.repos.bookings.update(booking.id, {
      status: 'CONFIRMED',
      externalId: res.externalId,
      errorCode: null,
      updatedAt: ctx.clock(),
    });
    const newSlot = reserveSeat(slot);
    await ctx.repos.schedule.updateSlot(slot.id, { bookedCount: newSlot.bookedCount });
    await audit(ctx, 'Booking', booking.id, 'UPDATE', {
      status: 'CONFIRMED',
      externalId: res.externalId,
      slotId: slot.id,
    });
    return { booking: confirmed, duplicate: false };
  } catch (err) {
    const de = toDomainError(err);
    await ctx.repos.bookings.update(booking.id, {
      errorCode: de.code,
      updatedAt: ctx.clock(),
    });
    await audit(ctx, 'Booking', booking.id, 'UPDATE', { status: 'PENDING', errorCode: de.code });
    throw de;
  }
}

/** Отмена записи: только CONFIRMED, освобождение места, отмена в 1С. */
export async function cancelBooking(ctx: AppContext, id: string): Promise<Booking> {
  const booking = await ctx.repos.bookings.byId(id);
  if (!booking) {
    throw new DomainError('BOOKING_NOT_FOUND', `Запись ${id} не найдена`);
  }
  assertModifiable(booking);

  if (booking.externalId) {
    const externalId = booking.externalId;
    await withRetries(ctx, 'booking.cancel', { bookingId: booking.id }, () =>
      ctx.adapter.get().cancelBooking(externalId),
    );
  }

  const updated = await ctx.repos.bookings.update(booking.id, {
    status: 'CANCELLED',
    errorCode: null,
    updatedAt: ctx.clock(),
  });

  if (booking.scheduleSlotId) {
    const slot = await ctx.repos.schedule.slotById(booking.scheduleSlotId);
    if (slot && slot.bookedCount > 0) {
      const freed = releaseSeat(slot);
      await ctx.repos.schedule.updateSlot(slot.id, { bookedCount: freed.bookedCount });
    }
  }

  await audit(ctx, 'Booking', booking.id, 'CANCEL', {
    externalId: booking.externalId,
    slotId: booking.scheduleSlotId,
  });
  return updated;
}

export interface RescheduleInput {
  targetSlotId: string;
  /** Для защиты от повторного переноса; по умолчанию детерминированный ключ. */
  idempotencyKey?: string;
}

/**
 * Перенос записи: только CONFIRMED; старому слоту освобождается место,
 * новому — резервируется; запись обновляется на месте (1С сохраняет свой ID).
 */
export async function rescheduleBooking(
  ctx: AppContext,
  id: string,
  input: RescheduleInput,
): Promise<Booking> {
  const booking = await ctx.repos.bookings.byId(id);
  if (!booking) {
    throw new DomainError('BOOKING_NOT_FOUND', `Запись ${id} не найдена`);
  }
  assertModifiable(booking);

  const target = await ctx.repos.schedule.slotById(input.targetSlotId);
  if (!target) {
    throw new DomainError('SLOT_NOT_FOUND', `Слот ${input.targetSlotId} не найден`);
  }
  const client: Client | null = await ctx.repos.clients.byId(booking.clientId);
  const check = checkBookingEligibility({ slot: target, client, now: ctx.clock() });
  if (!check.ok) {
    throw new DomainError(check.code, check.message, { slotId: target.id });
  }

  const key = input.idempotencyKey ?? `reschedule:${booking.id}:${target.id}`;
  const alreadyMoved = await ctx.repos.bookings.byIdempotencyKey(key);
  if (alreadyMoved && alreadyMoved.id !== booking.id) {
    return alreadyMoved;
  }

  const externalId = booking.externalId;
  if (externalId) {
    await withRetries(ctx, 'booking.reschedule', { bookingId: booking.id }, () =>
      ctx.adapter.get().rescheduleBooking(externalId, target),
    );
  }

  const updated = await ctx.repos.bookings.update(booking.id, {
    serviceId: target.serviceId,
    specialistId: target.specialistId,
    scheduleSlotId: target.id,
    slotStart: target.startAt,
    slotEnd: target.endAt,
    status: 'CONFIRMED',
    errorCode: null,
    updatedAt: ctx.clock(),
  });

  // освобождаем старое место, занимаем новое
  if (booking.scheduleSlotId && booking.scheduleSlotId !== target.id) {
    const oldSlot = await ctx.repos.schedule.slotById(booking.scheduleSlotId);
    if (oldSlot) {
      await ctx.repos.schedule.updateSlot(oldSlot.id, {
        bookedCount: Math.max(0, oldSlot.bookedCount - 1),
      });
    }
  }
  await ctx.repos.schedule.updateSlot(target.id, { bookedCount: reserveSeat(target).bookedCount });

  await audit(ctx, 'Booking', booking.id, 'RESCHEDULE', {
    from: booking.scheduleSlotId,
    to: target.id,
    slotStart: target.startAt,
  });
  return updated;
}

export function listBookings(ctx: AppContext, filter?: { status?: string }): Promise<Booking[]> {
  return ctx.repos.bookings.list(filter);
}
