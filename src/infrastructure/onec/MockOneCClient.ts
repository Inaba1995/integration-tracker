import { randomUUID } from 'node:crypto';
import type { ScheduleSlot, Service, Specialist } from '../../domain/entities/index';
import { OneCError } from '../../domain/errors';
import type {
  CreateBookingInput,
  OneCClient,
  ScheduleQuery,
  SendLeadInput,
} from '../../domain/ports/onec';

/**
 * Mock-реализация 1С:Фитнес клуб (ONEC_MODE=mock, режим по умолчанию).
 * Поведение имитирует штатные механизмы 1С:
 *  - защита от дублирования заявок/записей по ключу;
 *  - проверку свободных мест и активности клиента;
 *  - коды ошибок в формате 1С (E_*) — маппятся доменным правилом.
 * Настраиваемые задержки и инъекции ошибок — для тестов и демо.
 */

export type MockMethod =
  | 'sendLead'
  | 'getSchedule'
  | 'getServices'
  | 'getSpecialists'
  | 'createBooking'
  | 'cancelBooking'
  | 'rescheduleBooking';

export interface MockOneCClientOptions {
  /** Задержка каждого вызова, мс (для демо/тестов). */
  delayMs?: number;
  services?: Service[];
  specialists?: Specialist[];
  slots?: ScheduleSlot[];
}

export interface MockCall {
  method: MockMethod;
  at: Date;
}

function defaultServices(): Service[] {
  return [
    {
      id: 'svc-1',
      code: 'PILATES_REFORMER',
      name: 'Пилатес на реформере',
      direction: 'Групповые',
      price: 1500,
      active: true,
    },
    {
      id: 'svc-2',
      code: 'PILATES_MAT',
      name: 'Пилатес на коврике',
      direction: 'Групповые',
      price: 1200,
      active: true,
    },
    {
      id: 'svc-3',
      code: 'PILATES_PRIVATE',
      name: 'Пилатес индивидуально',
      direction: 'Персональные',
      price: 3500,
      active: true,
    },
  ];
}

function defaultSpecialists(): Specialist[] {
  return [
    {
      id: 'spc-1',
      code: 'ANNA_K',
      fullName: 'Анна Ковалёва',
      phone: '+7 900 000-00-01',
      active: true,
    },
    {
      id: 'spc-2',
      code: 'MARIA_S',
      fullName: 'Мария Сидорова',
      phone: '+7 900 000-00-02',
      active: true,
    },
  ];
}

