import { describe, expect, it } from 'vitest';
import { MockOneCClient } from '../../src/infrastructure/onec/MockOneCClient';
import { OneCError } from '../../src/domain/errors';
import type { Booking, Client, Lead, ScheduleSlot } from '../../src/domain/entities/index';

const NOW = new Date();

function lead(idempotencyKey: string): Lead {
  return {
    id: `lead-${idempotencyKey}`,
    clientId: null,
    source: 'TELEGRAM',
    payloadJson: JSON.stringify({ question: 'Хочу на пилатес' }),
    status: 'NEW',
    idempotencyKey,
    externalId: null,
    errorCode: null,
    errorMessage: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function client(partial: Partial<Client> = {}): Client {
  return {
    id: 'cl-1',
    externalId: '1C-CL-1',
    fullName: 'Иванова Мария',
    phone: '+7 900 111-22-33',
    email: 'maria@example.com',
    active: true,
    createdAt: NOW,
    ...partial,
  };
}

function booking(idempotencyKey: string, partial: Partial<Booking> = {}): Booking {
  return {
    id: `bk-${idempotencyKey}`,
    externalId: null,
    clientId: 'cl-1',
    serviceId: 'PILATES_REFORMER',
    specialistId: 'ANNA_K',
    scheduleSlotId: 'mock-slot-1',
    slotStart: new Date(NOW.getTime() + 24 * 3600 * 1000),
    slotEnd: new Date(NOW.getTime() + 25 * 3600 * 1000),
    status: 'PENDING',
    idempotencyKey,
    errorCode: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...partial,
  };
}

async function firstSlot(mc: MockOneCClient): Promise<ScheduleSlot> {
  const slots = await mc.getSchedule({});
  return slots[0]!;
}

describe('MockOneCClient', () => {
  it('по умолчанию возвращает расписание, услуги и специалистов', async () => {
    const mc = new MockOneCClient();
    const [slots, services, specialists] = await Promise.all([
      mc.getSchedule({}),
      mc.getServices(),
      mc.getSpecialists(),
    ]);
    expect(slots.length).toBeGreaterThanOrEqual(5);
    expect(services.length).toBeGreaterThanOrEqual(1);
    expect(specialists.length).toBeGreaterThanOrEqual(1);
  });

  it('фильтрует расписание по услуге', async () => {
    const mc = new MockOneCClient();
    const slots = await mc.getSchedule({ serviceCode: 'PILATES_MAT' });
    expect(slots.every((s) => s.serviceId === 'PILATES_MAT')).toBe(true);
  });

  it('защита 1С от дублей: повтор той же заявки → тот же externalId, статус DUPLICATE', async () => {
    const mc = new MockOneCClient();
    const l = lead('key-1');
    const first = await mc.sendLead({ lead: l, client: client() });
    const second = await mc.sendLead({ lead: l, client: client() });
    expect(first.status).toBe('CREATED');
    expect(second).toEqual({ externalId: first.externalId, status: 'DUPLICATE' });
  });

  it('createBooking: успех → externalId + CONFIRMED', async () => {
    const mc = new MockOneCClient();
    const slot = await firstSlot(mc);
    const res = await mc.createBooking({
      booking: booking('bk-key-1'),
      slot,
      client: client(),
    });
    expect(res.status).toBe('CONFIRMED');
    expect(res.externalId).toMatch(/^B-1C-/);
  });

  it('createBooking: нет мест → OneCError E_NO_SEATS', async () => {
    const mc = new MockOneCClient();
    const slots = await mc.getSchedule({});
    const full = slots.find((s) => s.bookedCount >= s.capacity)!;
    await expect(
      mc.createBooking({ booking: booking('bk-full'), slot: full, client: client() }),
    ).rejects.toThrow(OneCError);
    await expect(
      mc.createBooking({ booking: booking('bk-full-2'), slot: full, client: client() }),
    ).rejects.toMatchObject({ rawCode: 'E_NO_SEATS' });
  });

  it('createBooking: неактивный клиент → E_CLIENT_INACTIVE; повтор ключа → DUPLICATE', async () => {
    const mc = new MockOneCClient();
    const slot = await firstSlot(mc);
    await expect(
      mc.createBooking({
        booking: booking('bk-inactive'),
        slot,
        client: client({ active: false }),
      }),
    ).rejects.toMatchObject({ rawCode: 'E_CLIENT_INACTIVE' });

    const ok = await mc.createBooking({ booking: booking('bk-ok'), slot, client: client() });
    const dup = await mc.createBooking({ booking: booking('bk-ok'), slot, client: client() });
    expect(dup).toEqual({ externalId: ok.externalId, status: 'DUPLICATE' });
  });

  it('cancel/reschedule: неизвестная запись → E_NOT_FOUND; известная — отмена OK', async () => {
    const mc = new MockOneCClient();
    const slot = await firstSlot(mc);
    const created = await mc.createBooking({
      booking: booking('bk-cancel'),
      slot,
      client: client(),
    });

    await expect(mc.cancelBooking('B-UNKNOWN')).rejects.toMatchObject({ rawCode: 'E_NOT_FOUND' });
    const cancelled = await mc.cancelBooking(created.externalId);
    expect(cancelled.status).toBe('CANCELLED');

    const slots = await mc.getSchedule({});
    const target = slots.find((s) => s.bookedCount < s.capacity && s.id !== slot.id)!;
    const moved = await mc.rescheduleBooking(created.externalId, target);
    expect(moved.status).toBe('CONFIRMED');
    expect(moved.slotStart).toEqual(target.startAt);
  });

  it('reschedule: целевой слот занят → E_SLOT_BUSY', async () => {
    const mc = new MockOneCClient();
    const slots = await mc.getSchedule({});
    const full = slots.find((s) => s.bookedCount >= s.capacity)!;
    await expect(mc.rescheduleBooking('B-1C-9999', full)).rejects.toMatchObject({
      rawCode: 'E_SLOT_BUSY',
    });
  });

  it('инъекция ошибок failNext и журнал вызовов', async () => {
    const mc = new MockOneCClient();
    mc.failNext('getSchedule', 'E_TIMEOUT');
    await expect(mc.getSchedule({})).rejects.toMatchObject({ rawCode: 'E_TIMEOUT' });
    // после инъекции метод снова работает
    await expect(mc.getSchedule({})).resolves.toBeInstanceOf(Array);
    expect(mc.calls.map((c) => c.method)).toEqual(['getSchedule', 'getSchedule']);
  });
});
