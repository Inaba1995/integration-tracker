import { DomainError, isDomainError, isOneCError, type ErrorCode } from '../errors';

/**
 * Правило 4: маппинг кодов ошибок 1С → внутренние коды приложения.
 * Поддерживаются и латинские коды (E_*), и характерные для 1С кириллические.
 */
const ONEC_ERROR_MAP: Record<string, ErrorCode> = {
  // латинские коды адаптера/1С
  E_NO_SEATS: 'NO_SEATS',
  NO_SEATS: 'NO_SEATS',
  E_SLOT_BUSY: 'SLOT_TAKEN',
  SLOT_TAKEN: 'SLOT_TAKEN',
  E_SLOT_NOT_FOUND: 'SLOT_TAKEN',
  SLOT_NOT_FOUND: 'SLOT_TAKEN',
  E_CLIENT_INACTIVE: 'CLIENT_INACTIVE',
  CLIENT_INACTIVE: 'CLIENT_INACTIVE',
  E_DUPLICATE: 'DUPLICATE',
  DUPLICATE: 'DUPLICATE',
  E_VALIDATION: 'VALIDATION',
  VALIDATION: 'VALIDATION',
  E_NOT_FOUND: 'NOT_FOUND',
  E_AUTH: 'ONEC_UNAUTHORIZED',
  E_UNAUTHORIZED: 'ONEC_UNAUTHORIZED',
  E_TIMEOUT: 'ONEC_UNAVAILABLE',
  E_UNAVAILABLE: 'ONEC_UNAVAILABLE',
  HTTP_500: 'ONEC_UNAVAILABLE',
  HTTP_502: 'ONEC_UNAVAILABLE',
  HTTP_503: 'ONEC_UNAVAILABLE',
  TIMEOUT: 'ONEC_UNAVAILABLE',
  // кириллические коды типовых ошибок 1С
  НетМест: 'NO_SEATS',
  Занято: 'SLOT_TAKEN',
  СлотНедоступен: 'SLOT_TAKEN',
  КлиентНеАктивен: 'CLIENT_INACTIVE',
  Дублирование: 'DUPLICATE',
  ОшибкаАутентификации: 'ONEC_UNAUTHORIZED',
  ОшибкаВыполнения: 'ONEC_UNAVAILABLE',
};

export interface MappedOneCError {
  code: ErrorCode;
  known: boolean;
}

export function mapOneCError(rawCode: string): MappedOneCError {
  const normalized = rawCode.trim();
  const mapped = ONEC_ERROR_MAP[normalized] ?? ONEC_ERROR_MAP[normalized.toUpperCase()];
  if (mapped) {
    return { code: mapped, known: true };
  }
  return { code: 'ONEC_ERROR', known: false };
}

/**
 * Приводит любую ошибку адаптера/инфраструктуры к DomainError
 * с внутренним кодом (OneCError → маппинг кода 1С).
 */
export function toDomainError(err: unknown): DomainError {
  if (isDomainError(err)) {
    return err;
  }
  if (isOneCError(err)) {
    const { code, known } = mapOneCError(err.rawCode);
    return new DomainError(code, err.message, {
      rawCode: err.rawCode,
      httpStatus: err.httpStatus,
      known,
    });
  }
  if (err instanceof Error) {
    return new DomainError('INTERNAL', err.message, { cause: err.name });
  }
  return new DomainError('INTERNAL', String(err));
}
