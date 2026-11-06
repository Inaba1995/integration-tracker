import { randomUUID } from 'node:crypto';
import {
  ENDPOINT_DIRECTIONS,
  ENDPOINT_STATUSES,
  HTTP_METHODS,
  type ApiEndpoint,
} from '../domain/entities/index';
import { DomainError } from '../domain/errors';
import type { OneCClient } from '../domain/ports/onec';
import type { AppContext } from './context';
import { audit } from './audit';

export interface EndpointInput {
  name?: string;
  method?: string;
  path?: string;
  direction?: string;
  payloadSchema?: string;
  responseSchema?: string;
  status?: string;
  notes?: string;
}

const UPDATABLE = [
  'name',
  'method',
  'path',
  'direction',
  'payloadSchema',
  'responseSchema',
  'status',
  'notes',
] as const;

export function listEndpoints(
  ctx: AppContext,
  filter?: { direction?: string; status?: string },
): Promise<ApiEndpoint[]> {
  return ctx.repos.endpoints.list(filter);
}

export async function createEndpoint(ctx: AppContext, input: EndpointInput): Promise<ApiEndpoint> {
  validateEndpoint(input, true);
  const endpoint = await ctx.repos.endpoints.create({
    name: String(input.name),
    method: String(input.method) as ApiEndpoint['method'],
    path: String(input.path),
    direction: String(input.direction) as ApiEndpoint['direction'],
    payloadSchema: input.payloadSchema ?? '{}',
    responseSchema: input.responseSchema ?? '{}',
    status: (input.status as ApiEndpoint['status']) ?? 'DRAFT',
    notes: input.notes ?? '',
  });
  await audit(ctx, 'ApiEndpoint', endpoint.id, 'CREATE', endpoint);
  return endpoint;
}

export async function updateEndpoint(
  ctx: AppContext,
  id: string,
  input: EndpointInput,
): Promise<ApiEndpoint> {
  const before = await ctx.repos.endpoints.byId(id);
  if (!before) {
    throw new DomainError('NOT_FOUND', `Эндпоинт ${id} не найден`);
  }
  validateEndpoint(input, false);
  const data: Record<string, unknown> = {};
  for (const key of UPDATABLE) {
    if (input[key] !== undefined) data[key] = input[key];
  }
  const endpoint = await ctx.repos.endpoints.update(id, data as Partial<ApiEndpoint>);
  await audit(ctx, 'ApiEndpoint', id, 'UPDATE', { before, after: endpoint });
  return endpoint;
}

export interface TestRequestResult {
  endpointId: string;
  mode: 'mock' | 'real';
  durationMs: number;
  request: unknown;
  response: unknown;
  endpointStatus: ApiEndpoint['status'];
}

/**
 * «Отправить тестовый запрос» в API Explorer.
 * OUTBOUND (трекер → 1С) — реальный вызов адаптера (mock по умолчанию).
 * INBOUND (1С/ассистент → трекер) — безопасная симуляция без побочных эффектов.
 * Мутирующие OUTBOUND-запросы разрешены только в mock-режиме.
 */
export async function sendTestRequest(ctx: AppContext, id: string): Promise<TestRequestResult> {
  const endpoint = await ctx.repos.endpoints.byId(id);
  if (!endpoint) {
    throw new DomainError('NOT_FOUND', `Эндпоинт ${id} не найден`);
  }
  const onec = ctx.adapter.get();
  const isMutation = endpoint.method !== 'GET';
  if (endpoint.direction === 'OUTBOUND' && isMutation && onec.mode === 'real') {
    throw new DomainError(
      'VALIDATION',
      'Тестовые мутирующие запросы доступны только в mock-режиме (защита реальных данных 1С)',
    );
  }

  const started = Date.now();
  try {
    const { request, response } = await runTest(ctx, endpoint, onec);
    const durationMs = Date.now() - started;
    const endpointStatus: ApiEndpoint['status'] =
      endpoint.direction === 'INBOUND' ? 'MOCKED' : onec.mode === 'real' ? 'LIVE' : 'MOCKED';
    const updated = await ctx.repos.endpoints.update(endpoint.id, {
      status: endpointStatus,
      notes: `Тест: ${new Date().toISOString()} OK (${durationMs} мс)`,
    });
    await audit(ctx, 'ApiEndpoint', endpoint.id, 'TEST', { status: 'OK', durationMs });
    void updated;
    return { endpointId: id, mode: onec.mode, durationMs, request, response, endpointStatus };
  } catch (err) {
    const durationMs = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    await ctx.repos.endpoints.update(endpoint.id, {
      status: 'FAILING',
      notes: `Тест: ${new Date().toISOString()} FAILED — ${message}`,
    });
    await audit(ctx, 'ApiEndpoint', endpoint.id, 'TEST', { status: 'FAILED', durationMs, message });
    throw err;
  }
}

