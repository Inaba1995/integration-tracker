import { FEATURE_STATUSES, IMPLEMENTATION_TYPES, type Feature } from '../domain/entities/index';
import type { AppContext } from './context';

export interface FeatureStatusCount {
  status: string;
  count: number;
}

export interface SummaryReport {
  features: {
    total: number;
    byStatus: FeatureStatusCount[];
    byImplementationType: { type: string; count: number }[];
    totals: { estimateDays: number; estimateCost: number };
  };
  estimates: { count: number; hours: number; cost: number; currency: string };
  tasks: { total: number; byStatus: { status: string; count: number }[] };
  endpoints: { total: number; byStatus: { status: string; count: number }[] };
  duplicates: { webhookEvents: number; leads: number };
  errors: { total: number; byStatus: { status: string; count: number }[]; recent: unknown[] };
  bookings: { total: number; byStatus: { status: string; count: number }[] };
  leads: { total: number; byStatus: { status: string; count: number }[] };
  inventory: {
    clients: number;
    slots: number;
    services: number;
    specialists: number;
    users: number;
    webhooks: number;
    auditEntries?: number;
  };
}

export async function summary(ctx: AppContext): Promise<SummaryReport> {
  const [
    features,
    tasks,
    endpoints,
    estimates,
    errors,
    webhooks,
    leads,
    bookings,
    clients,
    slots,
    services,
    specialists,
    users,
  ] = await Promise.all([
    ctx.repos.features.list(),
    ctx.repos.tasks.list(),
    ctx.repos.endpoints.list(),
    ctx.repos.estimates.list(),
    ctx.repos.errors.list(),
    ctx.repos.webhooks.list(10_000),
    ctx.repos.leads.list(10_000),
    ctx.repos.bookings.list(),
    ctx.repos.clients.list(),
    ctx.repos.schedule.listSlots(),
    ctx.repos.catalog.listServices(),
    ctx.repos.catalog.listSpecialists(),
    ctx.repos.users.list(),
  ]);

  const countBy = <T extends string>(items: { status: string }[], allowed: readonly T[]) => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
    return [...allowed, ...counts.keys()]
      .filter((value, index, arr) => arr.indexOf(value) === index)
      .map((status) => ({ status, count: counts.get(status) ?? 0 }));
  };

  const typeCounts = IMPLEMENTATION_TYPES.map((type) => ({
    type,
    count: features.filter((f) => f.implementationType === type).length,
  }));

  const estimateHours = estimates.reduce((sum, e) => sum + e.hours, 0);
  const estimateCost = estimates.reduce((sum, e) => sum + e.cost, 0);

  return {
    features: {
      total: features.length,
      byStatus: countBy(features, FEATURE_STATUSES),
      byImplementationType: typeCounts,
      totals: {
        estimateDays: round2(features.reduce((s, f) => s + (f.estimateDays ?? 0), 0)),
        estimateCost: round2(features.reduce((s, f) => s + (f.estimateCost ?? 0), 0)),
      },
    },
    estimates: {
      count: estimates.length,
      hours: round2(estimateHours),
      cost: round2(estimateCost),
      currency: 'RUB',
    },
    tasks: {
      total: tasks.length,
      byStatus: countBy(tasks, ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE']),
    },
    endpoints: {
      total: endpoints.length,
      byStatus: countBy(endpoints, ['DRAFT', 'MOCKED', 'LIVE', 'FAILING']),
    },
    duplicates: {
      webhookEvents: webhooks.filter((e) => e.status === 'DUPLICATE').length,
      leads: leads.filter((l) => l.status === 'DUPLICATE').length,
    },
    errors: {
      total: errors.length,
      byStatus: countBy(errors, ['PENDING', 'RETRYING', 'FAILED', 'RESOLVED']),
      recent: errors.slice(0, 5),
    },
    bookings: {
      total: bookings.length,
      byStatus: countBy(bookings, ['PENDING', 'CONFIRMED', 'CANCELLED', 'RESCHEDULED']),
    },
    leads: {
      total: leads.length,
      byStatus: countBy(leads, ['NEW', 'SENT_TO_1C', 'DUPLICATE', 'ERROR']),
    },
    inventory: {
      clients: clients.length,
      slots: slots.length,
      services: services.length,
      specialists: specialists.length,
      users: users.length,
      webhooks: webhooks.length,
    },
  };
}

export interface StandardVsCustomRow {
  code: string;
  title: string;
  status: string;
  implementationType: string;
  priority: string;
  estimateDays: number | null;
  estimateCost: number | null;
  tasksTotal: number;
  tasksDone: number;
  notes: string;
}

/**
 * Отчёт «Стандартный API vs Доработки» (правило 5: implementationType обязателен).
 */
export async function standardVsCustom(ctx: AppContext): Promise<StandardVsCustomRow[]> {
  const [features, tasks] = await Promise.all([ctx.repos.features.list(), ctx.repos.tasks.list()]);
  return features.map((f: Feature) => {
    const related = tasks.filter((t) => t.featureId === f.id);
    return {
      code: f.code,
      title: f.title,
      status: f.status,
      implementationType: f.implementationType,
      priority: f.priority,
      estimateDays: f.estimateDays,
      estimateCost: f.estimateCost,
      tasksTotal: related.length,
      tasksDone: related.filter((t) => t.status === 'DONE').length,
      notes: f.notes,
    };
  });
}

export const IMPLEMENTATION_TYPE_LABELS: Record<string, string> = {
  STANDARD_API: 'Стандартный API',
  EXTENSION: 'Расширение конфигурации',
  CUSTOM_HTTP_SERVICE: 'Кастомный HTTP-сервис',
  TBD: 'Требует уточнения',
};

/** Экспорт отчёта в CSV (UTF-8 BOM — корректное открытие в Excel). */
export async function standardVsCustomCsv(ctx: AppContext): Promise<string> {
  const rows = await standardVsCustom(ctx);
  const header = [
    'Код',
    'Функция',
    'Статус',
    'Тип реализации',
    'Приоритет',
    'Оценка, дней',
    'Оценка, руб.',
    'Задач',
    'Выполнено',
    'Комментарий',
  ];
  const lines = [
    header,
    ...rows.map((r) => [
      r.code,
      r.title,
      r.status,
      `${IMPLEMENTATION_TYPE_LABELS[r.implementationType] ?? r.implementationType} (${r.implementationType})`,
      r.priority,
      r.estimateDays ?? '',
      r.estimateCost ?? '',
      r.tasksTotal,
      r.tasksDone,
      r.notes,
    ]),
  ];
  return '﻿' + lines.map((line) => line.map(csvCell).join(';')).join('\r\n');
}

function csvCell(value: unknown): string {
  const str = String(value ?? '');
  return /[";\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
