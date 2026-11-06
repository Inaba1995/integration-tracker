import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  ApiEndpoint,
  AuditEntry,
  Booking,
  Client,
  ErrorLogEntry,
  Estimate,
  Feature,
  IntegrationTask,
  Lead,
  ScheduleSlot,
  Service,
  Specialist,
  User,
  WebhookEvent,
} from '../../domain/entities/index';
import type { Repositories } from '../../domain/ports/repositories';
import type {
  BookingRepository,
  ClientRepository,
  EndpointRepository,
  ErrorLogRepository,
  EstimateRepository,
  FeatureRepository,
  LeadRepository,
  ScheduleRepository,
  SyncLogRepository,
  TaskRepository,
  UserRepository,
  WebhookEventRepository,
} from '../../domain/ports/repositories';

/**
 * Репозитории (Prisma). Модель схемы один-в-один соответствует доменным
 * сущностям, поэтому маппинг — идентичность (проверяется типом TS).
 */

export type Repos = Repositories;

export function createRepos(db: PrismaClient): Repos {
  const features: FeatureRepository = {
    async list(filter) {
      const rows = await db.feature.findMany({
        where: {
          status: filter?.status,
          implementationType: filter?.implementationType,
          priority: filter?.priority,
        },
        orderBy: { code: 'asc' },
      });
      return rows as Feature[];
    },
    async byId(id) {
      return (await db.feature.findUnique({ where: { id } })) as Feature | null;
    },
    async byCode(code) {
      return (await db.feature.findUnique({ where: { code } })) as Feature | null;
    },
    async create(data) {
      return (await db.feature.create({ data })) as Feature;
    },
    async update(id, data) {
      return (await db.feature.update({ where: { id }, data })) as Feature;
    },
  };

  const tasks: TaskRepository = {
    async list(filter) {
      const rows = await db.integrationTask.findMany({
        where: { featureId: filter?.featureId, status: filter?.status },
        orderBy: [{ featureId: 'asc' }, { createdAt: 'asc' }],
      });
      return rows as IntegrationTask[];
    },
    async byId(id) {
      return (await db.integrationTask.findUnique({ where: { id } })) as IntegrationTask | null;
    },
    async create(data) {
      return (await db.integrationTask.create({ data })) as IntegrationTask;
    },
    async update(id, data) {
      return (await db.integrationTask.update({ where: { id }, data })) as IntegrationTask;
    },
  };

  const endpoints: EndpointRepository = {
    async list(filter) {
      const rows = await db.apiEndpoint.findMany({
        where: { direction: filter?.direction, status: filter?.status },
        orderBy: { path: 'asc' },
      });
      return rows as ApiEndpoint[];
    },
    async byId(id) {
      return (await db.apiEndpoint.findUnique({ where: { id } })) as ApiEndpoint | null;
    },
    async create(data) {
      return (await db.apiEndpoint.create({ data })) as ApiEndpoint;
    },
    async update(id, data) {
      return (await db.apiEndpoint.update({ where: { id }, data })) as ApiEndpoint;
    },
  };

  const estimates: EstimateRepository = {
    async list(filter) {
      const rows = await db.estimate.findMany({
        where: { featureId: filter?.featureId },
        orderBy: { createdAt: 'desc' },
      });
      return rows as Estimate[];
    },
    async create(data) {
      return (await db.estimate.create({ data })) as Estimate;
    },
  };

  const webhooks: WebhookEventRepository = {
    async byId(id) {
      return (await db.webhookEvent.findUnique({ where: { id } })) as WebhookEvent | null;
    },
    async byIdempotencyKey(key) {
      const row = await db.webhookEvent.findFirst({
        where: { idempotencyKey: key },
        orderBy: { receivedAt: 'desc' },
      });
      return row as WebhookEvent | null;
    },
    async latestByKey(key) {
      const row = await db.webhookEvent.findFirst({
        where: { idempotencyKey: key },
        orderBy: { receivedAt: 'desc' },
      });
      return row as WebhookEvent | null;
    },
    async countByKey(key) {
      return db.webhookEvent.count({ where: { idempotencyKey: key } });
    },
    async list(limit = 100) {
      const rows = await db.webhookEvent.findMany({
        orderBy: { receivedAt: 'desc' },
        take: limit,
      });
      return rows as WebhookEvent[];
    },
    async create(data) {
      return (await db.webhookEvent.create({ data })) as WebhookEvent;
    },
    async updateStatus(id, status, processedAt) {
      return (await db.webhookEvent.update({
        where: { id },
        data: { status, processedAt: processedAt ?? (status === 'RECEIVED' ? null : new Date()) },
      })) as WebhookEvent;
    },
  };

  const leads: LeadRepository = {
    async byIdempotencyKey(key) {
      return (await db.lead.findUnique({ where: { idempotencyKey: key } })) as Lead | null;
    },
    async byId(id) {
      return (await db.lead.findUnique({ where: { id } })) as Lead | null;
    },
    async list(limit = 100) {
      const rows = await db.lead.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
      return rows as Lead[];
    },
    async create(data) {
      return (await db.lead.create({ data })) as Lead;
    },
    async update(id, data) {
      return (await db.lead.update({ where: { id }, data })) as Lead;
    },
  };

  const clients: ClientRepository = {
    async byPhone(phone) {
      const row = await db.client.findFirst({ where: { phone } });
      return row as Client | null;
    },
    async byId(id) {
      return (await db.client.findUnique({ where: { id } })) as Client | null;
    },
    async list() {
      const rows = await db.client.findMany({ orderBy: { createdAt: 'desc' } });
      return rows as Client[];
    },
    async create(data) {
      return (await db.client.create({ data })) as Client;
    },
    async update(id, data) {
      return (await db.client.update({ where: { id }, data })) as Client;
    },
  };

  const bookings: BookingRepository = {
    async byIdempotencyKey(key) {
      return (await db.booking.findUnique({ where: { idempotencyKey: key } })) as Booking | null;
    },
    async byId(id) {
      return (await db.booking.findUnique({ where: { id } })) as Booking | null;
    },
    async byExternalId(externalId) {
      return (await db.booking.findUnique({ where: { externalId } })) as Booking | null;
    },
    async list(filter) {
      const rows = await db.booking.findMany({
        where: { status: filter?.status },
        orderBy: { slotStart: 'asc' },
      });
      return rows as Booking[];
    },
    async create(data) {
      return (await db.booking.create({ data })) as Booking;
    },
    async update(id, data) {
      return (await db.booking.update({ where: { id }, data })) as Booking;
    },
  };

  const schedule: ScheduleRepository = {
    async listSlots(from, to) {
      const rows = await db.scheduleSlot.findMany({
        where: {
          startAt: { gte: from, lte: to },
        },
        orderBy: { startAt: 'asc' },
      });
      return rows as ScheduleSlot[];
    },
    async slotById(id) {
      return (await db.scheduleSlot.findUnique({ where: { id } })) as ScheduleSlot | null;
    },
    async upsertSlot(data) {
      const row = await db.scheduleSlot.upsert({
        where: {
          serviceId_specialistId_startAt: {
            serviceId: data.serviceId,
            specialistId: data.specialistId,
            startAt: data.startAt,
          },
        },
        create: { ...data, syncedAt: new Date() },
        update: { endAt: data.endAt, capacity: data.capacity, syncedAt: new Date() },
      });
      return row as ScheduleSlot;
    },
    async updateSlot(id, data) {
      return (await db.scheduleSlot.update({
        where: { id },
        data: { ...data, syncedAt: new Date() },
      })) as ScheduleSlot;
    },
  };

  const errors: ErrorLogRepository = {
    async list(filter) {
      const rows = await db.errorLog.findMany({
        where: { status: filter?.status, context: filter?.context },
        orderBy: { createdAt: 'desc' },
      });
      return rows as ErrorLogEntry[];
    },
    async byId(id) {
      return (await db.errorLog.findUnique({ where: { id } })) as ErrorLogEntry | null;
    },
    async create(data) {
      return (await db.errorLog.create({ data })) as ErrorLogEntry;
    },
    async update(id, data) {
      return (await db.errorLog.update({ where: { id }, data })) as ErrorLogEntry;
    },
  };

  const users: UserRepository = {
    async byEmail(email) {
      return (await db.user.findUnique({ where: { email } })) as User | null;
    },
    async byId(id) {
      return (await db.user.findUnique({ where: { id } })) as User | null;
    },
    async list() {
      const rows = await db.user.findMany({ orderBy: { email: 'asc' } });
      return rows as User[];
    },
  };

  const syncLogs: SyncLogRepository = {
    async start() {
      const row = await db.scheduleSyncLog.create({ data: {} });
      return { id: row.id };
    },
    async finish(id, data) {
      await db.scheduleSyncLog.update({
        where: { id },
        data: { ...data, finishedAt: new Date() },
      });
    },
  };

  const catalog = {
    async upsertService(data: Omit<Service, 'id'>): Promise<Service> {
      const row = await db.service.upsert({
        where: { code: data.code },
        create: data,
        update: {
          name: data.name,
          direction: data.direction,
          price: data.price,
          active: data.active,
        },
      });
      return row as Service;
    },
    async upsertSpecialist(data: Omit<Specialist, 'id'>): Promise<Specialist> {
      const row = await db.specialist.upsert({
        where: { code: data.code },
        create: data,
        update: { fullName: data.fullName, phone: data.phone, active: data.active },
      });
      return row as Specialist;
    },
    async listServices(): Promise<Service[]> {
      const rows = await db.service.findMany({ orderBy: { name: 'asc' } });
      return rows as Service[];
    },
    async listSpecialists(): Promise<Specialist[]> {
      const rows = await db.specialist.findMany({ orderBy: { fullName: 'asc' } });
      return rows as Specialist[];
    },
  };

  const audit = {
    async write(entry: Omit<AuditEntry, 'id' | 'createdAt'>) {
      await db.auditLog.create({ data: entry as Prisma.AuditLogCreateInput });
    },
  };

  return {
    features,
    tasks,
    endpoints,
    estimates,
    webhooks,
    leads,
    clients,
    bookings,
    schedule,
    catalog,
    errors,
    users,
    syncLogs,
    audit,
  };
}
