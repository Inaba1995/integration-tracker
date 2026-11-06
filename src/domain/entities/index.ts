/**
 * Доменные сущности трекера интеграции.
 * Чистый TypeScript: без зависимостей от БД, HTTP и 1С.
 * Значения статусов/типов — дискриминированные объединения (const arrays).
 */

export const ROLES = ['ADMIN', 'INTEGRATOR', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

export const FEATURE_STATUSES = ['PLANNED', 'IN_PROGRESS', 'BLOCKED', 'DONE'] as const;
export type FeatureStatus = (typeof FEATURE_STATUSES)[number];

export const IMPLEMENTATION_TYPES = [
  'STANDARD_API',
  'EXTENSION',
  'CUSTOM_HTTP_SERVICE',
  'TBD',
] as const;
export type ImplementationType = (typeof IMPLEMENTATION_TYPES)[number];

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const ENDPOINT_DIRECTIONS = ['INBOUND', 'OUTBOUND'] as const;
export type EndpointDirection = (typeof ENDPOINT_DIRECTIONS)[number];

export const ENDPOINT_STATUSES = ['DRAFT', 'MOCKED', 'LIVE', 'FAILING'] as const;
export type EndpointStatus = (typeof ENDPOINT_STATUSES)[number];

export const WEBHOOK_STATUSES = ['RECEIVED', 'PROCESSED', 'DUPLICATE', 'FAILED'] as const;
export type WebhookStatus = (typeof WEBHOOK_STATUSES)[number];

export const BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'CANCELLED', 'RESCHEDULED'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const LEAD_STATUSES = ['NEW', 'SENT_TO_1C', 'DUPLICATE', 'ERROR'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_SOURCES = ['VK', 'TELEGRAM', 'WHATSAPP', 'MAX', 'EMAIL', 'WEB', 'OTHER'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const ERROR_STATUSES = ['PENDING', 'RETRYING', 'FAILED', 'RESOLVED'] as const;
export type ErrorStatus = (typeof ERROR_STATUSES)[number];

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
  createdAt: Date;
}

export interface Feature {
  id: string;
  code: string;
  title: string;
  description: string;
  status: FeatureStatus;
  implementationType: ImplementationType;
  priority: Priority;
  estimateDays: number | null;
  estimateCost: number | null;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IntegrationTask {
  id: string;
  featureId: string;
  title: string;
  status: TaskStatus;
  assigneeId: string | null;
  dueDate: Date | null;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiEndpoint {
  id: string;
  name: string;
  method: HttpMethod;
  path: string;
  direction: EndpointDirection;
  payloadSchema: string;
  responseSchema: string;
  status: EndpointStatus;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookEvent {
  id: string;
  source: string;
  eventType: string;
  payloadJson: string;
  receivedAt: Date;
  status: WebhookStatus;
  idempotencyKey: string;
  correlationId: string | null;
  processedAt: Date | null;
}

export interface Client {
  id: string;
  externalId: string | null;
  fullName: string;
  phone: string;
  email: string;
  active: boolean;
  createdAt: Date;
}

export interface Lead {
  id: string;
  clientId: string | null;
  source: LeadSource;
  payloadJson: string;
  status: LeadStatus;
  idempotencyKey: string;
  externalId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Service {
  id: string;
  code: string;
  name: string;
  direction: string;
  price: number | null;
  active: boolean;
}

export interface Specialist {
  id: string;
  code: string;
  fullName: string;
  phone: string;
  active: boolean;
}

export interface ScheduleSlot {
  id: string;
  serviceId: string;
  specialistId: string;
  startAt: Date;
  endAt: Date;
  capacity: number;
  bookedCount: number;
  syncedAt: Date;
}

export interface Booking {
  id: string;
  externalId: string | null;
  clientId: string;
  serviceId: string;
  specialistId: string;
  scheduleSlotId: string | null;
  slotStart: Date;
  slotEnd: Date;
  status: BookingStatus;
  idempotencyKey: string;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ErrorLogEntry {
  id: string;
  context: string;
  errorCode: string;
  rawCode: string;
  message: string;
  payloadJson: string;
  retryCount: number;
  status: ErrorStatus;
  correlationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Estimate {
  id: string;
  featureId: string;
  hours: number;
  cost: number;
  currency: string;
  comment: string;
  createdAt: Date;
}

export interface AuditEntry {
  id: string;
  model: string;
  recordId: string;
  action: string;
  actorId: string | null;
  actorEmail: string;
  dataJson: string;
  correlationId: string | null;
  createdAt: Date;
}
