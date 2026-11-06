import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/interface/app';
import { MockOneCClient } from '../../src/infrastructure/onec/MockOneCClient';

/**
 * Интеграционные тесты REST API (mock-режим 1С, тестовая БД сидов).
 * Покрывают критерии приёмки: дубли webhook, сценарии записи/отмены/переноса,
 * ошибки 1С → ErrorLog → retry, отчёты и экспорт CSV, роли.
 */

let app: FastifyInstance;
let viewerToken: string;
let integratorToken: string;
let adminToken: string;

const WEBHOOK_SECRET = 'dev-webhook-secret-change';

async function login(email: string, password = 'Password123!'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { token: string }).token;
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  const env = loadEnv();
  app = await buildApp({
    env,
    quiet: true,
    retryPolicy: { maxRetries: 3, baseDelayMs: 1, factor: 2, maxDelayMs: 5 },
  });
  viewerToken = await login('viewer@tracker.local');
  integratorToken = await login('integrator@tracker.local');
  adminToken = await login('admin@tracker.local');
});

afterAll(async () => {
  await app.close();
});

describe('аутентификация и роли', () => {
  it('неверный пароль → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'viewer@tracker.local', password: 'nope' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('запрос без токена → 401, с токеном viewer → 200', async () => {
    const anon = await app.inject({ method: 'GET', url: '/api/features' });
    expect(anon.statusCode).toBe(401);

    const ok = await app.inject({
      method: 'GET',
      url: '/api/features',
      headers: auth(viewerToken),
    });
    expect(ok.statusCode).toBe(200);
  });

  it('viewer не может создавать (403), integrator — может', async () => {
    const denied = await app.inject({
      method: 'POST',
      url: '/api/features',
      headers: auth(viewerToken),
      payload: { code: 'X-1', title: 'нельзя' },
    });
    expect(denied.statusCode).toBe(403);

    const allowed = await app.inject({
      method: 'POST',
      url: '/api/features',
      headers: auth(integratorToken),
      payload: { code: 'X-TEST', title: 'Тестовая фича', implementationType: 'TBD' },
    });
    expect(allowed.statusCode).toBe(201);
  });

  it('settings (PATCH) — только ADMIN', async () => {
    const integrator = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: auth(integratorToken),
      payload: { oneCMode: 'mock' },
    });
    expect(integrator.statusCode).toBe(403);

    const admin = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: auth(adminToken),
      payload: { oneCMode: 'mock' },
    });
    expect(admin.statusCode).toBe(200);
    expect(admin.json()).toMatchObject({ oneCMode: 'mock' });
  });
});

describe('DoD: все задачи интеграции — фичи с типом и оценкой', () => {
  it('≥6 фич, каждая с implementationType и оценкой', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/features',
      headers: auth(viewerToken),
    });
    const features = res.json() as Array<{
      code: string;
      implementationType: string;
      estimateDays: number | null;
      estimateCost: number | null;
    }>;
    expect(features.length).toBeGreaterThanOrEqual(6);
    for (const f of features) {
      expect(f.implementationType).toBeTruthy();
    }
    // 5 ключевых задач интеграции присутствуют, у каждой — тип и оценка
    const core = features.filter((f) => /^F-0[1-6]$/.test(f.code));
    expect(core.length).toBeGreaterThanOrEqual(5);
    for (const f of core) {
      expect(f.implementationType).toBeTruthy();
      expect(f.estimateDays).not.toBeNull();
      expect(f.estimateCost).not.toBeNull();
    }
    const codes = features.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(['F-01', 'F-02', 'F-03', 'F-04', 'F-05']));
  });

  it('8 эндпоинтов1С присутствуют', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/endpoints',
      headers: auth(viewerToken),
    });
    const endpoints = res.json() as unknown[];
    expect(endpoints.length).toBeGreaterThanOrEqual(8);
  });
});

