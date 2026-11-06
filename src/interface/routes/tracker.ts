import type { FastifyPluginAsync } from 'fastify';
import { DomainError } from '../../domain/errors';
import { createFeature, listFeatures, updateFeature } from '../../application/features';
import { createTask, listTasks, updateTask } from '../../application/tasks';
import { createEstimate, listEstimates } from '../../application/estimates';
import { parseInput } from '../http';
import {
  estimateCreateSchema,
  featureCreateSchema,
  featureUpdateSchema,
  listQuerySchema,
  taskCreateSchema,
  taskUpdateSchema,
} from '../schemas';

/** Фичи, задачи интеграции и оценки. */
export const registerTrackerRoutes: FastifyPluginAsync = async (app) => {
  const writeGuard = { preHandler: [app.requireRole('INTEGRATOR')] };

  // --- Features -------------------------------------------------------------
  app.get('/features', async (req) => {
    const q = parseInput(listQuerySchema, req.query);
    return listFeatures(app.requestCtx(req), q);
  });

  app.get('/features/:id', async (req) => {
    const { id } = req.params as { id: string };
    const features = await listFeatures(app.requestCtx(req));
    const feature = features.find((f) => f.id === id);
    if (!feature) {
      throw new DomainError('NOT_FOUND', `Фича ${id} не найдена`);
    }
    return feature;
  });

  app.post('/features', writeGuard, async (req, reply) => {
    const input = parseInput(featureCreateSchema, req.body);
    const feature = await createFeature(app.requestCtx(req), input);
    reply.code(201);
    return feature;
  });

  app.patch('/features/:id', writeGuard, async (req) => {
    const { id } = req.params as { id: string };
    const input = parseInput(featureUpdateSchema, req.body);
    return updateFeature(app.requestCtx(req), id, input);
  });

  // --- Tasks ----------------------------------------------------------------
  app.get('/tasks', async (req) => {
    const q = parseInput(listQuerySchema, req.query);
    return listTasks(app.requestCtx(req), { featureId: q.featureId, status: q.status });
  });

  app.post('/tasks', writeGuard, async (req, reply) => {
    const input = parseInput(taskCreateSchema, req.body);
    const task = await createTask(app.requestCtx(req), input);
    reply.code(201);
    return task;
  });

  app.patch('/tasks/:id', writeGuard, async (req) => {
    const { id } = req.params as { id: string };
    const input = parseInput(taskUpdateSchema, req.body);
    return updateTask(app.requestCtx(req), id, input);
  });

  // --- Estimates ------------------------------------------------------------
  app.get('/estimates', async (req) => {
    const q = parseInput(listQuerySchema, req.query);
    return listEstimates(app.requestCtx(req), { featureId: q.featureId });
  });

  app.post('/estimates', writeGuard, async (req, reply) => {
    const input = parseInput(estimateCreateSchema, req.body);
    const estimate = await createEstimate(app.requestCtx(req), input);
    reply.code(201);
    return estimate;
  });
};
