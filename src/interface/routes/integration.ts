import type { FastifyPluginAsync } from 'fastify';
import {
  createEndpoint,
  listEndpoints,
  sendTestRequest,
  updateEndpoint,
} from '../../application/endpoints';
import { ingestLead, listLeads } from '../../application/leads';
import { listWebhooks, processWebhook, reprocessWebhookEvent } from '../../application/webhooks';
import {
  assertValidDate,
  listSchedule,
  listServices,
  listSpecialists,
  syncSchedule,
} from '../../application/schedule';
import { parseInput } from '../http';
import {
  clientCreateSchema,
  endpointCreateSchema,
  endpointUpdateSchema,
  leadCreateSchema,
  listQuerySchema,
  webhookCreateSchema,
} from '../schemas';

/** Интеграционный слой: API Explorer, Webhook Console, заявки, расписание. */
export const registerIntegrationRoutes: FastifyPluginAsync = async (app) => {
  const writeGuard = { preHandler: [app.requireRole('INTEGRATOR')] };

  // --- Api endpoints --------------------------------------------------------
  app.get('/endpoints', async (req) => {
    const q = parseInput(listQuerySchema, req.query);
    return listEndpoints(app.requestCtx(req), { direction: q.direction, status: q.status });
  });

  app.post('/endpoints', writeGuard, async (req, reply) => {
    const input = parseInput(endpointCreateSchema, req.body);
    const endpoint = await createEndpoint(app.requestCtx(req), input);
    reply.code(201);
    return endpoint;
  });

  app.patch('/endpoints/:id', writeGuard, async (req) => {
    const { id } = req.params as { id: string };
    const input = parseInput(endpointUpdateSchema, req.body);
    return updateEndpoint(app.requestCtx(req), id, input);
  });

  app.post('/endpoints/:id/test', writeGuard, async (req) => {
    const { id } = req.params as { id: string };
    return sendTestRequest(app.requestCtx(req), id);
  });

  // --- Webhooks -------------------------------------------------------------
  app.get('/webhooks', async (req) => {
    const q = parseInput(listQuerySchema, req.query);
    return listWebhooks(app.requestCtx(req), q.limit ?? 100);
  });

  /**
   * Приём событий от 1С/ИИ-ассистента (публичный, но защищён):
   * rate-limit + проверка подписи/секрета + идемпотентность (→ DUPLICATE).
   */
  app.post(
    '/webhooks/1c',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      preHandler: [async (req) => app.verifyWebhookAuth(req)],
    },
    async (req, reply) => {
      const input = parseInput(webhookCreateSchema, req.body);
      const result = await processWebhook(app.requestCtx(req), {
        source: input.source,
        eventType: input.eventType,
        payload: input.payload,
        idempotencyKey: input.idempotencyKey,
      });
      reply.code(result.status === 'FAILED' ? 200 : 202);
      return result;
    },
  );

  app.post('/webhooks/:id/reprocess', writeGuard, async (req) => {
    const { id } = req.params as { id: string };
    return reprocessWebhookEvent(app.requestCtx(req), id);
  });

  // --- Leads ----------------------------------------------------------------
  app.get('/leads', async (req) => {
    const q = parseInput(listQuerySchema, req.query);
    return listLeads(app.requestCtx(req), q.limit ?? 100);
  });

  app.post('/leads', writeGuard, async (req, reply) => {
    const input = parseInput(leadCreateSchema, req.body);
    const result = await ingestLead(app.requestCtx(req), input);
    reply.code(result.duplicate ? 200 : 201);
    return result;
  });

  // --- Schedule / catalog ---------------------------------------------------
  app.get('/schedule', async (req) => {
    const q = parseInput(listQuerySchema, req.query);
    assertValidDate(q.from, 'from');
    assertValidDate(q.to, 'to');
    return listSchedule(app.requestCtx(req), {
      from: q.from,
      to: q.to,
      serviceCode: q.serviceCode,
      specialistCode: q.specialistCode,
    });
  });

  app.post('/schedule/sync', writeGuard, async (req) => {
    const result = await syncSchedule(app.requestCtx(req));
    return result;
  });

  app.get('/services', async (req) => listServices(app.requestCtx(req)));

  app.get('/specialists', async (req) => listSpecialists(app.requestCtx(req)));

  app.get('/clients', async (req) => {
    const ctx = app.requestCtx(req);
    const clients = await ctx.repos.clients.list();
    if (req.query && typeof req.query === 'object' && 'phone' in req.query) {
      const phone = String((req.query as { phone?: string }).phone ?? '');
      return clients.filter((c) => c.phone.includes(phone));
    }
    return clients;
  });

  app.post('/clients', writeGuard, async (req, reply) => {
    const ctx = app.requestCtx(req);
    const body = parseInput(clientCreateSchema, req.body);
    const existing = await ctx.repos.clients.byPhone(body.phone);
    if (existing) {
      reply.code(200);
      return { client: existing, duplicate: true };
    }
    const client = await ctx.repos.clients.create({
      externalId: null,
      fullName: body.fullName,
      phone: body.phone,
      email: body.email ?? '',
      active: true,
    });
    reply.code(201);
    return { client, duplicate: false };
  });
};
