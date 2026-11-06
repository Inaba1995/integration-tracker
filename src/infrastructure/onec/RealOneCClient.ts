import type { MinimalLogger } from '../../domain/ports/logger';
import type { ScheduleSlot, Service, Specialist } from '../../domain/entities/index';
import { OneCError } from '../../domain/errors';
import {
  DEFAULT_RETRY_POLICY,
  nextRetryDelayMs,
  type RetryPolicy,
} from '../../domain/rules/retryPolicy';
import type {
  CreateBookingInput,
  OneCClient,
  ScheduleQuery,
  SendLeadInput,
} from '../../domain/ports/onec';

/**
 * Реальный адаптер 1С:Фитнес клуб (ONEC_MODE=real).
 * HTTP: базовый URL и токен только из env, таймауты, экспоненциальные
 * ретраи транспортных ошибок (max 3), structured-логирование.
 * По умолчанию режим НЕ используется — только по флагу ONEC_MODE=real.
 */

export interface RealOneCClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  logger?: MinimalLogger;
  policy?: RetryPolicy;
  /** Инъекция fetch для тестов. */
  fetchFn?: typeof fetch;
  /** Инъекция задержки для тестов. */
  sleep?: (ms: number) => Promise<void>;
}

type TransportErrorKind = 'TIMEOUT' | 'NETWORK' | 'HTTP_5XX';

interface RequestResult {
  ok: boolean;
  status: number;
  body: unknown;
}

export class RealOneCClient implements OneCClient {
  readonly mode = 'real' as const;

  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly logger: MinimalLogger | undefined;
  private readonly policy: RetryPolicy;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: RealOneCClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.logger = options.logger;
    this.policy = options.policy ?? DEFAULT_RETRY_POLICY;
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async sendLead(input: SendLeadInput): Promise<{ externalId: string; status: string }> {
    return this.request<{ externalId: string; status: string }>('POST', '/leads', {
      idempotencyKey: input.lead.idempotencyKey,
      source: input.lead.source,
      payload: JSON.parse(input.lead.payloadJson),
      client: input.client
        ? {
            externalId: input.client.externalId,
            fullName: input.client.fullName,
            phone: input.client.phone,
            email: input.client.email,
          }
        : null,
    });
  }

  async getSchedule(params: ScheduleQuery): Promise<ScheduleSlot[]> {
    const query = new URLSearchParams();
    if (params.from) query.set('from', params.from.toISOString());
    if (params.to) query.set('to', params.to.toISOString());
    if (params.serviceCode) query.set('serviceCode', params.serviceCode);
    if (params.specialistCode) query.set('specialistCode', params.specialistCode);
    const qs = query.toString();
    const rows = await this.request<RawSlot[]>('GET', `/schedule${qs ? `?${qs}` : ''}`);
    return rows.map((row) => ({
      id: String(row.id),
      serviceId: String(row.serviceId ?? row.serviceCode),
      specialistId: String(row.specialistId ?? row.specialistCode),
      startAt: new Date(row.startAt),
      endAt: new Date(row.endAt),
      capacity: Number(row.capacity ?? 0),
      bookedCount: Number(row.bookedCount ?? 0),
      syncedAt: new Date(),
    }));
  }

  async getServices(): Promise<Service[]> {
    const rows = await this.request<RawService[]>('GET', '/services');
    return rows.map((row, i) => ({
      id: String(row.id ?? row.code ?? i),
      code: String(row.code ?? row.id ?? i),
      name: String(row.name ?? ''),
      direction: String(row.direction ?? ''),
      price: row.price == null ? null : Number(row.price),
      active: row.active !== false,
    }));
  }

  async getSpecialists(): Promise<Specialist[]> {
    const rows = await this.request<RawSpecialist[]>('GET', '/specialists');
    return rows.map((row, i) => ({
      id: String(row.id ?? row.code ?? i),
      code: String(row.code ?? row.id ?? i),
      fullName: String(row.fullName ?? row.name ?? ''),
      phone: String(row.phone ?? ''),
      active: row.active !== false,
    }));
  }

  async createBooking(input: CreateBookingInput): Promise<{ externalId: string; status: string }> {
    return this.request<{ externalId: string; status: string }>('POST', '/bookings', {
      idempotencyKey: input.booking.idempotencyKey,
      clientId: input.client.externalId ?? input.client.id,
      serviceCode: input.booking.serviceId,
      specialistCode: input.booking.specialistId,
      slotStart: input.booking.slotStart.toISOString(),
      slotEnd: input.booking.slotEnd.toISOString(),
    });
  }