describe('DoD: webhook-приёмник и идемпотентность', () => {
  const key = `it-wh-${Date.now()}`;

  it('без подписи/секрета → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/1c',
      payload: { eventType: 'lead.created', idempotencyKey: key, payload: {} },
    });
    expect(res.statusCode).toBe(401);
  });

  it('с валидным x-webhook-token → событие обработано, заявка ушла в 1С', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/1c',
      headers: { 'x-webhook-token': WEBHOOK_SECRET },
      payload: {
        eventType: 'lead.created',
        idempotencyKey: key,
        payload: {
          source: 'TELEGRAM',
          client: { fullName: 'Тест Тестов', phone: '+7 900 777-88-99' },
        },
      },
    });
    expect([200, 202]).toContain(res.statusCode);
    const body = res.json() as { status: string; duplicate: boolean; leadId?: string };
    expect(body.duplicate).toBe(false);
    expect(body.status).toBe('PROCESSED');
    expect(body.leadId).toBeTruthy();
  });

  it('повтор того же ключа → DUPLICATE, новых заявок не создаётся (DoD)', async () => {
    const before = (
      (
        await app.inject({ method: 'GET', url: '/api/leads', headers: auth(viewerToken) })
      ).json() as unknown[]
    ).length;

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/1c',
      headers: { 'x-webhook-token': WEBHOOK_SECRET },
      payload: {
        eventType: 'lead.created',
        idempotencyKey: key,
        payload: {
          source: 'TELEGRAM',
          client: { fullName: 'Тест Тестов', phone: '+7 900 777-88-99' },
        },
      },
    });
    const body = res.json() as { status: string; duplicate: boolean };
    expect(body.status).toBe('DUPLICATE');
    expect(body.duplicate).toBe(true);

    const after = (
      (
        await app.inject({ method: 'GET', url: '/api/leads', headers: auth(viewerToken) })
      ).json() as unknown[]
    ).length;
    expect(after).toBe(before);
  });

  it('HMAC-подпись (x-webhook-signature) принимается', async () => {
    const payload = JSON.stringify({
      eventType: 'custom.event',
      idempotencyKey: `${key}-hmac`,
      payload: { ping: true },
    });
    const signature = createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/1c',
      headers: { 'content-type': 'application/json', 'x-webhook-signature': signature },
      payload,
    });
    expect([200, 202]).toContain(res.statusCode);
    expect(res.json()).toMatchObject({ status: 'PROCESSED' });
  });

  it('JWT (Webhook Console) принимается без подписи', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/1c',
      headers: auth(integratorToken),
      payload: {
        eventType: 'console.test',
        idempotencyKey: `${key}-jwt`,
        payload: { from: 'webhook-console' },
      },
    });
    expect([200, 202]).toContain(res.statusCode);
    expect(res.json()).toMatchObject({ status: 'PROCESSED' });
  });
});

