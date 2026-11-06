import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { Role } from '../domain/entities/index';
import { DomainError, isDomainError } from '../domain/errors';
import type { OneCClient, OneCMode } from '../domain/ports/onec';
import type { AppContext, Actor } from '../application/context';
import { systemActor, withRequest } from '../application/context';
import { shouldLogErrorCode } from '../application/errors';
import type { Env } from '../config/env';
import { createOneCClient } from '../infrastructure/onec/factory';
import { prisma } from '../infrastructure/db/prisma';
import { createRepos, type Repos } from '../infrastructure/db/repos';
import { RetryQueue } from '../infrastructure/queue/retryQueue';
import type { RetryPolicy } from '../domain/rules/retryPolicy';
import { isZodError, statusForErrorCode } from './http';
import { registerAuthRoutes } from './routes/auth';
import { registerTrackerRoutes } from './routes/tracker';
import { registerIntegrationRoutes } from './routes/integration';
import { registerOperationRoutes } from './routes/operations';
import { registerMetaRoutes } from './routes/meta';

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyInstance {
    baseCtx: AppContext;
    appEnv: Env;
    repos: Repos;
    adapterHolder: { get(): OneCClient; set(client: OneCClient): void };
    requestCtx(req: FastifyRequest): AppContext;
    authenticate: (req: FastifyRequest) => Promise<void>;
    requireRole: (...roles: Role[]) => (req: FastifyRequest) => Promise<void>;
    verifyWebhookAuth(req: FastifyRequest): void;
    signToken(payload: JwtPayload): string;
    swapAdapter(mode: OneCMode): void;
  }
  interface FastifyRequest {
    rawBody?: Buffer;
    ctx?: AppContext;
  }
}

export interface BuildAppOptions {
  env: Env;
  /** Отключить логи (тесты). */
  quiet?: boolean;
  /** Политика ретраев (в тестах — минимальные задержки). */
  retryPolicy?: RetryPolicy;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { env } = options;

  const app = Fastify({
    genReqId: () => randomUUID(),
    logger: options.quiet
      ? false
      : {
          level: env.LOG_LEVEL,
          ...(env.NODE_ENV === 'development'
            ? {
                transport: {
                  target: 'pino-pretty',
                  options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
                },
              }
            : {}),
        },
    bodyLimit: 1024 * 1024,
  });

  // --- инфраструктура -----------------------------------------------------
  const repos = createRepos(prisma);
  const logger = app.log;
  const adapterHolder = {
    current: createOneCClient(env, logger),
    get(): OneCClient {
      return this.current;
    },
    set(client: OneCClient) {
      this.current = client;
    },
  };

  const retryQueue = new RetryQueue({
    policy: options.retryPolicy,
    onExhausted: async (info) => {
      if (!shouldLogErrorCode(info.error.code)) return;
      const details = (info.error.details ?? {}) as { rawCode?: string };
      try {
        await repos.errors.create({
          context: info.meta?.context ?? info.name,
          errorCode: info.error.code,
          rawCode: String(details.rawCode ?? ''),
          message: info.error.message,
          payloadJson: info.meta?.payloadJson ?? '{}',
          retryCount: info.retries,
          status: 'FAILED',
          correlationId: info.meta?.correlationId ?? null,
        });
      } catch (err) {
        logger.error({ err }, 'не удалось записать ErrorLog');
      }
    },
  });

  const baseCtx: AppContext = {
    repos,
    adapter: adapterHolder,
    retry: retryQueue,
    clock: () => new Date(),
    actor: systemActor(),
  };

  // --- контекст запроса ---------------------------------------------------
  function actorOf(req: FastifyRequest): Actor | undefined {
    const payload = req.user as unknown as JwtPayload | undefined;
    if (!payload?.sub) return undefined;
    return { id: payload.sub, email: payload.email, role: payload.role };
  }

  app.decorate('baseCtx', baseCtx);
  app.decorate('appEnv', env);
  app.decorate('repos', repos);
  app.decorate('adapterHolder', adapterHolder);
  app.decorate('requestCtx', (req: FastifyRequest): AppContext => {
    const ctx = withRequest(baseCtx, {
      correlationId: String(req.id),
      actor: actorOf(req),
    });
    req.ctx = ctx;
    return ctx;
  });
  app.decorate('signToken', (payload: JwtPayload): string => app.jwt.sign(payload));
  app.decorate('swapAdapter', (mode: OneCMode) => {
    adapterHolder.set(createOneCClient({ ...env, ONEC_MODE: mode }, logger));
  });

  app.decorate('authenticate', async (req: FastifyRequest): Promise<void> => {
    try {
      await req.jwtVerify();
    } catch {
      throw new DomainError('UNAUTHORIZED', 'Требуется авторизация (JWT)');
    }
  });
  app.decorate('requireRole', (...roles: Role[]) => async (req: FastifyRequest) => {
    const payload = req.user as unknown as JwtPayload | undefined;
    if (!payload?.role) {
      throw new DomainError('UNAUTHORIZED', 'Требуется авторизация (JWT)');
    }
    if (!roles.includes(payload.role) && payload.role !== 'ADMIN') {
      throw new DomainError(
        'FORBIDDEN',
        `Недостаточно прав: требуется роль ${roles.join(' | ')} (ваша: ${payload.role})`,
      );
    }
  });

