import type { Client, Lead, LeadSource } from '../domain/entities/index';
import { LEAD_SOURCES } from '../domain/entities/index';
import { DomainError } from '../domain/errors';
import { requireIdempotencyKey } from '../domain/rules/idempotency';
import { toDomainError } from '../domain/rules/oneCErrors';
import type { AppContext } from './context';
import { audit } from './audit';
import { withRetries } from './retry';

export interface LeadClientInput {
  fullName: string;
  phone: string;
  email?: string;
}

export interface LeadInput {
  idempotencyKey: string;
  source?: string;
  client: LeadClientInput;
  /** Дополнительная информация из диалога: услуга, специалист, дата, комментарий. */
  payload?: Record<string, unknown>;
}

export interface IngestLeadResult {
  lead: Lead;
  client: Client | null;
  duplicate: boolean;
}

/**
 * Создание заявки (лида) с идемпотентностью и передачей в 1С.
 * Правило 1: повтор ключа → DUPLICATE, новая сущность не создаётся.
 * Правило 4: ошибки 1С маппятся, ретраи max 3, затем ErrorLog.
 */
export async function ingestLead(ctx: AppContext, input: LeadInput): Promise<IngestLeadResult> {
  const key = requireIdempotencyKey(input.idempotencyKey);

  const existing = await ctx.repos.leads.byIdempotencyKey(key);
  if (existing) {
    const client = existing.clientId ? await ctx.repos.clients.byId(existing.clientId) : null;
    return { lead: existing, client, duplicate: true };
  }

  const fullName = input.client?.fullName?.trim();
  const phone = input.client?.phone?.trim();
  if (!fullName || !phone) {
    throw new DomainError('VALIDATION', 'client.fullName и client.phone обязательны');
  }
  if (input.source && !(LEAD_SOURCES as readonly string[]).includes(input.source)) {
    throw new DomainError('VALIDATION', `Недопустимый source: ${input.source}`);
  }

  let client = await ctx.repos.clients.byPhone(phone);
  if (!client) {
    client = await ctx.repos.clients.create({
      externalId: null,
      fullName,
      phone,
      email: input.client.email?.trim() ?? '',
      active: true,
    });
    await audit(ctx, 'Client', client.id, 'CREATE', client);
  }

  const lead = await ctx.repos.leads.create({
    clientId: client.id,
    source: (input.source as LeadSource) ?? 'OTHER',
    payloadJson: JSON.stringify({
      ...input.payload,
      client: { fullName, phone, email: client.email },
      source: input.source ?? 'OTHER',
    }),
    status: 'NEW',
    idempotencyKey: key,
    externalId: null,
    errorCode: null,
    errorMessage: null,
    createdAt: ctx.clock(),
    updatedAt: ctx.clock(),
  });
  await audit(ctx, 'Lead', lead.id, 'CREATE', { leadId: lead.id, clientId: client.id, key });

  try {
    const res = await withRetries(ctx, 'lead.send', { leadId: lead.id }, () =>
      ctx.adapter.get().sendLead({ lead, client }),
    );
    const updated = await ctx.repos.leads.update(lead.id, {
      status: 'SENT_TO_1C',
      externalId: res.externalId,
    });
    await audit(ctx, 'Lead', lead.id, 'UPDATE', {
      status: updated.status,
      externalId: res.externalId,
      oneCStatus: res.status,
    });
    return { lead: updated, client, duplicate: false };
  } catch (err) {
    const de = toDomainError(err);
    const updated = await ctx.repos.leads.update(lead.id, {
      status: 'ERROR',
      errorCode: de.code,
      errorMessage: de.message,
    });
    await audit(ctx, 'Lead', lead.id, 'UPDATE', {
      status: updated.status,
      errorCode: de.code,
    });
    throw de;
  }
}

export function listLeads(ctx: AppContext, limit = 100): Promise<Lead[]> {
  return ctx.repos.leads.list(limit);
}
