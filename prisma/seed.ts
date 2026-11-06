import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

/**
 * Сид-данные демо-сценария:
 * 6 фич (5 задач интеграции + обращения администратору), 8 эндпоинтов,
 * 3 клиента, 5 слотов, заявки, записи, события вебхуков (с дублем),
 * примеры ошибок и оценки.
 * Повторный запуск пропускает сид (SEED_FORCE=1 — пересоздать).
 */

function loadDotEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const db = new PrismaClient();

const day = (offset: number, hour: number, minute = 0): Date => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  d.setHours(hour, minute, 0, 0);
  return d;
};

async function main(): Promise<void> {
  loadDotEnv();

  const already = await db.feature.findFirst({ where: { code: 'F-01' } });
  if (already && process.env.SEED_FORCE !== '1') {
    console.log('Сиды уже применены (SEED_FORCE=1 — пересоздать).');
    return;
  }

  if (already) {
    // полное пересоздание
    await db.auditLog.deleteMany();
    await db.estimate.deleteMany();
    await db.errorLog.deleteMany();
    await db.booking.deleteMany();
    await db.scheduleSlot.deleteMany();
    await db.lead.deleteMany();
    await db.webhookEvent.deleteMany();
    await db.integrationTask.deleteMany();
    await db.feature.deleteMany();
    await db.apiEndpoint.deleteMany();
    await db.scheduleSyncLog.deleteMany();
    await db.client.deleteMany();
    await db.service.deleteMany();
    await db.specialist.deleteMany();
    await db.user.deleteMany();
  }

  // --- Пользователи (пароль: Password123!) ---------------------------------
  const passwordHash = bcrypt.hashSync('Password123!', 10);
  const admin = await db.user.create({
    data: { email: 'admin@tracker.local', passwordHash, role: 'ADMIN' },
  });
  const integrator = await db.user.create({
    data: { email: 'integrator@tracker.local', passwordHash, role: 'INTEGRATOR' },
  });
  await db.user.create({ data: { email: 'viewer@tracker.local', passwordHash, role: 'VIEWER' } });

  // --- Фичи (5 задач интеграции + обращения администратору из ТЗ) ---------
  const featuresData = [
    {
      code: 'F-01',
      title: 'Передача заявок и контактных данных клиентов в 1С',
      description:
        'Имя, телефон, услуга, специалист, предпочтительные дата/время, источник (VK, Telegram, WhatsApp, MAX, e-mail), доп. информация из диалога. Заявка видна администратору в 1С.',
      status: 'IN_PROGRESS',
      implementationType: 'STANDARD_API',
      priority: 'HIGH',
      estimateDays: 5,
      estimateCost: 120000,
      notes: 'Штатный HTTP-сервис/веб-сервис 1С + защита от дублей по idempotencyKey.',
    },
    {
      code: 'F-02',
      title: 'Получение расписания, услуг, специалистов и свободных мест',
      description:
        'Актуальные расписание занятий, список услуг и направлений, доступные специалисты, свободные места и время, стоимость услуг — через API 1С.',
      status: 'DONE',
      implementationType: 'STANDARD_API',
      priority: 'HIGH',
      estimateDays: 3,
      estimateCost: 75000,
      notes: 'Чтение данных штатными механизмами, синхронизация в трекер по кнопке/по событию.',
    },
    {
      code: 'F-03',
      title: 'Автоматическая запись клиентов на занятия с подтверждением',
      description:
        'Проверка свободных мест, активности клиента и доступности слота; создание записи в 1С и возврат подтверждения. Защита от двойного бронирования.',
      status: 'IN_PROGRESS',
      implementationType: 'EXTENSION',
      priority: 'CRITICAL',
      estimateDays: 6,
      estimateCost: 160000,
      notes:
        'Если в штатном API нет атомарной записи с проверкой мест — требуется расширение конфигурации (допустимо по ТЗ).',
    },
    {
      code: 'F-04',
      title: 'Перенос и отмена записей (по возможности)',
      description:
        'Перенос записи на другой слот и отмена с освобождением места — если поддерживается конфигурацией.',
      status: 'PLANNED',
      implementationType: 'TBD',
      priority: 'MEDIUM',
      estimateDays: 2,
      estimateCost: 50000,
      notes: 'Уточнить у заказчика, поддерживает ли версия 1С:Фитнес перенос записей через API.',
    },
    {
      code: 'F-05',
      title: 'Обработка ошибок и защита от дублирования заявок/записей',
      description:
        'Идемпотентность по idempotencyKey, маппинг кодов ошибок 1С, ретраи с экспоненциальной задержкой (max 3), журнал ошибок с возможностью повтора.',
      status: 'IN_PROGRESS',
      implementationType: 'CUSTOM_HTTP_SERVICE',
      priority: 'HIGH',
      estimateDays: 4,
      estimateCost: 95000,
      notes: 'Слой адаптера трекера + приём webhook-событий с проверкой подписи.',
    },
    {
      code: 'F-06',
      title: 'Передача обращений администратору (помощь сотрудника)',
      description:
        'Создание обращения в 1С с контактами клиента и описанием запроса при необходимости помощи сотрудника; назначение ответственного — если поддерживается.',
      status: 'PLANNED',
      implementationType: 'TBD',
      priority: 'MEDIUM',
      estimateDays: 2,
      estimateCost: 45000,
      notes: 'Из ТЗ (п.4). Уточнить у заказчика механизм назначения ответственного.',
    },
  ];

  const features: Record<string, string> = {};
  for (const f of featuresData) {
    const created = await db.feature.create({ data: f });
    features[f.code] = created.id;
  }

  // --- Задачи ---------------------------------------------------------------
  const tasksData: Array<[string, string, string, string | null, number | null]> = [
    // [featureCode, title, status, assignee, dueInDays]
    ['F-01', 'Согрузить состав данных заявки с заказчиком', 'DONE', integrator.id, null],
    ['F-01', 'Реализовать исходящий вызов sendLead в адаптере', 'DONE', integrator.id, null],
    ['F-01', 'Проверить создание заявки в 1С (mock → real)', 'IN_PROGRESS', integrator.id, 3],
    [
      'F-02',
      'Описать контракт GET /schedule, /services, /specialists',
      'DONE',
      integrator.id,
      null,
    ],
    ['F-02', 'Синхронизация слотов в трекер (upsert без дублей)', 'DONE', integrator.id, null],
    ['F-03', 'Проверка мест/клиента/слота (NO_SEATS и др.)', 'DONE', integrator.id, null],
    ['F-03', 'Атомарная запись в 1С — уточнить у заказчика', 'BLOCKED', null, 5],
    ['F-03', 'Подтверждение записи клиенту (чат/голос)', 'TODO', null, 7],
    ['F-04', 'Выяснить поддержку переноса/отмены в версии 1С', 'TODO', null, 2],
    ['F-05', 'Маппинг кодов ошибок 1С и ретраи (max 3)', 'DONE', integrator.id, null],
    ['F-05', 'Журнал ошибок + повтор обработки', 'DONE', integrator.id, null],
    ['F-06', 'Механизм создания обращений в 1С:Фитнес', 'TODO', null, 4],
  ];
  for (const [code, title, status, assigneeId, dueDays] of tasksData) {
    await db.integrationTask.create({
      data: {
        featureId: features[code]!,
        title,
        status,
        assigneeId,
        dueDate: dueDays ? day(dueDays, 18) : null,
        description: '',
      },
    });
  }

  // --- Эндпоинты (8) --------------------------------------------------------
  const endpointsData = [
    {
      name: 'Создание заявки в 1С',
      method: 'POST',
      path: '/1c/v1/leads',
      direction: 'OUTBOUND',
      status: 'MOCKED',
      payloadSchema: JSON.stringify({
        type: 'object',
        required: ['idempotencyKey', 'client'],
        properties: {
          idempotencyKey: { type: 'string' },
          source: { type: 'string' },
          client: { type: 'object' },
        },
      }),
      responseSchema: JSON.stringify({
        type: 'object',
        properties: { externalId: { type: 'string' }, status: { type: 'string' } },
      }),
      notes: 'Передача контактных данных и параметров услуги.',
    },
    {
      name: 'Расписание занятий',
      method: 'GET',
      path: '/1c/v1/schedule',
      direction: 'OUTBOUND',
      status: 'MOCKED',
      payloadSchema: '{}',
      responseSchema: JSON.stringify({ type: 'array', items: { type: 'object' } }),
      notes: 'Слоты с вместимостью и занятыми местами.',
    },
    {
      name: 'Список услуг и направлений',
      method: 'GET',
      path: '/1c/v1/services',
      direction: 'OUTBOUND',
      status: 'MOCKED',
      payloadSchema: '{}',
      responseSchema: JSON.stringify({ type: 'array', items: { type: 'object' } }),
      notes: '',
    },
    {
      name: 'Список специалистов',
      method: 'GET',
      path: '/1c/v1/specialists',
      direction: 'OUTBOUND',
      status: 'MOCKED',
      payloadSchema: '{}',
      responseSchema: JSON.stringify({ type: 'array', items: { type: 'object' } }),
      notes: '',
    },
    {
      name: 'Запись клиента на занятие',
      method: 'POST',
      path: '/1c/v1/bookings',
      direction: 'OUTBOUND',
      status: 'MOCKED',
      payloadSchema: JSON.stringify({
        type: 'object',
        required: ['idempotencyKey', 'clientId', 'slotStart'],
        properties: {
          idempotencyKey: { type: 'string' },
          slotStart: { type: 'string', format: 'date-time' },
        },
      }),
      responseSchema: JSON.stringify({
        type: 'object',
        properties: { externalId: { type: 'string' }, status: { type: 'string' } },
      }),
      notes: 'Атомарная проверка мест — вопрос к расширению (F-03).',
    },
    {
      name: 'Отмена записи',
      method: 'POST',
      path: '/1c/v1/bookings/{id}/cancel',
      direction: 'OUTBOUND',
      status: 'DRAFT',
      payloadSchema: '{}',
      responseSchema: JSON.stringify({
        type: 'object',
        properties: { status: { type: 'string' } },
      }),
      notes: 'Зависит от поддержки в конфигурации (F-04).',
    },
    {
      name: 'Перенос записи',
      method: 'POST',
      path: '/1c/v1/bookings/{id}/reschedule',
      direction: 'OUTBOUND',
      status: 'DRAFT',
      payloadSchema: '{}',
      responseSchema: JSON.stringify({
        type: 'object',
        properties: { status: { type: 'string' } },
      }),
      notes: 'Зависит от поддержки в конфигурации (F-04).',
    },
    {
      name: 'Приём событий от 1С (webhook)',
      method: 'POST',
      path: '/api/webhooks/1c',
      direction: 'INBOUND',
      status: 'MOCKED',
      payloadSchema: JSON.stringify({
        type: 'object',
        required: ['eventType', 'idempotencyKey'],
        properties: {
          eventType: { type: 'string' },
          idempotencyKey: { type: 'string' },
          payload: { type: 'object' },
        },
      }),
      responseSchema: JSON.stringify({
        type: 'object',
        properties: { status: { type: 'string' }, duplicate: { type: 'boolean' } },
      }),
      notes: 'HMAC-подпись/секрет + rate-limit + идемпотентность.',
    },
  ];
  for (const e of endpointsData) {
    await db.apiEndpoint.create({ data: e });
  }

  // --- Услуги, специалисты, клиенты ----------------------------------------
  const servicesData = [
    { code: 'PILATES_REFORMER', name: 'Пилатес на реформере', direction: 'Групповые', price: 1500 },
    { code: 'PILATES_MAT', name: 'Пилатес на коврике', direction: 'Групповые', price: 1200 },
    {
      code: 'PILATES_PRIVATE',
      name: 'Пилатес индивидуально',
      direction: 'Персональные',
      price: 3500,
    },
  ];
  for (const s of servicesData) {
    await db.service.create({ data: { ...s, active: true } });
  }

  const specialistsData = [
    { code: 'ANNA_K', fullName: 'Анна Ковалёва', phone: '+7 900 000-00-01' },
    { code: 'MARIA_S', fullName: 'Мария Сидорова', phone: '+7 900 000-00-02' },
  ];
  for (const s of specialistsData) {
    await db.specialist.create({ data: { ...s, active: true } });
  }

  const clientsData = [
    {
      fullName: 'Иванова Мария',
      phone: '+7 900 111-22-33',
      email: 'maria@example.com',
      active: true,
    },
    {
      fullName: 'Петров Сергей',
      phone: '+7 900 222-33-44',
      email: 'sergey@example.com',
      active: true,
    },
    { fullName: 'Сидорова Елена', phone: '+7 900 333-44-55', email: '', active: false },
  ];
  const clients: string[] = [];
  for (const c of clientsData) {
    const created = await db.client.create({ data: { ...c, externalId: null } });
    clients.push(created.id);
  }

  // --- Слоты (5) ------------------------------------------------------------
  const slotsData: Array<{
    serviceId: string;
    specialistId: string;
    startAt: Date;
    capacity: number;
    bookedCount: number;
  }> = [
    {
      serviceId: 'PILATES_REFORMER',
      specialistId: 'ANNA_K',
      startAt: day(1, 10),
      capacity: 8,
      bookedCount: 1,
    },
    {
      serviceId: 'PILATES_REFORMER',
      specialistId: 'ANNA_K',
      startAt: day(1, 18),
      capacity: 8,
      bookedCount: 2,
    },
    {
      serviceId: 'PILATES_MAT',
      specialistId: 'MARIA_S',
      startAt: day(1, 12),
      capacity: 12,
      bookedCount: 12,
    },
    {
      serviceId: 'PILATES_MAT',
      specialistId: 'MARIA_S',
      startAt: day(2, 12),
      capacity: 12,
      bookedCount: 0,
    },
    {
      serviceId: 'PILATES_PRIVATE',
      specialistId: 'ANNA_K',
      startAt: day(2, 19),
      capacity: 1,
      bookedCount: 1,
    },
  ];
  const slots: string[] = [];
  for (const s of slotsData) {
    const created = await db.scheduleSlot.create({
      data: { ...s, endAt: new Date(s.startAt.getTime() + 3600_000), syncedAt: new Date() },
    });
    slots.push(created.id);
  }

  // --- Заявки (3) -----------------------------------------------------------
  const leadsData = [
    {
      clientId: clients[0]!,
      source: 'TELEGRAM',
      status: 'SENT_TO_1C',
      idempotencyKey: 'seed-lead-1',
      externalId: 'L-1C-0001',
      payloadJson: JSON.stringify({
        question: 'Хочу попробовать пилатес',
        service: 'PILATES_REFORMER',
      }),
    },
    {
      clientId: clients[1]!,
      source: 'VK',
      status: 'NEW',
      idempotencyKey: 'seed-lead-2',
      externalId: null,
      payloadJson: JSON.stringify({ question: 'Есть ли места на вечер?' }),
    },
    {
      clientId: clients[0]!,
      source: 'WHATSAPP',
      status: 'DUPLICATE',
      idempotencyKey: 'seed-lead-3',
      externalId: null,
      payloadJson: JSON.stringify({ note: 'Пример дубля заявки (демо)' }),
    },
  ];
  const leads: string[] = [];
  for (const l of leadsData) {
    const created = await db.lead.create({
      data: { ...l, errorCode: null, errorMessage: null },
    });
    leads.push(created.id);
  }

  // --- Записи (3) -----------------------------------------------------------
  const bookingsData = [
    {
      externalId: 'B-1C-0001',
      clientId: clients[0]!,
      slotIndex: 0,
      status: 'CONFIRMED',
      idempotencyKey: 'seed-booking-1',
    },
    {
      externalId: 'B-1C-0002',
      clientId: clients[1]!,
      slotIndex: 3,
      status: 'CANCELLED',
      idempotencyKey: 'seed-booking-2',
    },
    {
      externalId: 'B-1C-0003',
      clientId: clients[1]!,
      slotIndex: 4,
      status: 'RESCHEDULED',
      idempotencyKey: 'seed-booking-3',
    },
  ];
  for (const b of bookingsData) {
    const slot = slotsData[b.slotIndex]!;
    await db.booking.create({
      data: {
        externalId: b.externalId,
        clientId: b.clientId,
        serviceId: slot.serviceId,
        specialistId: slot.specialistId,
        scheduleSlotId: slots[b.slotIndex]!,
        slotStart: slot.startAt,
        slotEnd: new Date(slot.startAt.getTime() + 3600_000),
        status: b.status,
        idempotencyKey: b.idempotencyKey,
        errorCode: null,
      },
    });
  }

  // --- События webhook (4, включая дубль и ошибку) ---------------------------
  await db.webhookEvent.create({
    data: {
      source: '1c',
      eventType: 'lead.created',
      payloadJson: JSON.stringify({
        client: { fullName: clientsData[0]!.fullName, phone: clientsData[0]!.phone },
        source: 'TELEGRAM',
      }),
      status: 'PROCESSED',
      idempotencyKey: 'wh-seed-1',
      processedAt: new Date(),
    },
  });
  await db.webhookEvent.create({
    data: {
      source: '1c',
      eventType: 'lead.created',
      payloadJson: JSON.stringify({ note: 'повтор того же события' }),
      status: 'DUPLICATE',
      idempotencyKey: 'wh-seed-1',
      processedAt: new Date(),
    },
  });
  const event3 = await db.webhookEvent.create({
    data: {
      source: '1c',
      eventType: 'booking.confirmed',
      payloadJson: JSON.stringify({ externalId: 'B-1C-9999' }),
      status: 'FAILED',
      idempotencyKey: 'wh-seed-3',
      processedAt: new Date(),
    },
  });
  await db.webhookEvent.create({
    data: {
      source: '1c',
      eventType: 'schedule.updated',
      payloadJson: JSON.stringify({ reason: 'nightly-sync' }),
      status: 'PROCESSED',
      idempotencyKey: 'wh-seed-4',
      processedAt: new Date(),
    },
  });

  // --- Ошибки (3) -----------------------------------------------------------
  await db.errorLog.create({
    data: {
      context: 'lead.send',
      errorCode: 'ONEC_UNAVAILABLE',
      rawCode: 'HTTP_500',
      message: '1С вернула 500 для POST /leads',
      payloadJson: JSON.stringify({ leadId: leads[1] }),
      retryCount: 3,
      status: 'FAILED',
      correlationId: null,
    },
  });
  await db.errorLog.create({
    data: {
      context: 'schedule.sync',
      errorCode: 'ONEC_UNAVAILABLE',
      rawCode: 'E_TIMEOUT',
      message: 'Таймаут при получении расписания из 1С',
      payloadJson: JSON.stringify({}),
      retryCount: 3,
      status: 'FAILED',
      correlationId: null,
    },
  });
  await db.errorLog.create({
    data: {
      context: 'webhook',
      errorCode: 'NOT_FOUND',
      rawCode: '',
      message: 'Запись B-1C-9999 не найдена в трекере',
      payloadJson: JSON.stringify({ eventId: event3.id }),
      retryCount: 1,
      status: 'RESOLVED',
      correlationId: null,
    },
  });

  // --- Оценки ---------------------------------------------------------------
  const estimatesData: Array<[string, number, number, string]> = [
    ['F-01', 40, 120000, 'Стандартный API 1С'],
    ['F-02', 24, 75000, 'Чтение данных без доработок'],
    ['F-03', 48, 160000, 'Включая проверку атомарности в 1С'],
    ['F-04', 16, 50000, 'Предварительно, зависит от версии 1С'],
    ['F-05', 32, 95000, 'Адаптер, ретраи, идемпотентность'],
    ['F-06', 16, 45000, 'Предварительно'],
  ];
  for (const [code, hours, cost, comment] of estimatesData) {
    await db.estimate.create({
      data: { featureId: features[code]!, hours, cost, currency: 'RUB', comment },
    });
  }

  // --- Audit-запись о сиде ---------------------------------------------------
  await db.auditLog.create({
    data: {
      model: 'Seed',
      recordId: 'initial',
      action: 'CREATE',
      actorId: admin.id,
      actorEmail: admin.email,
      dataJson: JSON.stringify({ features: featuresData.length, endpoints: endpointsData.length }),
      correlationId: null,
    },
  });

  console.log(
    `Сиды применены: ${featuresData.length} фич, ${endpointsData.length} эндпоинтов, ` +
      `${clients.length} клиента(ов), ${slots.length} слотов, ${leadsData.length} заявок.`,
  );
}

main()
  .catch((err) => {
    console.error('Ошибка сида:', err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
