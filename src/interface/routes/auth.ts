import type { FastifyPluginAsync } from 'fastify';
import { login, me } from '../../application/auth';
import type { JwtPayload } from '../app';
import { parseInput } from '../http';
import { loginSchema } from '../schemas';

/** Аутентификация и здоровье сервиса. */
export const registerAuthRoutes: FastifyPluginAsync = async (app) => {
  app.post('/auth/login', async (req) => {
    const input = parseInput(loginSchema, req.body);
    const ctx = app.requestCtx(req);
    const user = await login(ctx, input.email, input.password);
    const token = app.signToken({ sub: user.id, email: user.email, role: user.role });
    return { token, user };
  });

  app.get('/auth/me', async (req) => {
    const payload = req.user as unknown as JwtPayload;
    return me(app.requestCtx(req), payload.sub);
  });

  app.get('/health', async () => ({
    status: 'ok',
    mode: app.adapterHolder.get().mode,
    time: new Date().toISOString(),
  }));
};
