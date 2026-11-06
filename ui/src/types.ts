/** Типы API-сущностей (зеркало доменной модели). */

export interface Feature {
  id: string;
  code: string;
  title: string;
  description: string;
  status: 'PLANNED' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE';
  implementationType: 'STANDARD_API' | 'EXTENSION' | 'CUSTOM_HTTP_SERVICE' | 'TBD';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  estimateDays: number | null;
  estimateCost: number | null;
  notes: string;
}

export interface Task {
  id: string;
  featureId: string;
  title: string;
  status: 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE';
  assigneeId: string | null;
  dueDate: string | null;
  description: string;
}

export interface ApiEndpoint {
  id: string;
  name: string;
  method: string;
  path: string;
  direction: 'INBOUND' | 'OUTBOUND';
  status: 'DRAFT' | 'MOCKED' | 'LIVE' | 'FAILING';
  payloadSchema: string;
  responseSchema: string;
  notes: string;
}

export interface WebhookEvent {
  id: string;
  source: string;
  eventType: string;
  payloadJson: string;
  receivedAt: string;
  status: 'RECEIVED' | 'PROCESSED' | 'DUPLICATE' | 'FAILED';
  idempotencyKey: string;
  correlationId: string | null;
}

export interface Client {
  id: string;
  externalId: string | null;
  fullName: string;
  phone: string;
  email: string;
  active: boolean;
}

export interface Lead {
  id: string;
  clientId: string | null;
  source: string;
  payloadJson: string;
  status: 'NEW' | 'SENT_TO_1C' | 'DUPLICATE' | 'ERROR';
  idempotencyKey: string;
  externalId: string | null;
  errorCode: string | null;
  createdAt: string;
}

export interface ScheduleSlot {
  id: string;
  serviceId: string;
  specialistId: string;
  startAt: string;
  endAt: string;
  capacity: number;
  bookedCount: number;
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
  active: boolean;
}

export interface Booking {
  id: string;
  externalId: string | null;
  clientId: string;
  serviceId: string;
  specialistId: string;
  scheduleSlotId: string | null;
  slotStart: string;
  slotEnd: string;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'RESCHEDULED';
  idempotencyKey: string;
  errorCode: string | null;
}

export interface ErrorLog {
  id: string;
  context: string;
  errorCode: string;
  rawCode: string;
  message: string;
  payloadJson: string;
  retryCount: number;
  status: 'PENDING' | 'RETRYING' | 'FAILED' | 'RESOLVED';
  createdAt: string;
}

export interface Estimate {
  id: string;
  featureId: string;
  hours: number;
  cost: number;
  currency: string;
  comment: string;
}

export interface SummaryReport {
  features: {
    total: number;
    byStatus: Array<{ status: string; count: number }>;
    byImplementationType: Array<{ type: string; count: number }>;
    totals: { estimateDays: number; estimateCost: number };
  };
  estimates: { count: number; hours: number; cost: number; currency: string };
  tasks: { total: number; byStatus: Array<{ status: string; count: number }> };
  endpoints: { total: number; byStatus: Array<{ status: string; count: number }> };
  duplicates: { webhookEvents: number; leads: number };
  errors: {
    total: number;
    byStatus: Array<{ status: string; count: number }>;
    recent: ErrorLog[];
  };
  bookings: { total: number; byStatus: Array<{ status: string; count: number }> };
  leads: { total: number; byStatus: Array<{ status: string; count: number }> };
  inventory: {
    clients: number;
    slots: number;
    services: number;
    specialists: number;
    users: number;
    webhooks: number;
  };
}

export interface Settings {
  oneCMode: 'mock' | 'real';
  realConfigured: boolean;
  tokenConfigured: boolean;
  nodeEnv: string;
  corsOrigin: string;
}

export interface StandardVsCustomRow {
  code: string;
  title: string;
  status: string;
  implementationType: string;
  priority: string;
  estimateDays: number | null;
  estimateCost: number | null;
  tasksTotal: number;
  tasksDone: number;
  notes: string;
}
