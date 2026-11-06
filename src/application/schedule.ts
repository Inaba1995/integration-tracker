import type { ScheduleSlot, Service, Specialist } from '../domain/entities/index';
import { DomainError } from '../domain/errors';
import { toDomainError } from '../domain/rules/oneCErrors';
import type { AppContext } from './context';
import { audit } from './audit';
import { withRetries } from './retry';

export interface ScheduleFilter {
  from?: string;
  to?: string;
  serviceCode?: string;
  specialistCode?: string;
}

export async function listSchedule(
  ctx: AppContext,
  filter: ScheduleFilter = {},
): Promise<ScheduleSlot[]> {
  return ctx.repos.schedule.listSlots(
    filter.from ? new Date(filter.from) : undefined,
    filter.to ? new Date(filter.to) : undefined,
  );
}

export interface SyncResult {
  slots: number;
  services: number;
  specialists: number;
  status: 'OK';
}

/**
 * Синхронизация расписания/услуг/специалистов из 1С.
 * Слоты вставляются/upsert'ятся по (service, specialist, startAt) — без дублей.
 */
export async function syncSchedule(ctx: AppContext): Promise<SyncResult> {
  const log = await ctx.repos.syncLogs.start(ctx.correlationId);
  try {
    const {
      s: slots,
      svc: services,
      spc: specialists,
    } = await withRetries(ctx, 'schedule.sync', { logId: log.id }, async () => {
      const onec = ctx.adapter.get();
      const [s, svc, spc] = await Promise.all([
        onec.getSchedule({}),
        onec.getServices(),
        onec.getSpecialists(),
      ]);
      return { s, svc, spc };
    });

    let slotCount = 0;
    for (const slot of slots) {
      await ctx.repos.schedule.upsertSlot({
        serviceId: slot.serviceId,
        specialistId: slot.specialistId,
        startAt: slot.startAt,
        endAt: slot.endAt,
        capacity: slot.capacity,
        bookedCount: slot.bookedCount,
      });
      slotCount += 1;
    }
    for (const service of services) {
      await ctx.repos.catalog.upsertService(normalizeService(service));
    }
    for (const specialist of specialists) {
      await ctx.repos.catalog.upsertSpecialist(normalizeSpecialist(specialist));
    }

    await ctx.repos.syncLogs.finish(log.id, { slotCount, status: 'OK' });
    await audit(ctx, 'ScheduleSlot', 'sync', 'SYNC', {
      slots: slotCount,
      services: services.length,
      specialists: specialists.length,
    });
    return {
      slots: slotCount,
      services: services.length,
      specialists: specialists.length,
      status: 'OK',
    };
  } catch (err) {
    const de = toDomainError(err);
    await ctx.repos.syncLogs.finish(log.id, {
      slotCount: 0,
      status: 'FAILED',
      message: de.message,
    });
    throw de;
  }
}

export function listServices(ctx: AppContext): Promise<Service[]> {
  return ctx.repos.catalog.listServices();
}

export function listSpecialists(ctx: AppContext): Promise<Specialist[]> {
  return ctx.repos.catalog.listSpecialists();
}

function normalizeService(service: Service): Omit<Service, 'id'> {
  return {
    code: service.code,
    name: service.name,
    direction: service.direction,
    price: service.price,
    active: service.active,
  };
}

function normalizeSpecialist(specialist: Specialist): Omit<Specialist, 'id'> {
  return {
    code: specialist.code,
    fullName: specialist.fullName,
    phone: specialist.phone,
    active: specialist.active,
  };
}

export function assertValidDate(value: string | undefined, field: string): void {
  if (value && Number.isNaN(new Date(value).getTime())) {
    throw new DomainError('VALIDATION', `Некорректная дата в поле ${field}`);
  }
}
