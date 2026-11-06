import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { stringify } from 'yaml';
import {
  bookingCreateSchema,
  clientCreateSchema,
  endpointCreateSchema,
  estimateCreateSchema,
  featureCreateSchema,
  leadCreateSchema,
  loginSchema,
  rescheduleSchema,
  settingsPatchSchema,
  taskCreateSchema,
  webhookCreateSchema,
} from './schemas';

/**
 * Генерация OpenAPI 3.1-спеки в docs/openapi.yaml.
 * Схемы тел запросов — из zod (z.toJSONSchema), схемы ответов — components.
 * Запуск: npm run openapi
 */

type Json = Record<string, unknown>;

const obj = (properties: Json, required?: string[]): Json => ({
  type: 'object',
  properties,
  ...(required ? { required } : {}),
});

const str = (description?: string): Json => ({
  type: 'string',
  ...(description ? { description } : {}),
});
const num = (description?: string): Json => ({
  type: 'number',
  ...(description ? { description } : {}),
});
const int = (description?: string): Json => ({
  type: 'integer',
  ...(description ? { description } : {}),
});
const bool = (description?: string): Json => ({
  type: 'boolean',
  ...(description ? { description } : {}),
});
const nullable = (schema: Json): Json => ({ ...schema, nullable: true });

function toJsonSchema(schema: z.ZodType): Json {
  const result = z.toJSONSchema(schema, { io: 'input' }) as Json;
  delete result.$schema;
  return result;
}

function errorResponse(description: string): Json {
  return {
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
  };
}

function jsonResponse(description: string, schema: Json): Json {
  return { description, content: { 'application/json': { schema } } };
}

function csvResponse(description: string): Json {
  return {
    description,
    content: { 'text/csv': { schema: { type: 'string' } } },
  };
}

const ref = (name: string): Json => ({ $ref: `#/components/schemas/${name}` });
const listOf = (name: string): Json => ({ type: 'array', items: ref(name) });