function defaultSlots(): ScheduleSlot[] {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const day = (offset: number) => new Date(base.getTime() + offset * 24 * 60 * 60 * 1000);
  const at = (offset: number, hour: number) => {
    const d = day(offset);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const make = (
    i: number,
    serviceId: string,
    specialistId: string,
    startAt: Date,
    capacity: number,
    bookedCount: number,
  ): ScheduleSlot => ({
    id: `mock-slot-${i}`,
    serviceId,
    specialistId,
    startAt,
    endAt: new Date(startAt.getTime() + 60 * 60 * 1000),
    capacity,
    bookedCount,
    syncedAt: new Date(),
  });

  return [
    make(1, 'PILATES_REFORMER', 'ANNA_K', at(1, 10), 8, 3),
    make(2, 'PILATES_REFORMER', 'ANNA_K', at(1, 18), 8, 5),
    make(3, 'PILATES_MAT', 'MARIA_S', at(1, 12), 12, 12), // полностью заняты → NO_SEATS
    make(4, 'PILATES_MAT', 'MARIA_S', at(2, 12), 12, 4),
    make(5, 'PILATES_PRIVATE', 'ANNA_K', at(2, 19), 1, 0),
    make(6, 'PILATES_REFORMER', 'MARIA_S', at(3, 10), 8, 1),
  ];
}

export class MockOneCClient implements OneCClient {
  readonly mode = 'mock' as const;
  readonly calls: MockCall[] = [];

  private readonly options: MockOneCClientOptions;
  private readonly services: Service[];
  private readonly specialists: Specialist[];
  private readonly slots: ScheduleSlot[];
  private readonly failures = new Map<MockMethod, string[]>();
  /** Внутренняя защита 1С от дублирования: idempotencyKey → externalId. */
  private readonly leadKeys = new Map<string, string>();
  private readonly bookingKeys = new Map<string, string>();
  private readonly cancelled = new Set<string>();

  constructor(options: MockOneCClientOptions = {}) {
    this.options = options;
    this.services = options.services ?? defaultServices();
    this.specialists = options.specialists ?? defaultSpecialists();
    this.slots = options.slots ?? defaultSlots();
  }

  /** Инъекция ошибки: следующий вызов метода бросит OneCError с rawCode. */
  failNext(method: MockMethod, rawCode: string): void {
    const queue = this.failures.get(method) ?? [];
    queue.push(rawCode);
    this.failures.set(method, queue);
  }

  async sendLead(input: SendLeadInput): Promise<{ externalId: string; status: string }> {
    return this.invoke('sendLead', () => {
      const key = input.lead.idempotencyKey;
      const existing = this.leadKeys.get(key);
      if (existing) {
        // 1С сама защищает от дублей — возвращаем существующую заявку
        return { externalId: existing, status: 'DUPLICATE' };
      }
      const externalId = `L-1C-${randomUUID().slice(0, 8)}`;
      this.leadKeys.set(key, externalId);
      return { externalId, status: 'CREATED' };
    });
  }

  async getSchedule(params: ScheduleQuery): Promise<ScheduleSlot[]> {
    return this.invoke('getSchedule', () =>
      this.slots
        .filter((s) => (params.from ? s.startAt >= params.from : true))
        .filter((s) => (params.to ? s.startAt <= params.to : true))
        .filter((s) => (params.serviceCode ? s.serviceId === params.serviceCode : true))
        .filter((s) => (params.specialistCode ? s.specialistId === params.specialistCode : true))
        .map((s) => ({ ...s })),
    );
  }

  async getServices(): Promise<Service[]> {
    return this.invoke('getServices', () => this.services.map((s) => ({ ...s })));
  }

  async getSpecialists(): Promise<Specialist[]> {
    return this.invoke('getSpecialists', () => this.specialists.map((s) => ({ ...s })));
  }

  async createBooking(input: CreateBookingInput): Promise<{ externalId: string; status: string }> {
    return this.invoke('createBooking', () => {
      const { booking, slot, client } = input;
      const existing = this.bookingKeys.get(booking.idempotencyKey);
      if (existing) {
        return { externalId: existing, status: 'DUPLICATE' };
      }
      if (!client.active) {
        throw new OneCError('E_CLIENT_INACTIVE', 'Клиент неактивен в 1С');
      }
      if (slot.bookedCount >= slot.capacity) {
        throw new OneCError('E_NO_SEATS', 'Свободных мест нет');
      }
      const externalId = `B-1C-${randomUUID().slice(0, 8)}`;
      this.bookingKeys.set(booking.idempotencyKey, externalId);
      return { externalId, status: 'CONFIRMED' };
    });
  }

  async cancelBooking(externalId: string): Promise<{ status: string }> {
    return this.invoke('cancelBooking', () => {
      if (!this.knownBooking(externalId)) {
        throw new OneCError('E_NOT_FOUND', `Запись ${externalId} не найдена в 1С`);
      }
      this.cancelled.add(externalId);
      return { status: 'CANCELLED' };
    });
  }

  async rescheduleBooking(
    externalId: string,
    newSlot: ScheduleSlot,
  ): Promise<{ status: string; slotStart: Date; slotEnd: Date }> {
    return this.invoke('rescheduleBooking', () => {
      if (!this.knownBooking(externalId)) {
        throw new OneCError('E_NOT_FOUND', `Запись ${externalId} не найдена в 1С`);
      }
      if (newSlot.bookedCount >= newSlot.capacity) {
        throw new OneCError('E_SLOT_BUSY', 'Целевой слот занят');
      }
      return { status: 'CONFIRMED', slotStart: newSlot.startAt, slotEnd: newSlot.endAt };
    });
  }

  private knownBooking(externalId: string): boolean {
    return [...this.bookingKeys.values()].includes(externalId) || externalId.startsWith('B-1C-');
  }

  private async invoke<T>(method: MockMethod, fn: () => T): Promise<T> {
    this.calls.push({ method, at: new Date() });
    if (this.options.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));
    }
    const queue = this.failures.get(method);
    const code = queue?.shift();
    if (code) {
      throw new OneCError(code, `Mock-ошибка 1С (${method}): ${code}`);
    }
    return fn();
  }
}

/** Стабильный idempotency-ключ для демо/тестов мока. */
export function mockIdempotencyKey(prefix = 'mock'): string {
  return `${prefix}-${randomUUID()}`;
}
