import { describe, expect, it } from 'vitest';
import {
  assertModifiable,
  canModify,
  checkBookingEligibility,
  releaseSeat,
  reserveSeat,
} from '../../src/domain/rules/bookingRules';
import { DomainError } from '../../src/domain/errors';
import type { ScheduleSlot } from '../../src/domain/entities/index';

const NOW = new Date('2026-11-10T10:00:00Z');
const future = new Date('2026-11-10T18:00:00Z');

function slot(partial: Partial<ScheduleSlot> = {}): ScheduleSlot {
  return {
    id: 'slot-1',
    serviceId: 'SVC_PILATES_1',
    specialistId: 'SPC_1',
    startAt: future,
    endAt: new Date('2026-11-10T19:00:00Z'),
    capacity: 2,
    bookedCount: 1,
    syncedAt: NOW,
    ...partial,
  };
}

describe('проверка допустимости записи на занятие', () => {
  it('OK: активный клиент, будущий слот, есть места', () => {
    expect(checkBookingEligibility({ slot: slot(), client: { active: true }, now: NOW })).toEqual({
      ok: true,
    });
  });

  it('CLIENT_INACTIVE: клиент неактивен или не найден', () => {
    const inactive = checkBookingEligibility({
      slot: slot(),
      client: { active: false },
      now: NOW,
    });
    expect(inactive).toMatchObject({ ok: false, code: 'CLIENT_INACTIVE' });

    const missing = checkBookingEligibility({ slot: slot(), client: null, now: NOW });
    expect(missing).toMatchObject({ ok: false, code: 'CLIENT_INACTIVE' });
  });

  it('SLOT_TAKEN: слот не найден или уже прошёл', () => {
    expect(
      checkBookingEligibility({ slot: null, client: { active: true }, now: NOW }),
    ).toMatchObject({ ok: false, code: 'SLOT_TAKEN' });

    const past = checkBookingEligibility({
      slot: slot({ startAt: new Date('2026-11-10T09:00:00Z') }),
      client: { active: true },
      now: NOW,
    });
    expect(past).toMatchObject({ ok: false, code: 'SLOT_TAKEN' });
  });

  it('NO_SEATS: bookedCount >= capacity', () => {
    const full = checkBookingEligibility({
      slot: slot({ bookedCount: 2, capacity: 2 }),
      client: { active: true },
      now: NOW,
    });
    expect(full).toMatchObject({ ok: false, code: 'NO_SEATS' });
  });

  it('CLIENT_INACTIVE приоритетнее ошибок слота', () => {
    const res = checkBookingEligibility({ slot: null, client: { active: false }, now: NOW });
    expect(res).toMatchObject({ code: 'CLIENT_INACTIVE' });
  });
});

describe('места в слоте', () => {
  it('reserveSeat увеличивает bookedCount', () => {
    expect(reserveSeat(slot()).bookedCount).toBe(2);
  });

  it('reserveSeat при переполнении бросает NO_SEATS', () => {
    expect(() => reserveSeat(slot({ bookedCount: 2 }))).toThrow(
      expect.objectContaining({ code: 'NO_SEATS' }) as unknown as Error,
    );
  });

  it('releaseSeat освобождает место и не уходит ниже нуля', () => {
    expect(releaseSeat(slot({ bookedCount: 2 })).bookedCount).toBe(1);
    expect(releaseSeat(slot({ bookedCount: 0 })).bookedCount).toBe(0);
  });
});

describe('перенос и отмена', () => {
  it('разрешены только для CONFIRMED', () => {
    expect(canModify({ status: 'CONFIRMED' })).toBe(true);
    for (const status of ['PENDING', 'CANCELLED', 'RESCHEDULED'] as const) {
      expect(canModify({ status })).toBe(false);
      expect(() => assertModifiable({ status })).toThrow(DomainError);
      try {
        assertModifiable({ status });
      } catch (err) {
        expect((err as DomainError).code).toBe('BOOKING_NOT_CONFIRMED');
      }
    }
  });
});