// ---------------------------------------------------------------------------
// Компоненты (схемы ответов)
// ---------------------------------------------------------------------------
const schemas: Json = {
  ErrorResponse: obj(
    {
      error: obj(
        {
          code: str('Внутренний код ошибки (NO_SEATS, VALIDATION, ...)'),
          message: str('Человекочитаемое сообщение'),
          details: { description: 'Детали (для VALIDATION — список проблем)' },
          correlationId: str('ID запроса для трассировки'),
        },
        ['code', 'message'],
      ),
    },
    ['error'],
  ),
  Feature: obj(
    {
      id: str(),
      code: str('Уникальный код фичи, например F-01'),
      title: str(),
      description: str(),
      status: str('PLANNED | IN_PROGRESS | BLOCKED | DONE'),
      implementationType: str('STANDARD_API | EXTENSION | CUSTOM_HTTP_SERVICE | TBD'),
      priority: str('LOW | MEDIUM | HIGH | CRITICAL'),
      estimateDays: nullable(num('Оценка в днях')),
      estimateCost: nullable(num('Оценка в рублях')),
      notes: str(),
      createdAt: str('date-time'),
      updatedAt: str('date-time'),
    },
    ['id', 'code', 'title', 'status', 'implementationType'],
  ),
  IntegrationTask: obj(
    {
      id: str(),
      featureId: str(),
      title: str(),
      status: str('TODO | IN_PROGRESS | BLOCKED | DONE'),
      assigneeId: nullable(str()),
      dueDate: nullable(str('date-time')),
      description: str(),
      createdAt: str('date-time'),
      updatedAt: str('date-time'),
    },
    ['id', 'featureId', 'title', 'status'],
  ),
  ApiEndpoint: obj(
    {
      id: str(),
      name: str(),
      method: str('GET | POST | PUT | PATCH | DELETE'),
      path: str(),
      direction: str('INBOUND | OUTBOUND'),
      payloadSchema: str('JSON-схема (строка)'),
      responseSchema: str('JSON-схема (строка)'),
      status: str('DRAFT | MOCKED | LIVE | FAILING'),
      notes: str(),
      createdAt: str('date-time'),
      updatedAt: str('date-time'),
    },
    ['id', 'name', 'method', 'path', 'direction', 'status'],
  ),
  WebhookEvent: obj(
    {
      id: str(),
      source: str(),
      eventType: str(),
      payloadJson: str('JSON-полезная нагрузка'),
      receivedAt: str('date-time'),
      status: str('RECEIVED | PROCESSED | DUPLICATE | FAILED'),
      idempotencyKey: str(),
      correlationId: nullable(str()),
      processedAt: nullable(str('date-time')),
    },
    ['id', 'eventType', 'status', 'idempotencyKey'],
  ),
  WebhookResult: obj(
    {
      eventId: str(),
      status: str('RECEIVED | PROCESSED | DUPLICATE | FAILED'),
      duplicate: bool('true — повтор по idempotencyKey'),
      leadId: str('Созданная заявка (для lead.created)'),
      error: obj({ code: str(), message: str() }),
    },
    ['eventId', 'status', 'duplicate'],
  ),
  Client: obj(
    {
      id: str(),
      externalId: nullable(str('ID клиента в 1С')),
      fullName: str(),
      phone: str(),
      email: str(),
      active: bool(),
      createdAt: str('date-time'),
    },
    ['id', 'fullName', 'phone'],
  ),
  Lead: obj(
    {
      id: str(),
      clientId: nullable(str()),
      source: str('VK | TELEGRAM | WHATSAPP | MAX | EMAIL | WEB | OTHER'),
      payloadJson: str(),
      status: str('NEW | SENT_TO_1C | DUPLICATE | ERROR'),
      idempotencyKey: str(),
      externalId: nullable(str('ID заявки в 1С')),
      errorCode: nullable(str()),
      errorMessage: nullable(str()),
      createdAt: str('date-time'),
      updatedAt: str('date-time'),
    },
    ['id', 'status', 'idempotencyKey'],
  ),
  ScheduleSlot: obj(
    {
      id: str(),
      serviceId: str('code услуги'),
      specialistId: str('code специалиста'),
      startAt: str('date-time'),
      endAt: str('date-time'),
      capacity: int('Вместимость'),
      bookedCount: int('Занято мест'),
      syncedAt: str('date-time'),
    },
    ['id', 'serviceId', 'specialistId', 'startAt', 'endAt', 'capacity', 'bookedCount'],
  ),
  Service: obj(
    {
      id: str(),
      code: str(),
      name: str(),
      direction: str('Направление/категория'),
      price: nullable(num()),
      active: bool(),
    },
    ['id', 'code', 'name'],
  ),
  Specialist: obj({ id: str(), code: str(), fullName: str(), phone: str(), active: bool() }, [
    'id',
    'code',
    'fullName',
  ]),
  Booking: obj(
    {
      id: str(),
      externalId: nullable(str('ID записи в 1С')),
      clientId: str(),
      serviceId: str(),
      specialistId: str(),
      scheduleSlotId: nullable(str()),
      slotStart: str('date-time'),
      slotEnd: str('date-time'),
      status: str('PENDING | CONFIRMED | CANCELLED | RESCHEDULED'),
      idempotencyKey: str(),
      errorCode: nullable(str()),
      createdAt: str('date-time'),
      updatedAt: str('date-time'),
    },
    ['id', 'clientId', 'serviceId', 'specialistId', 'slotStart', 'slotEnd', 'status'],
  ),
  BookingResult: obj(
    {
      booking: ref('Booking'),
      duplicate: bool('true — повтор по idempotencyKey, сущность не создана'),
    },
    ['booking', 'duplicate'],
  ),
  ErrorLog: obj(
    {
      id: str(),
      context: str('lead | booking | schedule | webhook ...'),
      errorCode: str('Внутренний код'),
      rawCode: str('Оригинальный код 1С'),
      message: str(),
      payloadJson: str(),
      retryCount: int(),
      status: str('PENDING | RETRYING | FAILED | RESOLVED'),
      correlationId: nullable(str()),
      createdAt: str('date-time'),
      updatedAt: str('date-time'),
    },
    ['id', 'errorCode', 'message', 'status'],
  ),
  Estimate: obj(
    {
      id: str(),
      featureId: str(),
      hours: num(),
      cost: num(),
      currency: str('RUB'),
      comment: str(),
      createdAt: str('date-time'),
    },
    ['id', 'featureId', 'hours', 'cost'],
  ),
  AuthUser: obj({ id: str(), email: str(), role: str('ADMIN | INTEGRATOR | VIEWER') }, [
    'id',
    'email',
    'role',
  ]),
  Settings: obj(
    {
      oneCMode: str('mock | real'),
      realConfigured: bool('ONEC_BASE_URL и ONEC_TOKEN заданы'),
      tokenConfigured: bool(),
      nodeEnv: str(),
      corsOrigin: str(),
    },
    ['oneCMode'],
  ),
  SummaryReport: obj(
    {
      features: obj({
        total: int(),
        byStatus: { type: 'array', items: obj({ status: str(), count: int() }) },
        byImplementationType: {
          type: 'array',
          items: obj({ type: str(), count: int() }),
        },
        totals: obj({ estimateDays: num(), estimateCost: num() }),
      }),
      estimates: obj({ count: int(), hours: num(), cost: num(), currency: str() }),
      tasks: obj({
        total: int(),
        byStatus: { type: 'array', items: obj({ status: str(), count: int() }) },
      }),
      endpoints: obj({
        total: int(),
        byStatus: { type: 'array', items: obj({ status: str(), count: int() }) },
      }),
      duplicates: obj({ webhookEvents: int(), leads: int() }),
      errors: obj({
        total: int(),
        byStatus: { type: 'array', items: obj({ status: str(), count: int() }) },
        recent: { type: 'array', items: ref('ErrorLog') },
      }),
      bookings: obj({
        total: int(),
        byStatus: { type: 'array', items: obj({ status: str(), count: int() }) },
      }),
      leads: obj({
        total: int(),
        byStatus: { type: 'array', items: obj({ status: str(), count: int() }) },
      }),
      inventory: obj({
        clients: int(),
        slots: int(),
        services: int(),
        specialists: int(),
        users: int(),
        webhooks: int(),
      }),
    },
    ['features', 'tasks', 'errors', 'bookings'],
  ),
  StandardVsCustomReport: obj({
    labels: obj({}),
    rows: {
      type: 'array',
      items: obj({
        code: str(),
        title: str(),
        status: str(),
        implementationType: str('STANDARD_API | EXTENSION | CUSTOM_HTTP_SERVICE | TBD'),
        priority: str(),
        estimateDays: nullable(num()),
        estimateCost: nullable(num()),
        tasksTotal: int(),
        tasksDone: int(),
        notes: str(),
      }),
    },
  }),
  TestRequestResult: obj(
    {
      endpointId: str(),
      mode: str('mock | real'),
      durationMs: int(),
      request: { description: 'Отправленный запрос' },
      response: { description: 'Ответ (в mock-режиме — симуляция)' },
      endpointStatus: str('MOCKED | LIVE | FAILING'),
    },
    ['endpointId', 'mode', 'durationMs'],
  ),
  SyncResult: obj({ slots: int(), services: int(), specialists: int(), status: str('OK') }, [
    'slots',
    'services',
    'specialists',
    'status',
  ]),
};

