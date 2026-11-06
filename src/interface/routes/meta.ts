import type { FastifyPluginAsync } from 'fastify';
import {
  IMPLEMENTATION_TYPE_LABELS,
  standardVsCustom,
  standardVsCustomCsv,
  summary,
} from '../../application/reports';
import { getSettings, listUsers, setOneCMode } from '../../application/settings';
import { parseInput } from '../http';
import { settingsPatchSchema } from '../schemas';
import { createOneCClient } from '../../infrastructure/onec/factory';

/** Отчёты, настройки, пользователи. */
export const registerMetaRoutes: FastifyPluginAsync = async (app) => {
  // --- Reports --------------------------------------------------------------
  app.get('/reports/summary', async (req) => summary(app.requestCtx(req)));

  app.get('/reports/standard-vs-custom', async (req) => {
    const rows = await standardVsCustom(app.requestCtx(req));
    return { labels: IMPLEMENTATION_TYPE_LABELS, rows };
  });

  app.get('/reports/standard-vs-custom.csv', async (req, reply) => {
    const csv = await standardVsCustomCsv(app.requestCtx(req));
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="standard-vs-custom.csv"');
    return csv;
  });

  // --- Settings -------------------------------------------------------------
  app.get('/settings', { preHandler: [app.requireRole('INTEGRATOR')] }, async () =>
    getSettings(app.appEnv),
  );

  app.patch('/settings', { preHandler: [app.requireRole('ADMIN')] }, async (req) => {
    const input = parseInput(settingsPatchSchema, req.body);
    const ctx = app.requestCtx(req);
    return setOneCMode(ctx, app.appEnv, input.oneCMode, (mode) =>
      createOneCClient({ ...app.appEnv, ONEC_MODE: mode }, app.log),
    );
  });

  // --- Users ----------------------------------------------------------------
  app.get('/users', { preHandler: [app.requireRole('ADMIN')] }, async (req) =>
    listUsers(await app.requestCtx(req).repos.users.list()),
  );
};
