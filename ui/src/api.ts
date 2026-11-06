const TOKEN_KEY = 'tracker.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Сырой ответ (CSV). */
  raw?: boolean;
}

/** Обёртка над REST API: JWT из localStorage, единая обработка ошибок. */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (options.raw) {
    const text = await res.text();
    if (!res.ok) throw toApiError(res, text);
    return text as unknown as T;
  }

  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const error = (json as { error?: { code?: string; message?: string; details?: unknown } })
      ?.error;
    throw new ApiError(
      error?.code ?? 'INTERNAL',
      error?.message ?? `Ошибка ${res.status}`,
      res.status,
      error?.details,
    );
  }
  return json as T;
}

function toApiError(res: Response, text: string): ApiError {
  try {
    const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } };
    return new ApiError(
      parsed.error?.code ?? 'INTERNAL',
      parsed.error?.message ?? `Ошибка ${res.status}`,
      res.status,
    );
  } catch {
    return new ApiError('INTERNAL', `Ошибка ${res.status}`, res.status);
  }
}

/** Человекочитаемое сообщение об ошибке (включая детали валидации). */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const details = Array.isArray(err.details)
      ? ': ' +
        err.details
          .map((d) => (d as { message?: string }).message ?? '')
          .filter(Boolean)
          .join('; ')
      : '';
    return `${err.message}${details}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