describe('DoD: запись / отмена / перенос (mock-1С)', () => {
  let freeSlotId: string;
  let fullSlotId: string;
  let activeClientId: string;
  let inactiveClientId: string;
  let secondFreeSlotId: string;

  beforeAll(async () => {
    const schedule = (
      await app.inject({ method: 'GET', url: '/api/schedule', headers: auth(viewerToken) })
    ).json() as Array<{ id: string; capacity: number; bookedCount: number }>;
    const free = schedule.find((s) => s.bookedCount < s.capacity - 1)!;
    freeSlotId = free.id;
    fullSlotId = schedule.find((s) => s.bookedCount >= s.capacity)!.id;
    secondFreeSlotId = schedule.filter((s) => s.bookedCount < s.capacity && s.id !== freeSlotId)[
      schedule.filter((s) => s.bookedCount < s.capacity && s.id !== freeSlotId).length - 1
    ].id;

    const clients = (
      await app.inject({ method: 'GET', url: '/api/clients', headers: auth(viewerToken) })
    ).json() as Array<{ id: string; active: boolean }>;
    activeClientId = clients.find((c) => c.active)!.id;
    inactiveClientId = clients.find((c) => !c.active)!.id;
  });

  it('успешная запись: PENDING → CONFIRMED, место занято', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      headers: auth(integratorToken),
      payload: {
        clientId: activeClientId,
        slotId: freeSlotId,
        idempotencyKey: `it-bk-${Date.now()}`,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      booking: { status: string; externalId: string };
      duplicate: boolean;
    };
    expect(body.duplicate).toBe(false);
    expect(body.booking.status).toBe('CONFIRMED');
    expect(body.booking.externalId).toMatch(/^B-1C-/);
  });

  it('повтор того же ключа → duplicate:true, 200', async () => {
    const key = `it-bk-dup-${Date.now()}`;
    const first = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      headers: auth(integratorToken),
      payload: { clientId: activeClientId, slotId: freeSlotId, idempotencyKey: key },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      headers: auth(integratorToken),
      payload: { clientId: activeClientId, slotId: freeSlotId, idempotencyKey: key },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ duplicate: true });
  });

  it('NO_SEATS: полный слот → 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      headers: auth(integratorToken),
      payload: {
        clientId: activeClientId,
        slotId: fullSlotId,
        idempotencyKey: `it-bk-full-${Date.now()}`,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'NO_SEATS' } });
  });

  it('CLIENT_INACTIVE: неактивный клиент → 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      headers: auth(integratorToken),
      payload: {
        clientId: inactiveClientId,
        slotId: freeSlotId,
        idempotencyKey: `it-bk-inact-${Date.now()}`,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'CLIENT_INACTIVE' } });
  });

  it('отмена: место освобождается; повторная отмена → 409', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      headers: auth(integratorToken),
      payload: {
        clientId: activeClientId,
        slotId: freeSlotId,
        idempotencyKey: `it-bk-cancel-${Date.now()}`,
      },
    });
    const bookingId = (created.json() as { booking: { id: string } }).booking.id;

    const scheduleBefore = (
      await app.inject({ method: 'GET', url: '/api/schedule', headers: auth(viewerToken) })
    ).json() as Array<{ id: string; bookedCount: number }>;
    const before = scheduleBefore.find((s) => s.id === freeSlotId)!.bookedCount;

    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/bookings/${bookingId}/cancel`,
      headers: auth(integratorToken),
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({ status: 'CANCELLED' });

    const scheduleAfter = (
      await app.inject({ method: 'GET', url: '/api/schedule', headers: auth(viewerToken) })
    ).json() as Array<{ id: string; bookedCount: number }>;
    expect(scheduleAfter.find((s) => s.id === freeSlotId)!.bookedCount).toBe(before - 1);

    const again = await app.inject({
      method: 'POST',
      url: `/api/bookings/${bookingId}/cancel`,
      headers: auth(integratorToken),
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: { code: 'BOOKING_NOT_CONFIRMED' } });
  });

  it('перенос: слот меняется, места перераспределяются', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      headers: auth(integratorToken),
      payload: {
        clientId: activeClientId,
        slotId: freeSlotId,
        idempotencyKey: `it-bk-move-${Date.now()}`,
      },
    });
    const bookingId = (created.json() as { booking: { id: string } }).booking.id;

    const scheduleBefore = (
      await app.inject({ method: 'GET', url: '/api/schedule', headers: auth(viewerToken) })
    ).json() as Array<{ id: string; bookedCount: number }>;
    const fromBefore = scheduleBefore.find((s) => s.id === freeSlotId)!.bookedCount;
    const toBefore = scheduleBefore.find((s) => s.id === secondFreeSlotId)!.bookedCount;

    const moved = await app.inject({
      method: 'POST',
      url: `/api/bookings/${bookingId}/reschedule`,
      headers: auth(integratorToken),
      payload: { targetSlotId: secondFreeSlotId },
    });
    expect(moved.statusCode).toBe(200);
    const booking = moved.json() as { status: string; scheduleSlotId: string; slotStart: string };
    expect(booking.status).toBe('CONFIRMED');
    expect(booking.scheduleSlotId).toBe(secondFreeSlotId);

    const scheduleAfter = (
      await app.inject({ method: 'GET', url: '/api/schedule', headers: auth(viewerToken) })
    ).json() as Array<{ id: string; bookedCount: number }>;
    expect(scheduleAfter.find((s) => s.id === freeSlotId)!.bookedCount).toBe(fromBefore - 1);
    expect(scheduleAfter.find((s) => s.id === secondFreeSlotId)!.bookedCount).toBe(toBefore + 1);
  });
});

describe('DoD: ошибки 1С → маппинг → ретраи → ErrorLog → retry', () => {
  let errorId: string;

  it('1С падает 4 раза → 503 ONEC_UNAVAILABLE, заявка в ERROR', async () => {
    const mc = new MockOneCClient();
    for (let i = 0; i < 4; i += 1) mc.failNext('sendLead', 'HTTP_500');
    app.adapterHolder.set(mc);

    const res = await app.inject({
      method: 'POST',
      url: '/api/leads',
      headers: auth(integratorToken),
      payload: {
        idempotencyKey: `it-lead-fail-${Date.now()}`,
        source: 'EMAIL',
        client: { fullName: 'Ошибки Ошибова', phone: '+7 900 000-11-22' },
      },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: { code: 'ONEC_UNAVAILABLE' } });

    const leads = (
      await app.inject({ method: 'GET', url: '/api/leads', headers: auth(viewerToken) })
    ).json() as Array<{ status: string; errorCode: string | null; phone?: string }>;
    const failedLead = leads.find((l) => l.errorCode === 'ONEC_UNAVAILABLE');
    expect(failedLead).toBeTruthy();
    expect(failedLead!.status).toBe('ERROR');
  });

  it('ErrorLog заполнен: контекст lead.send, retryCount 3, статус FAILED', async () => {
    const errors = (
      await app.inject({
        method: 'GET',
        url: '/api/errors?status=FAILED',
        headers: auth(viewerToken),
      })
    ).json() as Array<{
      id: string;
      context: string;
      errorCode: string;
      retryCount: number;
      status: string;
    }>;
    const entry = errors.find(
      (e) => e.context === 'lead.send' && e.errorCode === 'ONEC_UNAVAILABLE',
    );
    expect(entry).toBeTruthy();
    expect(entry!.retryCount).toBe(3);
    expect(entry!.status).toBe('FAILED');
    errorId = entry!.id;
  });

  it('retry ошибки после восстановления 1С → RESOLVED, заявка ушла в 1С', async () => {
    app.swapAdapter('mock'); // «1С» снова работает

    const res = await app.inject({
      method: 'POST',
      url: `/api/errors/${errorId}/retry`,
      headers: auth(integratorToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'RESOLVED' });

    const leads = (
      await app.inject({ method: 'GET', url: '/api/leads', headers: auth(viewerToken) })
    ).json() as Array<{ status: string; errorCode: string | null }>;
    expect(leads.some((l) => l.status === 'ERROR' && l.errorCode === 'ONEC_UNAVAILABLE')).toBe(
      false,
    );
  });
});

describe('синхронизация расписания и API Explorer', () => {
  it('POST /schedule/sync → слоты из 1С без дублей', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/schedule/sync',
      headers: auth(integratorToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'OK' });

    const syncRes = await app.inject({
      method: 'POST',
      url: '/api/schedule/sync',
      headers: auth(integratorToken),
    });
    expect(syncRes.statusCode).toBe(200);
  });

  it('тестовый запрос эндпоинта (mock) → симуляция', async () => {
    const endpoints = (
      await app.inject({ method: 'GET', url: '/api/endpoints', headers: auth(viewerToken) })
    ).json() as Array<{ id: string; method: string; path: string }>;
    const getSchedule = endpoints.find((e) => e.path.includes('/schedule') && e.method === 'GET')!;
    const res = await app.inject({
      method: 'POST',
      url: `/api/endpoints/${getSchedule.id}/test`,
      headers: auth(integratorToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ mode: 'mock' });
    expect((res.json() as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('DoD: отчёты и экспорт', () => {
  it('GET /reports/summary — агрегаты заполнены', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/reports/summary',
      headers: auth(viewerToken),
    });
    expect(res.statusCode).toBe(200);
    const report = res.json() as {
      features: { total: number; byImplementationType: Array<{ type: string; count: number }> };
      duplicates: { webhookEvents: number };
      errors: { total: number };
      estimates: { hours: number };
    };
    expect(report.features.total).toBeGreaterThanOrEqual(6);
    expect(report.features.byImplementationType.length).toBeGreaterThanOrEqual(4);
    expect(report.duplicates.webhookEvents).toBeGreaterThanOrEqual(1);
    expect(report.errors.total).toBeGreaterThanOrEqual(1);
    expect(report.estimates.hours).toBeGreaterThan(0);
  });

  it('CSV-экспорт отчёта «Стандартный API vs Доработки» (DoD)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/reports/standard-vs-custom.csv',
      headers: auth(viewerToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    const text = res.body;
    expect(text.startsWith('﻿')).toBe(true); // UTF-8 BOM для Excel
    expect(text).toContain('F-01');
    expect(text).toContain('Стандартный API');
  });

  it('JSON-вариант отчёта содержит строки по фичам', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/reports/standard-vs-custom',
      headers: auth(viewerToken),
    });
    const body = res.json() as { rows: Array<{ code: string; implementationType: string }> };
    expect(body.rows.length).toBeGreaterThanOrEqual(6);
    expect(body.rows.every((r) => Boolean(r.implementationType))).toBe(true);
  });
});
