import type { FastifyPluginAsync } from 'fastify';
import {
  cancelBooking,
  createBooking,
  listBookings,
  rescheduleBooking,
} from '../../application/bookings';
import { listErrors, retryError } from '../../application/errorLog';
import { DomainError } from '../../domain/errors';
import { parseInput } from '../http';
import { bookingCreateSchema, listQuerySchema, rescheduleSchema } from '../schemas';

/** Записи на занятия и журнал ошибок интеграции. */
export const registerOperationRoutes: FastifyPluginAsync = async (app) => {
  const writeGuard = { preHandler: [app.requireRole('INTEGRATOR')] };

  // --- Bookings -------------------------------------------------------------
  app.get('/bookings', async (req) => {
    const q = parseInput(listQuerySchema, req.query);
    return listBookings(app.requestCtx(req), { status: q.status });
  });

  app.get('/bookings/:id', async (req) => {
    const { id } = req.params as { id: string };
    const booking = await app.requestCtx(req).repos.bookings.byId(id);
    if (!booking) throw new DomainError('BOOKING_NOT_FOUND', `Запись ${id} не найдена`);
    return booking;
  });

  app.post('/bookings', writeGuard, async (req, reply) => {
    const input = parseInput(bookingCreateSchema, req.body);
    const result = await createBooking(app.requestCtx(req), input);
    reply.code(result.duplicate ? 200 : 201);
    return result;
  });

  /**
   * PATCH — ограниченные правки записи (привязка к клиенту, снятие errorCode).
   * Смена статуса только через /cancel и /reschedule (бизнес-правила).
   */
  app.patch('/bookings/:id', writeGuard, async (req) => {
    const { id } = req.params as { id: string };
    const ctx = app.requestCtx(req);
    const body = (req.body ?? {}) as { clientId?: string; clearError?: boolean };
    const booking = await ctx.repos.bookings.byId(id);
    if (!booking) throw new DomainError('BOOKING_NOT_FOUND', `Запись ${id} не найдена`);

    const data: Record<string, unknown> = {};
    if (body.clientId !== undefined) {
      const client = await ctx.repos.clients.byId(body.clientId);
      if (!client) throw new DomainError('NOT_FOUND', `Клиент ${body.clientId} не найден`);
      data.clientId = client.id;
    }
    if (body.clearError) data.errorCode = null;
    if (Object.keys(data).length === 0) {
      throw new DomainError('VALIDATION', 'Нет изменений (доступны clientId, clearError)');
    }
    return ctx.repos.bookings.update(id, data);
  });

  app.post('/bookings/:id/cancel', writeGuard, async (req) => {
    const { id } = req.params as { id: string };
    return cancelBooking(app.requestCtx(req), id);
  });

  app.post('/bookings/:id/reschedule', writeGuard, async (req) => {
    const { id } = req.params as { id: string };
    const input = parseInput(rescheduleSchema, req.body);
    return rescheduleBooking(app.requestCtx(req), id, input);
  });

  // --- Errors ---------------------------------------------------------------
  app.get('/errors', async (req) => {
    const q = parseInput(listQuerySchema, req.query);
    return listErrors(app.requestCtx(req), { status: q.status, context: q.context });
  });

  app.post('/errors/:id/retry', writeGuard, async (req) => {
    const { id } = req.params as { id: string };
    return retryError(app.requestCtx(req), id);
  });
};
