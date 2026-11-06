import type { Booking, Client, Lead, ScheduleSlot, Service, Specialist } from '../entities/index';

/**
 * Интерфейс адаптера 1С. Домен знает только этот контракт;
 * реализации (Mock / Real) находятся в infrastructure/onec.
 * Все ошибки адаптера бросаются как OneCError с rawCode из 1С —
 * маппинг во внутренние коды выполняется правилом rules/oneCErrors.
 */

export type OneCMode = 'mock' | 'real';

export interface SendLeadInput {
  lead: Lead;
  client: Client | null;
}

export interface CreateBookingInput {
  booking: Booking;
  slot: ScheduleSlot;
  client: Client;
}

export interface ScheduleQuery {
  from?: Date;
  to?: Date;
  serviceCode?: string;
  specialistCode?: string;
}

export interface OneCClient {
  readonly mode: OneCMode;

  /** Передача заявки (лида) в 1С. */
  sendLead(input: SendLeadInput): Promise<{ externalId: string; status: string }>;

  /** Получение актуального расписания (слотов). */
  getSchedule(params: ScheduleQuery): Promise<ScheduleSlot[]>;

  /** Список услуг и направлений. */
  getServices(): Promise<Service[]>;

  /** Список специалистов. */
  getSpecialists(): Promise<Specialist[]>;

  /** Создание записи на занятие. */
  createBooking(input: CreateBookingInput): Promise<{ externalId: string; status: string }>;

  /** Отмена записи. */
  cancelBooking(externalId: string): Promise<{ status: string }>;

  /** Перенос записи на новый слот. */
  rescheduleBooking(
    externalId: string,
    newSlot: ScheduleSlot,
  ): Promise<{ status: string; slotStart: Date; slotEnd: Date }>;
}