  // --- плагины ------------------------------------------------------------
  const rawBodyParser = function (
    _req: FastifyRequest,
    body: Buffer,
    done: (err: Error | null, result?: unknown) => void,
  ): void {
    try {
      const parsed = body.length ? JSON.parse(body.toString('utf8')) : {};
      done(null, parsed);
    } catch (err) {
      done(err as Error);
    }
  };

  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    req.rawBody = body as Buffer;
    rawBodyParser(req, body as Buffer, done);
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-webhook-signature',
      'x-webhook-token',
      'x-correlation-id',
    ],
  });

  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: () => ({
      error: { code: 'RATE_LIMITED', message: 'Слишком много запросов, попробуйте позже' },
    }),
  });

  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: '12h' },
  });

  // --- correlation-id в ответе --------------------------------------------
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-correlation-id', String(req.id));
  });

  // --- глобальная авторизация /api (публичные маршруты — в белом списке) ---
  const PUBLIC_PATHS = new Set(['/api/auth/login', '/api/health', '/api/webhooks/1c']);
  app.addHook('onRequest', async (req) => {
    if (req.method === 'OPTIONS') return;
    const pathname = req.url.split('?')[0] ?? req.url;
    if (!pathname.startsWith('/api/') || PUBLIC_PATHS.has(pathname)) return;
    await app.authenticate(req);
  });

  // --- обработка ошибок ----------------------------------------------------
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const correlationId = String(req.id);
    if (isDomainError(err)) {
      const status = statusForErrorCode(err.code);
      if (status >= 500) req.log.error({ err, correlationId }, 'domain error');
      reply.code(status).send({
        error: { code: err.code, message: err.message, details: err.details, correlationId },
      });
      return;
    }
    if (isZodError(err)) {
      reply.code(400).send({
        error: {
          code: 'VALIDATION',
          message: 'Ошибка валидации запроса',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          correlationId,
        },
      });
      return;
    }
    const status = err.statusCode ?? 500;
    if (status < 500) {
      reply.code(status).send({
        error: {
          code: err.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'VALIDATION',
          message: err.message,
          correlationId,
        },
      });
      return;
    }
    req.log.error({ err, correlationId }, 'unhandled error');
    reply.code(500).send({
      error: { code: 'INTERNAL', message: 'Внутренняя ошибка сервера', correlationId },
    });
  });

  // --- маршруты ------------------------------------------------------------
  await app.register(registerAuthRoutes, { prefix: '/api' });
  await app.register(registerTrackerRoutes, { prefix: '/api' });
  await app.register(registerIntegrationRoutes, { prefix: '/api' });
  await app.register(registerOperationRoutes, { prefix: '/api' });
  await app.register(registerMetaRoutes, { prefix: '/api' });

  // --- webhook-подпись (проверка секрета) -----------------------------------
  app.decorate('verifyWebhookAuth', (req: FastifyRequest): void => {
    // Путь 1: валидный JWT — авторизованный пользователь Webhook Console.
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const payload = app.jwt.verify(authHeader.slice(7));
        if (payload) return;
      } catch {
        // невалидный требование — проверяем подпись ниже
      }
    }

    // Путь 2: HMAC-подпись или секрет — для внешних отправителей (1С, ИИ-ассистент).
    const raw = req.rawBody;
    if (!raw) {
      throw new DomainError('UNAUTHORIZED', 'Отсутствует тело запроса для проверки подписи');
    }
    const secret = env.WEBHOOK_SECRET;
    const signature = req.headers['x-webhook-signature'];
    const token = req.headers['x-webhook-token'];
    const expected = createHmac('sha256', secret).update(raw).digest('hex');

    const signatureOk =
      typeof signature === 'string' &&
      signature.length === expected.length &&
      timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    const tokenOk =
      typeof token === 'string' &&
      token.length === secret.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(secret));

    if (!signatureOk && !tokenOk) {
      throw new DomainError(
        'UNAUTHORIZED',
        'Неверная подпись (x-webhook-signature) или секрет (x-webhook-token)',
      );
    }
  });

  // --- статика UI + OpenAPI -------------------------------------------------
  const uiDist = path.resolve(process.cwd(), 'ui/dist');
  const hasUi = existsSync(path.join(uiDist, 'index.html'));
  if (hasUi) {
    await app.register(fastifyStatic, { root: uiDist, prefix: '/' });
  }

  app.get('/openapi.yaml', async (_req, reply) => {
    const specPath = path.resolve(process.cwd(), 'docs/openapi.yaml');
    if (!existsSync(specPath)) {
      reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Сгенерируйте спеку: npm run openapi' } };
    }
    reply.type('application/yaml');
    return readFileSync(specPath, 'utf8');
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      reply.code(404).send({
        error: { code: 'NOT_FOUND', message: `Маршрут не найден: ${req.method} ${req.url}` },
      });
      return;
    }
    if (hasUi) {
      reply.type('text/html');
      reply.send(readFileSync(path.join(uiDist, 'index.html')));
      return;
    }
    reply.code(404).send({
      error: { code: 'NOT_FOUND', message: `Маршрут не найден: ${req.method} ${req.url}` },
    });
  });

  return app;
}