  async cancelBooking(externalId: string): Promise<{ status: string }> {
    return this.request<{ status: string }>(
      'POST',
      `/bookings/${encodeURIComponent(externalId)}/cancel`,
    );
  }

  async rescheduleBooking(
    externalId: string,
    newSlot: ScheduleSlot,
  ): Promise<{ status: string; slotStart: Date; slotEnd: Date }> {
    const res = await this.request<{ status: string; slotStart: string; slotEnd: string }>(
      'POST',
      `/bookings/${encodeURIComponent(externalId)}/reschedule`,
      {
        serviceCode: newSlot.serviceId,
        specialistCode: newSlot.specialistId,
        slotStart: newSlot.startAt.toISOString(),
        slotEnd: newSlot.endAt.toISOString(),
      },
    );
    return {
      status: res.status,
      slotStart: new Date(res.slotStart),
      slotEnd: new Date(res.slotEnd),
    };
  }

  /**
   * Запрос с ретраями транспортных ошибок (сеть/таймаут/5xx).
   * Ошибки 4xx пробрасываются сразу с кодом из тела ответа 1С.
   */
  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let retriesDone = 0;

    for (;;) {
      let outcome: { kind: 'OK'; result: RequestResult } | { kind: TransportErrorKind };
      try {
        outcome = { kind: 'OK', result: await this.attempt(method, url, body) };
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === 'AbortError';
        outcome = { kind: isTimeout ? 'TIMEOUT' : 'NETWORK' };
      }

      if (outcome.kind === 'OK') {
        const { result } = outcome;
        if (result.ok) {
          this.logger?.debug({ method, url, status: result.status }, '1C response');
          return result.body as T;
        }
        if (result.status >= 500) {
          const transportKind = `HTTP_${result.status}`;
          if (!(await this.backoff(transportKind, retriesDone))) {
            const code = extractErrorCode(result.body) ?? transportKind;
            throw new OneCError(
              code,
              `1С вернула ${result.status} для ${method} ${path}`,
              result.status,
            );
          }
          retriesDone += 1;
          continue;
        }
        // 4xx: детерминированная ошибка — без ретраев
        const code = extractErrorCode(result.body) ?? `HTTP_${result.status}`;
        const message =
          extractErrorMessage(result.body) ?? `1С вернула ${result.status} для ${method} ${path}`;
        throw new OneCError(code, message, result.status);
      }

      // транспортная ошибка (TIMEOUT/NETWORK)
      if (!(await this.backoff(outcome.kind, retriesDone))) {
        throw new OneCError(
          'E_TIMEOUT',
          `Транспортная ошибка 1С (${outcome.kind}): ${method} ${path}`,
        );
      }
      retriesDone += 1;
    }
  }

  /** @returns true, если был выполнен ретрай (задержка применена) */
  private async backoff(kind: string, retriesDone: number): Promise<boolean> {
    const delay = nextRetryDelayMs(retriesDone, this.policy);
    if (delay === null) {
      return false;
    }
    this.logger?.warn({ retry: retriesDone + 1, delayMs: delay, kind }, 'retrying 1C request');
    await this.sleep(delay);
    return true;
  }

  private async attempt(
    method: 'GET' | 'POST',
    url: string,
    body?: unknown,
  ): Promise<RequestResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { message: text };
        }
      }
      return { ok: res.ok, status: res.status, body: parsed };
    } finally {
      clearTimeout(timer);
    }
  }
}

interface RawSlot {
  id?: string | number;
  serviceId?: string;
  serviceCode?: string;
  specialistId?: string;
  specialistCode?: string;
  startAt: string;
  endAt: string;
  capacity?: number | string;
  bookedCount?: number | string;
}

interface RawService {
  id?: string | number;
  code?: string | number;
  name?: string;
  direction?: string;
  price?: number | string | null;
  active?: boolean;
}

interface RawSpecialist {
  id?: string | number;
  code?: string | number;
  name?: string;
  fullName?: string;
  phone?: string;
  active?: boolean;
}

function extractErrorCode(body: unknown): string | undefined {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const code = record.code ?? record.errorCode ?? record.error;
    if (typeof code === 'string' && code) return code;
  }
  return undefined;
}

function extractErrorMessage(body: unknown): string | undefined {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const message = record.message ?? record.error_description ?? record.detail;
    if (typeof message === 'string' && message) return message;
  }
  return undefined;
}
