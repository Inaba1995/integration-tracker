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
} from '../entities/index';

/**
 * Порты репозиториев. Домен/application зависят только от интерфейсов,
 * реализации — в infrastructure/db (Prisma).
 */

export interface FeatureRepository {
  list(filter?: {
    status?: string;
    implementationType?: string;
    priority?: string;
  }): Promise<Feature[]>;
  byId(id: string): Promise<Feature | null>;
  byCode(code: string): Promise<Feature | null>;
  create(data: Omit<Feature, 'id' | 'createdAt' | 'updatedAt'>): Promise<Feature>;
  update(
    id: string,
    data: Partial<Omit<Feature, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<Feature>;
}

export interface TaskRepository {
  list(filter?: { featureId?: string; status?: string }): Promise<IntegrationTask[]>;
  byId(id: string): Promise<IntegrationTask | null>;
  create(data: Omit<IntegrationTask, 'id' | 'createdAt' | 'updatedAt'>): Promise<IntegrationTask>;
  update(
    id: string,
    data: Partial<Omit<IntegrationTask, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<IntegrationTask>;
}

/** Единый порт идемпотентных входящих сущностей (webhook-события, заявки, записи). */
export interface IdempotentRepository<T extends { idempotencyKey: string }> {
  byIdempotencyKey(key: string): Promise<T | null>;
  create(data: Omit<T, 'id'>): Promise<T>;
}

export interface WebhookEventRepository extends IdempotentRepository<WebhookEvent> {
  list(limit?: number): Promise<WebhookEvent[]>;
  byId(id: string): Promise<WebhookEvent | null>;
  /** Последнее событие с данным ключом (для детекта повторов). */
  latestByKey(key: string): Promise<WebhookEvent | null>;
  /** Сколько раз ключ уже встречался (для статуса DUPLICATE). */
  countByKey(key: string): Promise<number>;
  updateStatus(id: string, status: string, processedAt?: Date): Promise<WebhookEvent>;
}

export interface LeadRepository extends IdempotentRepository<Lead> {
  list(limit?: number): Promise<Lead[]>;
  byId(id: string): Promise<Lead | null>;
  update(id: string, data: Partial<Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Lead>;
}

export interface ClientRepository {
  byPhone(phone: string): Promise<Client | null>;
  byId(id: string): Promise<Client | null>;
  list(): Promise<Client[]>;
  create(data: Omit<Client, 'id' | 'createdAt'>): Promise<Client>;
  update(id: string, data: Partial<Omit<Client, 'id' | 'createdAt'>>): Promise<Client>;
}

export interface BookingRepository extends IdempotentRepository<Booking> {
  list(filter?: { status?: string }): Promise<Booking[]>;
  byId(id: string): Promise<Booking | null>;
  byExternalId(externalId: string): Promise<Booking | null>;
  update(id: string, data: Partial<Omit<Booking, 'id' | 'createdAt'>>): Promise<Booking>;
}

export interface ScheduleRepository {
  listSlots(from?: Date, to?: Date): Promise<ScheduleSlot[]>;
  slotById(id: string): Promise<ScheduleSlot | null>;
  /** upsert по (serviceId, specialistId, startAt) — защита от дублей при синхронизации. */
  upsertSlot(data: Omit<ScheduleSlot, 'id' | 'syncedAt'>): Promise<ScheduleSlot>;
  updateSlot(
    id: string,
    data: Partial<Omit<ScheduleSlot, 'id' | 'syncedAt'>>,
  ): Promise<ScheduleSlot>;
}

export interface CatalogRepository {
  upsertService(data: Omit<Service, 'id'>): Promise<Service>;
  upsertSpecialist(data: Omit<Specialist, 'id'>): Promise<Specialist>;
  listServices(): Promise<Service[]>;
  listSpecialists(): Promise<Specialist[]>;
}

export interface ErrorLogRepository {
  list(filter?: { status?: string; context?: string }): Promise<ErrorLogEntry[]>;
  byId(id: string): Promise<ErrorLogEntry | null>;
  create(data: Omit<ErrorLogEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<ErrorLogEntry>;
  update(
    id: string,
    data: Partial<Omit<ErrorLogEntry, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<ErrorLogEntry>;
}

export interface AuditWriter {
  write(entry: Omit<AuditEntry, 'id' | 'createdAt'>): Promise<void>;
}

export interface EndpointRepository {
  list(filter?: { direction?: string; status?: string }): Promise<ApiEndpoint[]>;
  byId(id: string): Promise<ApiEndpoint | null>;
  create(data: Omit<ApiEndpoint, 'id' | 'createdAt' | 'updatedAt'>): Promise<ApiEndpoint>;
  update(
    id: string,
    data: Partial<Omit<ApiEndpoint, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<ApiEndpoint>;
}

export interface EstimateRepository {
  list(filter?: { featureId?: string }): Promise<Estimate[]>;
  create(data: Omit<Estimate, 'id' | 'createdAt'>): Promise<Estimate>;
}

export interface UserRepository {
  byEmail(email: string): Promise<User | null>;
  byId(id: string): Promise<User | null>;
  list(): Promise<User[]>;
}

/** Журнал синхронизаций расписания (для UI и аудита). */
export interface SyncLogRepository {
  start(correlationId?: string): Promise<{ id: string }>;
  finish(
    id: string,
    data: { slotCount: number; status: 'OK' | 'FAILED'; message?: string },
  ): Promise<void>;
}

/** Агрегат всех репозиториев — передаётся в прикладной слой. */
export interface Repositories {
  features: FeatureRepository;
  tasks: TaskRepository;
  endpoints: EndpointRepository;
  estimates: EstimateRepository;
  webhooks: WebhookEventRepository;
  leads: LeadRepository;
  clients: ClientRepository;
  bookings: BookingRepository;
  schedule: ScheduleRepository;
  catalog: CatalogRepository;
  errors: ErrorLogRepository;
  users: UserRepository;
  syncLogs: SyncLogRepository;
  audit: AuditWriter;
}
