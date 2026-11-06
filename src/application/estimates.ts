import type { Estimate } from '../domain/entities/index';
import { DomainError } from '../domain/errors';
import type { AppContext } from './context';
import { audit } from './audit';

export interface EstimateInput {
  featureId: string;
  hours: number;
  cost: number;
  currency?: string;
  comment?: string;
}

export function listEstimates(ctx: AppContext, filter?: { featureId?: string }) {
  return ctx.repos.estimates.list(filter);
}

export async function createEstimate(ctx: AppContext, input: EstimateInput): Promise<Estimate> {
  if (!input.featureId) {
    throw new DomainError('VALIDATION', 'featureId обязателен');
  }
  if (!(input.hours >= 0) || !(input.cost >= 0)) {
    throw new DomainError('VALIDATION', 'hours и cost должны быть неотрицательными');
  }
  const feature = await ctx.repos.features.byId(input.featureId);
  if (!feature) {
    throw new DomainError('NOT_FOUND', `Фича ${input.featureId} не найдена`);
  }
  const estimate = await ctx.repos.estimates.create({
    featureId: feature.id,
    hours: input.hours,
    cost: input.cost,
    currency: input.currency ?? 'RUB',
    comment: input.comment ?? '',
  });
  await audit(ctx, 'Estimate', estimate.id, 'CREATE', estimate);
  return estimate;
}
