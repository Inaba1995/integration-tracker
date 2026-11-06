import {
  FEATURE_STATUSES,
  IMPLEMENTATION_TYPES,
  PRIORITIES,
  type Feature,
} from '../domain/entities/index';
import { DomainError } from '../domain/errors';
import type { AppContext } from './context';
import { audit } from './audit';

export interface FeatureInput {
  code?: string;
  title?: string;
  description?: string;
  status?: string;
  implementationType?: string;
  priority?: string;
  estimateDays?: number | null;
  estimateCost?: number | null;
  notes?: string;
}

const UPDATABLE = [
  'code',
  'title',
  'description',
  'status',
  'implementationType',
  'priority',
  'estimateDays',
  'estimateCost',
  'notes',
] as const;

export function listFeatures(
  ctx: AppContext,
  filter?: { status?: string; implementationType?: string; priority?: string },
): Promise<Feature[]> {
  return ctx.repos.features.list(filter);
}

export async function getFeature(ctx: AppContext, id: string): Promise<Feature> {
  const feature = await ctx.repos.features.byId(id);
  if (!feature) {
    throw new DomainError('NOT_FOUND', `Фича ${id} не найдена`);
  }
  return feature;
}

export async function createFeature(ctx: AppContext, input: FeatureInput): Promise<Feature> {
  const code = input.code?.trim();
  const title = input.title?.trim();
  if (!code || !title) {
    throw new DomainError('VALIDATION', 'code и title обязательны');
  }
  if (input.status && !isOneOf(input.status, FEATURE_STATUSES)) {
    throw new DomainError('VALIDATION', `Недопустимый status: ${input.status}`);
  }
  if (input.implementationType && !isOneOf(input.implementationType, IMPLEMENTATION_TYPES)) {
    throw new DomainError(
      'VALIDATION',
      `Недопустимый implementationType: ${input.implementationType}`,
    );
  }
  if (input.priority && !isOneOf(input.priority, PRIORITIES)) {
    throw new DomainError('VALIDATION', `Недопустимый priority: ${input.priority}`);
  }
  if (await ctx.repos.features.byCode(code)) {
    throw new DomainError('CONFLICT', `Фича с кодом ${code} уже существует`);
  }

  const feature = await ctx.repos.features.create({
    code,
    title,
    description: input.description ?? '',
    status: (input.status as Feature['status']) ?? 'PLANNED',
    implementationType: (input.implementationType as Feature['implementationType']) ?? 'TBD',
    priority: (input.priority as Feature['priority']) ?? 'MEDIUM',
    estimateDays: input.estimateDays ?? null,
    estimateCost: input.estimateCost ?? null,
    notes: input.notes ?? '',
  });
  await audit(ctx, 'Feature', feature.id, 'CREATE', feature);
  return feature;
}

export async function updateFeature(
  ctx: AppContext,
  id: string,
  input: FeatureInput,
): Promise<Feature> {
  const before = await getFeature(ctx, id);
  if (input.status && !isOneOf(input.status, FEATURE_STATUSES)) {
    throw new DomainError('VALIDATION', `Недопустимый status: ${input.status}`);
  }
  if (input.implementationType && !isOneOf(input.implementationType, IMPLEMENTATION_TYPES)) {
    throw new DomainError(
      'VALIDATION',
      `Недопустимый implementationType: ${input.implementationType}`,
    );
  }
  if (input.priority && !isOneOf(input.priority, PRIORITIES)) {
    throw new DomainError('VALIDATION', `Недопустимый priority: ${input.priority}`);
  }

  const data: Record<string, unknown> = {};
  for (const key of UPDATABLE) {
    if (input[key] !== undefined) {
      data[key] = input[key];
    }
  }
  const feature = await ctx.repos.features.update(id, data as Partial<Feature>);
  await audit(ctx, 'Feature', id, 'UPDATE', { before, after: feature });
  return feature;
}

function isOneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value);
}