// ---------------------------------------------------------------------------
// Операции
// ---------------------------------------------------------------------------
interface Op {
  method: 'get' | 'post' | 'patch';
  path: string;
  tag: string;
  summary: string;
  security?: 'public' | 'write' | 'admin';
  params?: Json;
  query?: Array<{ name: string; description?: string; required?: boolean }>;
  body?: z.ZodType;
  responses: Json;
}

const listQueryParams: Array<{ name: string; description?: string }> = [
  { name: 'status', description: 'Фильтр по статусу' },
  { name: 'implementationType', description: 'Тип реализации (features)' },
  { name: 'priority', description: 'Приоритет (features)' },
  { name: 'direction', description: 'Направление (endpoints)' },
  { name: 'featureId', description: 'ID фичи (tasks, estimates)' },
  { name: 'context', description: 'Контекст (errors)' },
  { name: 'limit', description: 'Лимит записей' },
];

const idParam = (name = 'id'): Json => obj({ [name]: str('Идентификатор записи') }, [name]);

const operations: Op[] = [
  // auth
  {
    method: 'post',
    path: '/auth/login',
    tag: 'auth',
    summary: 'Вход по email и паролю → JWT (роли: ADMIN, INTEGRATOR, VIEWER)',
    security: 'public',
    body: loginSchema,
    responses: {
      '200': jsonResponse(
        'Токен и пользователь',
        obj({ token: str('JWT'), user: ref('AuthUser') }, ['token', 'user']),
      ),
      '401': errorResponse('Неверный email или пароль'),
    },
  },
  {
    method: 'get',
    path: '/auth/me',
    tag: 'auth',
    summary: 'Текущий пользователь',
    responses: {
      '200': jsonResponse('Пользователь', ref('AuthUser')),
      '401': errorResponse('Не авторизован'),
    },
  },
  {
    method: 'get',
    path: '/health',
    tag: 'auth',
    summary: 'Проверка живости сервиса и режима 1С',
    security: 'public',
    responses: {
      '200': jsonResponse(
        'OK',
        obj({ status: str(), mode: str('mock | real'), time: str('date-time') }),
      ),
    },
  },
  // features
  {
    method: 'get',
    path: '/features',
    tag: 'features',
    summary: 'Список функций интеграции (фильтры: status, implementationType, priority)',
    query: listQueryParams,
    responses: { '200': jsonResponse('Фичи', listOf('Feature')) },
  },
  {
    method: 'post',
    path: '/features',
    tag: 'features',
    summary: 'Создать фичу (роль INTEGRATOR+)',
    security: 'write',
    body: featureCreateSchema,
    responses: {
      '201': jsonResponse('Создана', ref('Feature')),
      '400': errorResponse('Ошибка валидации'),
    },
  },
  {
    method: 'get',
    path: '/features/{id}',
    tag: 'features',
    summary: 'Фича по id',
    params: idParam(),
    responses: { '200': jsonResponse('Фича', ref('Feature')), '404': errorResponse('Не найдено') },
  },
  {
    method: 'patch',
    path: '/features/{id}',
    tag: 'features',
    summary: 'Изменить фичу, включая inline-оценки (роль INTEGRATOR+)',
    security: 'write',
    params: idParam(),
    body: featureCreateSchema.partial(),
    responses: {
      '200': jsonResponse('Обновлена', ref('Feature')),
      '404': errorResponse('Не найдено'),
    },
  },
  // tasks
  {
    method: 'get',
    path: '/tasks',
    tag: 'tasks',
    summary: 'Задачи интеграции (фильтры: featureId, status)',
    query: listQueryParams,
    responses: { '200': jsonResponse('Задачи', listOf('IntegrationTask')) },
  },
  {
    method: 'post',
    path: '/tasks',
    tag: 'tasks',
    summary: 'Создать задачу (роль INTEGRATOR+)',
    security: 'write',
    body: taskCreateSchema,
    responses: { '201': jsonResponse('Создана', ref('IntegrationTask')) },
  },
  {
    method: 'patch',
    path: '/tasks/{id}',
    tag: 'tasks',
    summary: 'Изменить задачу (роль INTEGRATOR+)',
    security: 'write',
    params: idParam(),
    body: taskCreateSchema.partial(),
    responses: { '200': jsonResponse('Обновлена', ref('IntegrationTask')) },
  },
  // endpoints
  {
    method: 'get',
    path: '/endpoints',
    tag: 'endpoints',
    summary: 'API Explorer: список эндпоинтов 1С',
    query: listQueryParams,
    responses: { '200': jsonResponse('Эндпоинты', listOf('ApiEndpoint')) },
  },
  {
    method: 'post',
    path: '/endpoints',
    tag: 'endpoints',
    summary: 'Добавить эндпоинт (роль INTEGRATOR+)',
    security: 'write',
    body: endpointCreateSchema,
    responses: { '201': jsonResponse('Создан', ref('ApiEndpoint')) },
  },
  {
    method: 'patch',
    path: '/endpoints/{id}',
    tag: 'endpoints',
    summary: 'Изменить эндпоинт (роль INTEGRATOR+)',
    security: 'write',
    params: idParam(),
    body: endpointCreateSchema.partial(),
    responses: { '200': jsonResponse('Обновлён', ref('ApiEndpoint')) },
  },
  {
    method: 'post',
    path: '/endpoints/{id}/test',
    tag: 'endpoints',
    summary: 'Отправить тестовый запрос (в mock-режиме — симуляция; роль INTEGRATOR+)',
    security: 'write',
    params: idParam(),
    responses: {
      '200': jsonResponse('Результат теста', ref('TestRequestResult')),
      '400': errorResponse('Тест не настроен / запрещён в real-режиме'),
    },
  },
  // webhooks
  {
    method: 'get',
    path: '/webhooks',
    tag: 'webhooks',
    summary: 'Лента входящих событий (Webhook Console)',
    query: [{ name: 'limit', description: 'Лимит (по умолчанию 100)' }],
    responses: { '200': jsonResponse('События', listOf('WebhookEvent')) },
  },
  {
    method: 'post',
    path: '/webhooks/1c',
    tag: 'webhooks',
    summary:
      'Приём события от 1С/ИИ-ассистента. Идемпотентность: повтор ключа → DUPLICATE. Аутентификация: HMAC-подпись x-webhook-signature (SHA-256) ИЛИ x-webhook-token, ИЛИ валидный JWT (Webhook Console). Rate-limit: 60 запросов/мин',
    security: 'public',
    body: webhookCreateSchema,
    responses: {
      '202': jsonResponse('Событие принято в обработку', ref('WebhookResult')),
      '200': jsonResponse('Дубликат или FAILED', ref('WebhookResult')),
      '401': errorResponse('Неверная подпись/секрет'),
      '429': errorResponse('Превышен rate-limit'),
    },
  },
  {
    method: 'post',
    path: '/webhooks/{id}/reprocess',
    tag: 'webhooks',
    summary: 'Повторная обработка события (роль INTEGRATOR+)',
    security: 'write',
    params: idParam(),
    responses: { '200': jsonResponse('Результат', ref('WebhookResult')) },
  },
  // leads
  {
    method: 'get',
    path: '/leads',
    tag: 'leads',
    summary: 'Заявки клиентов',
    query: [{ name: 'limit', description: 'Лимит' }],
    responses: { '200': jsonResponse('Заявки', listOf('Lead')) },
  },
  {
    method: 'post',
    path: '/leads',
    tag: 'leads',
    summary: 'Создать заявку и передать в 1С (идемпотентность, ретраи max 3; роль INTEGRATOR+)',
    security: 'write',
    body: leadCreateSchema,
    responses: {
      '201': jsonResponse(
        'Заявка создана и передана',
        obj({ lead: ref('Lead'), client: ref('Client'), duplicate: bool() }),
      ),
      '200': jsonResponse(
        'Дубликат (тот же idempotencyKey)',
        obj({ lead: ref('Lead'), duplicate: bool() }),
      ),
      '409': errorResponse('Бизнес-отказ 1С'),
      '502': errorResponse('Ошибка 1С после ретраев'),
    },
  },
  // schedule
  {
    method: 'get',
    path: '/schedule',
    tag: 'schedule',
    summary: 'Расписание слотов (фильтры from/to/serviceCode/specialistCode)',
    query: [
      { name: 'from', description: 'ISO-дата начала' },
      { name: 'to', description: 'ISO-дата окончания' },
      { name: 'serviceCode', description: 'Код услуги' },
      { name: 'specialistCode', description: 'Код специалиста' },
    ],
    responses: { '200': jsonResponse('Слоты', listOf('ScheduleSlot')) },
  },
  {
    method: 'post',
    path: '/schedule/sync',
    tag: 'schedule',
    summary: 'Синхронизация расписания/услуг/специалистов из 1С (роль INTEGRATOR+)',
    security: 'write',
    responses: {
      '200': jsonResponse('Результат синхронизации', ref('SyncResult')),
      '503': errorResponse('1С недоступна'),
    },
  },
  {
    method: 'get',
    path: '/services',
    tag: 'schedule',
    summary: 'Список услуг и направлений',
    responses: { '200': jsonResponse('Услуги', listOf('Service')) },
  },
  {
    method: 'get',
    path: '/specialists',
    tag: 'schedule',
    summary: 'Список специалистов',
    responses: { '200': jsonResponse('Специалисты', listOf('Specialist')) },
  },
  // clients
  {
    method: 'get',
    path: '/clients',
    tag: 'clients',
    summary: 'Клиенты (фильтр по phone — подстрока)',
    query: [{ name: 'phone', description: 'Подстрока телефона' }],
    responses: { '200': jsonResponse('Клиенты', listOf('Client')) },
  },
  {
    method: 'post',
    path: '/clients',
    tag: 'clients',
    summary: 'Создать клиента (роль INTEGRATOR+)',
    security: 'write',
    body: clientCreateSchema,
    responses: {
      '201': jsonResponse('Создан', obj({ client: ref('Client'), duplicate: bool() })),
      '200': jsonResponse('Уже существует', obj({ client: ref('Client'), duplicate: bool() })),
    },
  },
  // bookings
  {
    method: 'get',
    path: '/bookings',
    tag: 'bookings',
    summary: 'Записи на занятия (фильтр status)',
    query: [{ name: 'status', description: 'PENDING | CONFIRMED | CANCELLED | RESCHEDULED' }],
    responses: { '200': jsonResponse('Записи', listOf('Booking')) },
  },
  {
    method: 'post',
    path: '/bookings',
    tag: 'bookings',
    summary:
      'Запись на занятие: идемпотентность, проверка мест/слота/активности клиента, подтверждение в 1С (роль INTEGRATOR+)',
    security: 'write',
    body: bookingCreateSchema,
    responses: {
      '201': jsonResponse('Запись подтверждена', ref('BookingResult')),
      '200': jsonResponse('Дубликат (тот же idempotencyKey)', ref('BookingResult')),
      '409': errorResponse('NO_SEATS | SLOT_TAKEN | CLIENT_INACTIVE'),
      '404': errorResponse('Слот/клиент не найден'),
      '502': errorResponse('Ошибка 1С после ретраев (см. /errors)'),
    },
  },
  {
    method: 'get',
    path: '/bookings/{id}',
    tag: 'bookings',
    summary: 'Запись по id',
    params: idParam(),
    responses: {
      '200': jsonResponse('Запись', ref('Booking')),
      '404': errorResponse('Не найдено'),
    },
  },
  {
    method: 'patch',
    path: '/bookings/{id}',
    tag: 'bookings',
    summary:
      'Ограниченные правки (clientId, clearError). Статусы — через cancel/reschedule (роль INTEGRATOR+)',
    security: 'write',
    params: idParam(),
    responses: { '200': jsonResponse('Запись', ref('Booking')) },
  },
  {
    method: 'post',
    path: '/bookings/{id}/cancel',
    tag: 'bookings',
    summary: 'Отмена записи (только CONFIRMED; освобождает место; роль INTEGRATOR+)',
    security: 'write',
    params: idParam(),
    responses: {
      '200': jsonResponse('Отменена', ref('Booking')),
      '409': errorResponse('BOOKING_NOT_CONFIRMED'),
      '502': errorResponse('Ошибка 1С после ретраев'),
    },
  },
  {
    method: 'post',
    path: '/bookings/{id}/reschedule',
    tag: 'bookings',
    summary: 'Перенос записи (только CONFIRMED; роль INTEGRATOR+)',
    security: 'write',
    params: idParam(),
    body: rescheduleSchema,
    responses: {
      '200': jsonResponse('Перенесена', ref('Booking')),
      '409': errorResponse('NO_SEATS | SLOT_TAKEN | BOOKING_NOT_CONFIRMED'),
    },
  },
  // errors
  {
    method: 'get',
    path: '/errors',
    tag: 'errors',
    summary: 'Журнал ошибок (фильтры status, context)',
    query: listQueryParams,
    responses: { '200': jsonResponse('Ошибки', listOf('ErrorLog')) },
  },
  {
    method: 'post',
    path: '/errors/{id}/retry',
    tag: 'errors',
    summary: 'Повтор обработки ошибки (роль INTEGRATOR+): RETRYING → RESOLVED/FAILED',
    security: 'write',
    params: idParam(),
    responses: {
      '200': jsonResponse('Обновлена', ref('ErrorLog')),
      '404': errorResponse('Не найдено'),
    },
  },
  // estimates
  {
    method: 'get',
    path: '/estimates',
    tag: 'estimates',
    summary: 'Оценки (фильтр featureId)',
    query: [{ name: 'featureId', description: 'ID фичи' }],
    responses: { '200': jsonResponse('Оценки', listOf('Estimate')) },
  },
  {
    method: 'post',
    path: '/estimates',
    tag: 'estimates',
    summary: 'Добавить оценку (роль INTEGRATOR+)',
    security: 'write',
    body: estimateCreateSchema,
    responses: { '201': jsonResponse('Создана', ref('Estimate')) },
  },
  // reports
  {
    method: 'get',
    path: '/reports/summary',
    tag: 'reports',
    summary: 'Сводка: статусы фич, типы реализации, часы/стоимость, ошибки, дубли',
    responses: { '200': jsonResponse('Сводка', ref('SummaryReport')) },
  },
  {
    method: 'get',
    path: '/reports/standard-vs-custom',
    tag: 'reports',
    summary: 'Отчёт «Стандартный API vs Доработки» (JSON)',
    responses: { '200': jsonResponse('Отчёт', ref('StandardVsCustomReport')) },
  },
  {
    method: 'get',
    path: '/reports/standard-vs-custom.csv',
    tag: 'reports',
    summary: 'Экспорт отчёта в CSV (UTF-8 BOM, разделитель «;»)',
    responses: { '200': csvResponse('CSV-файл отчёта') },
  },
  // settings / users
  {
    method: 'get',
    path: '/settings',
    tag: 'settings',
    summary: 'Настройки: режим 1С, наличие секретов (роль INTEGRATOR+)',
    security: 'write',
    responses: { '200': jsonResponse('Настройки', ref('Settings')) },
  },
  {
    method: 'patch',
    path: '/settings',
    tag: 'settings',
    summary: 'Переключение mock/real (роль ADMIN; real требует ONEC_BASE_URL + ONEC_TOKEN в env)',
    security: 'admin',
    body: settingsPatchSchema,
    responses: {
      '200': jsonResponse('Обновлено', ref('Settings')),
      '400': errorResponse('Real-режим не настроен'),
    },
  },
  {
    method: 'get',
    path: '/users',
    tag: 'settings',
    summary: 'Пользователи без хешей паролей (роль ADMIN)',
    security: 'admin',
    responses: {
      '200': jsonResponse('Пользователи', {
        type: 'array',
        items: obj({ id: str(), email: str(), role: str(), createdAt: str('date-time') }),
      }),
    },
  },
];