async function runTest(
  ctx: AppContext,
  endpoint: ApiEndpoint,
  onec: OneCClient,
): Promise<{ request: unknown; response: unknown }> {
  const path = endpoint.path;

  if (endpoint.direction === 'INBOUND') {
    const sample = path.includes('webhook')
      ? {
          source: 'test',
          eventType: 'lead.created',
          idempotencyKey: `test-${randomUUID()}`,
          payload: { client: { fullName: 'Тестовый Клиент', phone: '+7 900 000-00-00' } },
        }
      : { query: {}, body: {} };
    return { request: sample, response: { accepted: true, simulated: true, status: 'RECEIVED' } };
  }

  // OUTBOUND → вызов адаптера 1С
  if (path.includes('/schedule')) {
    const request = { method: 'GET', query: {} };
    const response = await onec.getSchedule({});
    return { request, response };
  }
  if (path.includes('/services')) {
    const request = { method: 'GET' };
    const response = await onec.getServices();
    return { request, response };
  }
  if (path.includes('/specialists')) {
    const request = { method: 'GET' };
    const response = await onec.getSpecialists();
    return { request, response };
  }
  if (path.includes('/leads')) {
    const client = (await ctx.repos.clients.list())[0] ?? null;
    const request = {
      method: 'POST',
      idempotencyKey: `test-${randomUUID()}`,
      client: client ? { fullName: client.fullName, phone: client.phone } : null,
    };
    const response = await onec.sendLead({
      lead: {
        id: 'test-lead',
        clientId: client?.id ?? null,
        source: 'WEB',
        payloadJson: JSON.stringify({ test: true }),
        status: 'NEW',
        idempotencyKey: request.idempotencyKey,
        externalId: null,
        errorCode: null,
        errorMessage: null,
        createdAt: ctx.clock(),
        updatedAt: ctx.clock(),
      },
      client,
    });
    return { request, response };
  }
  if (path.endsWith('/cancel')) {
    const bookings = await ctx.repos.bookings.list({ status: 'CONFIRMED' });
    const target = bookings.find((b) => b.externalId);
    if (!target?.externalId) {
      throw new DomainError('VALIDATION', 'Нет подтверждённой записи с externalId для теста');
    }
    const request = { method: 'POST', externalId: target.externalId };
    const response = await onec.cancelBooking(target.externalId);
    return { request, response };
  }
  if (path.endsWith('/reschedule')) {
    const bookings = await ctx.repos.bookings.list({ status: 'CONFIRMED' });
    const target = bookings.find((b) => b.externalId);
    const slots = await ctx.repos.schedule.listSlots(ctx.clock());
    const free = slots.find((s) => s.bookedCount < s.capacity);
    if (!target?.externalId || !free) {
      throw new DomainError('VALIDATION', 'Нет данных (запись + свободный слот) для теста');
    }
    const request = { method: 'POST', externalId: target.externalId, slotId: free.id };
    const response = await onec.rescheduleBooking(target.externalId, free);
    return { request, response };
  }
  if (path.endsWith('/bookings')) {
    const slots = await ctx.repos.schedule.listSlots(ctx.clock());
    const free = slots.find((s) => s.bookedCount < s.capacity);
    const client = (await ctx.repos.clients.list()).find((c) => c.active);
    if (!free || !client) {
      throw new DomainError(
        'VALIDATION',
        'Нет данных (свободный слот + активный клиент) для теста',
      );
    }
    const idempotencyKey = `test-${randomUUID()}`;
    const request = { method: 'POST', idempotencyKey, slotId: free.id, clientId: client.id };
    const response = await onec.createBooking({
      booking: {
        id: 'test-booking',
        externalId: null,
        clientId: client.id,
        serviceId: free.serviceId,
        specialistId: free.specialistId,
        scheduleSlotId: free.id,
        slotStart: free.startAt,
        slotEnd: free.endAt,
        status: 'PENDING',
        idempotencyKey,
        errorCode: null,
        createdAt: ctx.clock(),
        updatedAt: ctx.clock(),
      },
      slot: free,
      client,
    });
    return { request, response };
  }

  throw new DomainError('VALIDATION', `Тестовый запрос для ${endpoint.method} ${path} не настроен`);
}

function validateEndpoint(input: EndpointInput, required: boolean): void {
  if (required) {
    if (!input.name?.trim() || !input.method || !input.path?.trim() || !input.direction) {
      throw new DomainError('VALIDATION', 'name, method, path и direction обязательны');
    }
  }
  if (input.method && !(HTTP_METHODS as readonly string[]).includes(input.method)) {
    throw new DomainError('VALIDATION', `Недопустимый method: ${input.method}`);
  }
  if (input.direction && !(ENDPOINT_DIRECTIONS as readonly string[]).includes(input.direction)) {
    throw new DomainError('VALIDATION', `Недопустимый direction: ${input.direction}`);
  }
  if (input.status && !(ENDPOINT_STATUSES as readonly string[]).includes(input.status)) {
    throw new DomainError('VALIDATION', `Недопустимый status: ${input.status}`);
  }
  for (const key of ['payloadSchema', 'responseSchema'] as const) {
    const value = input[key];
    if (value !== undefined) {
      try {
        JSON.parse(value);
      } catch {
        throw new DomainError('VALIDATION', `${key} должен быть валидным JSON`);
      }
    }
  }
}
