import type { Role } from '../domain/entities/index';
import type { OneCClient } from '../domain/ports/onec';
import type { Repositories } from '../domain/ports/repositories';
import type { RetryRunner } from '../domain/ports/retry';

/** Кто выполнил действие (для audit-лога и авторизации). */
export interface Actor {
  id: string | null;
  email: string;
  role: Role;
}

/** Хранилище активного адаптера 1С (позволяет переключать mock/real в Settings). */
export interface AdapterHolder {
  get(): OneCClient;
  set(client: OneCClient): void;
}

/** Контекст прикладного слоя: репозитории, адаптер 1С, ретраи, время, актор. */
export interface AppContext {
  repos: Repositories;
  adapter: AdapterHolder;
  retry: RetryRunner;
  clock(): Date;
  correlationId?: string;
  actor?: Actor;
}

export function systemActor(): Actor {
  return { id: null, email: 'system', role: 'ADMIN' };
}

/** Возвращает контекст с заполненными correlationId/актором (на запрос). */
export function withRequest(
  ctx: AppContext,
  patch: { correlationId?: string; actor?: Actor },
): AppContext {
  return {
    ...ctx,
    correlationId: patch.correlationId ?? ctx.correlationId,
    actor: patch.actor ?? ctx.actor,
  };
}
