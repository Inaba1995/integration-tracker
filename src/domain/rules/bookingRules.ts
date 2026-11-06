import { DomainError } from '../errors';
import type { Booking, ScheduleSlot } from '../entities/index';

/**
 * Правила записи на занятия, переноса и отмены.
 * Все функции чистые — тестируются без БД и 1С.
 */

export type BookingCheckCode = 'NO_SEATS' | 'SLOT_TAKEN' | 'CLIENT_INACTIVE';

export type BookingCheckResult =
  { ok: true } | { ok: false; code: BookingCheckCode; message: string };

export interface BookingEligibilityInput {
  slot: Pick<ScheduleSlot, 'startAt' | 'capacity' | 'bookedCount'> | null;
  client: { active: boolean } | null;
  now: Date;
}

/**
 * Проверка допустимости записи:
 * - активность клиента → CLIENT_INACTIVE
 * - существование и доступность слота (в будущем) → SLOT_TAKEN
 * - свободные места (capacity > bookedCount) → NO_SEATS
 */
export function checkBookingEligibility(input: BookingEligibilityInput): BookingCheckResult {
  const { slot, client, now } = input;

  if (!client || !client.active) {
    return { ok: false, code: 'CLIENT_INACTIVE', message: 'Клиент неактивен или не найден' };
  }
  if (!slot) {
    return { ok: false, code: 'SLOT_TAKEN', message: 'Слот не найден или недоступен' };
  }
  if (slot.startAt.getTime() <= now.getTime()) {
    return { ok: false, code: 'SLOT_TAKEN', message: 'Слот уже начался или прошёл' };
  }
  if (slot.bookedCount >= slot.capacity) {
    return { ok: false, code: 'NO_SEATS', message: 'Нет свободных мест' };
  }
  return { ok: true };
}

/** Занимает место в слоте (иммутабельно). Бросает NO_SEATS при переполнении. */
export function reserveSeat(slot: ScheduleSlot): ScheduleSlot {
  if (slot.bookedCount >= slot.capacity) {
    throw new DomainError('NO_SEATS', 'Нет свободных мест');
  }
  return { ...slot, bookedCount: slot.bookedCount + 1 };
}

/** Освобождает место при отмене (не уходит ниже нуля). */
export function releaseSeat(slot: ScheduleSlot): ScheduleSlot {
  return { ...slot, bookedCount: Math.max(0, slot.bookedCount - 1) };
}

/** Перенос/отмена разрешены только для CONFIRMED записей. */
export function assertModifiable(booking: Pick<Booking, 'status'>): void {
  if (booking.status !== 'CONFIRMED') {
    throw new DomainError(
      'BOOKING_NOT_CONFIRMED',
      `Операция доступна только для записи в статусе CONFIRMED (сейчас: ${booking.status})`,
    );
  }
}

export function canModify(booking: Pick<Booking, 'status'>): boolean {
  return booking.status === 'CONFIRMED';
}