// ---------------------------------------------------------------------------
// Сборка спеки
// ---------------------------------------------------------------------------
export function buildOpenApiSpec(port = Number(process.env.PORT ?? 4000)): Json {
  const paths: Json = {};

  for (const op of operations) {
    const entry = (paths[op.path] as Json) ?? {};
    const parameters: Json[] = [];
    if (op.params) {
      for (const [name, schema] of Object.entries((op.params.properties ?? {}) as Json)) {
        parameters.push({ name, in: 'path', required: true, schema });
      }
    }
    for (const q of op.query ?? []) {
      parameters.push({
        name: q.name,
        in: 'query',
        required: q.required ?? false,
        schema: { type: 'string' },
      });
    }

    const operation: Json = {
      tags: [op.tag],
      summary: op.summary,
      operationId: `${op.method}${op.path.replace(/[^\w]+/g, '_')}`,
      ...(op.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: toJsonSchema(op.body) } },
            },
          }
        : {}),
      ...(parameters.length ? { parameters } : {}),
      ...(op.security === 'public' ? { security: [] } : {}),
      responses: op.responses,
    };
    if (op.security === 'write') {
      operation.description = 'Требуется роль INTEGRATOR или ADMIN';
    }
    if (op.security === 'admin') {
      operation.description = 'Требуется роль ADMIN';
    }
    entry[op.method] = operation;
    paths[op.path] = entry;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Трекер интеграции ИИ-ассистент ↔ 1С:Фитнес клуб',
      version: '1.0.0',
      description:
        'REST API трекера проекта интеграции: фичи и задачи, API Explorer, webhook-приёмник с идемпотентностью, записи на занятия, расписание, журнал ошибок с ретраями, отчёты. Все внешние вызовы к 1С идут через адаптер (mock по умолчанию, real — по флагу ONEC_MODE).',
    },
    servers: [{ url: `http://localhost:${port}`, description: 'Локальный запуск' }],
    tags: [
      { name: 'auth', description: 'Аутентификация и здоровье' },
      { name: 'features', description: 'Функции интеграции' },
      { name: 'tasks', description: 'Задачи' },
      { name: 'endpoints', description: 'API Explorer' },
      { name: 'webhooks', description: 'Webhook-приёмник' },
      { name: 'leads', description: 'Заявки клиентов' },
      { name: 'schedule', description: 'Расписание, услуги, специалисты' },
      { name: 'clients', description: 'Клиенты' },
      { name: 'bookings', description: 'Записи на занятия' },
      { name: 'errors', description: 'Журнал ошибок' },
      { name: 'estimates', description: 'Оценки' },
      { name: 'reports', description: 'Отчёты' },
      { name: 'settings', description: 'Настройки и пользователи' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas,
    },
    security: [{ bearerAuth: [] }],
    paths,
  };
}

function main(): void {
  const spec = buildOpenApiSpec();
  const outPath = path.resolve(process.cwd(), 'docs/openapi.yaml');
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, stringify(spec, { lineWidth: 120 }), 'utf8');
  process.stdout.write(`OpenAPI-спека записана: ${outPath}\n`);
}

main();
