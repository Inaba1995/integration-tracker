import { z } from 'zod';
import {
  ENDPOINT_DIRECTIONS,
  ENDPOINT_STATUSES,
  FEATURE_STATUSES,
  HTTP_METHODS,
  IMPLEMENTATION_TYPES,
  LEAD_SOURCES,
  PRIORITIES,
  TASK_STATUSES,
} from '../domain/entities/index';

/** zod-схемы всех входящих payload интерфейсного слоя. */

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const featureCreateSchema = z.object({
  code: z.string().min(1).max(64),
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  status: z.enum(FEATURE_STATUSES).optional(),
  implementationType: z.enum(IMPLEMENTATION_TYPES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  estimateDays: z.number().min(0).nullable().optional(),
  estimateCost: z.number().min(0).nullable().optional(),
  notes: z.string().max(5000).optional(),
});

export const featureUpdateSchema = featureCreateSchema.partial();

export const listQuerySchema = z.object({
  status: z.string().optional(),
  implementationType: z.string().optional(),
  priority: z.string().optional(),
  direction: z.string().optional(),
  featureId: z.string().optional(),
  context: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  serviceCode: z.string().optional(),
  specialistCode: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(10_000).optional(),
});

export const taskCreateSchema = z.object({
  featureId: z.string().min(1),
  title: z.string().min(1).max(300),
  status: z.enum(TASK_STATUSES).optional(),
  assigneeId: z.string().nullable().optional(),
  dueDate: z.string().datetime({ offset: true }).nullable().optional(),
  description: z.string().max(5000).optional(),
});

export const taskUpdateSchema = taskCreateSchema.partial().omit({ featureId: true });

export const endpointCreateSchema = z.object({
  name: z.string().min(1).max(300),
  method: z.enum(HTTP_METHODS),
  path: z.string().min(1).max(500),
  direction: z.enum(ENDPOINT_DIRECTIONS),
  payloadSchema: z.string().optional(),
  responseSchema: z.string().optional(),
  status: z.enum(ENDPOINT_STATUSES).optional(),
  notes: z.string().max(5000).optional(),
});

export const endpointUpdateSchema = endpointCreateSchema.partial();

export const webhookCreateSchema = z.object({
  source: z.string().min(1).max(64).optional(),
  eventType: z.string().min(1).max(128),
  payload: z.unknown(),
  idempotencyKey: z.string().min(1).max(256),
});

export const leadCreateSchema = z.object({
  idempotencyKey: z.string().min(1).max(256),
  source: z.enum(LEAD_SOURCES).optional(),
  client: z.object({
    fullName: z.string().min(1).max(300),
    phone: z.string().min(3).max(64),
    email: z.string().email().optional(),
  }),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const bookingCreateSchema = z.object({
  clientId: z.string().min(1),
  slotId: z.string().min(1),
  idempotencyKey: z.string().min(1).max(256),
});

export const rescheduleSchema = z.object({
  targetSlotId: z.string().min(1),
  idempotencyKey: z.string().min(1).max(256).optional(),
});

export const estimateCreateSchema = z.object({
  featureId: z.string().min(1),
  hours: z.number().min(0),
  cost: z.number().min(0),
  currency: z.string().min(1).max(8).optional(),
  comment: z.string().max(2000).optional(),
});

export const settingsPatchSchema = z.object({
  oneCMode: z.enum(['mock', 'real']),
});

export const clientCreateSchema = z.object({
  fullName: z.string().min(1).max(300),
  phone: z.string().min(3).max(64),
  email: z.string().email().optional(),
});
