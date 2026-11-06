import { describe, expect, it } from 'vitest';
import { RealOneCClient } from '../../src/infrastructure/onec/RealOneCClient';
import { OneCError } from '../../src/domain/errors';
import { loadEnv } from '../../src/config/env';
import { createOneCClient } from '../../src/infrastructure/onec/factory';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('RealOneCClient', () => {
  it('отправляет токен и разбирает успешный ответ', async () => {
    const seen: { url: string; auth: string | null } = { url: '', auth: null };
    const client = new RealOneCClient({
      baseUrl: 'https://onec.example/api/',
      token: 'secret-token',
      fetchFn: async (url, init) => {
        seen.url = String(url);
        seen.auth = new Headers(init?.headers).get('Authorization');
        if (seen.url.endsWith('/services')) {
          return jsonResponse(200, []);
        }
        return jsonResponse(200, { externalId: 'L-1C-0001', status: 'CREATED' });
      },
    });

    const res = await client.getServices();
    expect(seen.url).toBe('https://onec.example/api/services');
    expect(seen.auth).toBe('Bearer secret-token');
    expect(res).toEqual([]);

    const lead = await client.sendLead({
      lead: {
        id: 'l1',
        clientId: null,
        source: 'VK',
        payloadJson: '{}',
        status: 'NEW',
        idempotencyKey: 'k1',
        externalId: null,
        errorCode: null,
        errorMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      client: null,
    });
    expect(lead).toEqual({ externalId: 'L-1C-0001', status: 'CREATED' });
    expect(seen.url).toBe('https://onec.example/api/leads');
  });

  it('ретраит 5xx с экспоненциальной задержкой (max 3), затем бросает ошибку', async () => {
    let attempts = 0;
    const delays: number[] = [];
    const client = new RealOneCClient({
      baseUrl: 'https://onec.example',
      token: 't',
      fetchFn: async () => {
        attempts += 1;
        return jsonResponse(503, { message: 'занято' });
      },
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    await expect(client.getSchedule({})).rejects.toThrow(OneCError);
    expect(attempts).toBe(4); // 1 попытка + 3 ретрая
    expect(delays).toEqual([1000, 2000, 4000]);
  });

  it('после ретраев 5xx успех → результат возвращается', async () => {
    let attempts = 0;
    const client = new RealOneCClient({
      baseUrl: 'https://onec.example',
      token: 't',
      fetchFn: async () => {
        attempts += 1;
        if (attempts < 3) return jsonResponse(500, { message: 'err' });
        return jsonResponse(200, [
          {
            id: 's1',
            serviceId: 'A',
            specialistId: 'B',
            startAt: '2027-01-01T10:00:00.000Z',
            endAt: '2027-01-01T11:00:00.000Z',
            capacity: 5,
            bookedCount: 1,
          },
        ]);
      },
      sleep: async () => {},
    });

    const slots = await client.getSchedule({});
    expect(attempts).toBe(3);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ serviceId: 'A', capacity: 5, bookedCount: 1 });
  });

  it('4xx без ретраев, код ошибки из тела 1С маппится доменом', async () => {
    let attempts = 0;
    const client = new RealOneCClient({
      baseUrl: 'https://onec.example',
      token: 't',
      fetchFn: async () => {
        attempts += 1;
        return jsonResponse(409, { code: 'E_NO_SEATS', message: 'Нет мест' });
      },
      sleep: async () => {},
    });

    await expect(client.getServices()).rejects.toMatchObject({
      rawCode: 'E_NO_SEATS',
      httpStatus: 409,
    });
    expect(attempts).toBe(1);
  });

  it('сетевая ошибка → ретраи, затем E_TIMEOUT/E_* ошибка', async () => {
    let attempts = 0;
    const client = new RealOneCClient({
      baseUrl: 'https://onec.example',
      token: 't',
      fetchFn: async () => {
        attempts += 1;
        throw new TypeError('fetch failed');
      },
      sleep: async () => {},
    });

    await expect(client.getSpecialists()).rejects.toThrow(OneCError);
    expect(attempts).toBe(4);
  });
});

describe('factory: переключение режимов через env', () => {
  it('по умолчанию — mock (реальных вызовов нет)', () => {
    const env = loadEnv({});
    expect(env.ONEC_MODE).toBe('mock');
    expect(createOneCClient(env).mode).toBe('mock');
  });

  it('ONEC_MODE=real без BASE_URL/TOKEN — ошибка конфигурации', () => {
    expect(() => loadEnv({ ONEC_MODE: 'real' })).toThrow(/ONEC_BASE_URL/);
  });

  it('ONEC_MODE=real с настройками — Real-адаптер', () => {
    const env = loadEnv({
      ONEC_MODE: 'real',
      ONEC_BASE_URL: 'https://onec.example',
      ONEC_TOKEN: 'tok',
    });
    const client = createOneCClient(env);
    expect(client.mode).toBe('real');
  });
});
