import { Fragment, useMemo, useState } from 'react';
import { useCanWrite } from '../auth';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorBanner,
  Input,
  PageTitle,
  Select,
  Spinner,
  SuccessBanner,
  Table,
  fmtDateTime,
} from '../components';
import { api, errorMessage } from '../api';
import { useApi } from '../hooks';
import type { Booking, Client, Lead, ScheduleSlot, Service, Specialist } from '../types';

const BOOKING_COLORS: Record<string, string> = {
  PENDING: 'amber',
  CONFIRMED: 'green',
  CANCELLED: 'slate',
  RESCHEDULED: 'violet',
};

export default function BookingsPage() {
  const canWrite = useCanWrite();
  const { data: bookings, error, loading, reload } = useApi<Booking[]>('/bookings');
  const { data: slots } = useApi<ScheduleSlot[]>('/schedule');
  const { data: clients } = useApi<Client[]>('/clients');
  const { data: services } = useApi<Service[]>('/services');
  const { data: specialists } = useApi<Specialist[]>('/specialists');
  const { data: leads } = useApi<Lead[]>('/leads?limit=20');

  const [statusFilter, setStatusFilter] = useState('');
  const [movingId, setMovingId] = useState<string | null>(null);
  const [targetSlot, setTargetSlot] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [form, setForm] = useState({
    clientId: '',
    slotId: '',
    idempotencyKey: `ui-${Date.now()}`,
  });
  const [showForm, setShowForm] = useState(false);

  const clientById = useMemo(() => new Map((clients ?? []).map((c) => [c.id, c])), [clients]);
  const serviceName = (code: string) => services?.find((s) => s.code === code)?.name ?? code;
  const specialistName = (code: string) =>
    specialists?.find((s) => s.code === code)?.fullName ?? code;

  const filtered = (bookings ?? []).filter((b) => !statusFilter || b.status === statusFilter);

  const run = async (fn: () => Promise<string>) => {
    setActionError(null);
    try {
      const message = await fn();
      setNotice(message);
      setTimeout(() => setNotice(null), 3000);
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  const cancel = (id: string) =>
    run(async () => {
      await api(`/bookings/${id}/cancel`, { method: 'POST' });
      return 'Запись отменена, место освобождено';
    });

  const reschedule = (id: string) =>
    run(async () => {
      await api(`/bookings/${id}/reschedule`, {
        method: 'POST',
        body: { targetSlotId: targetSlot },
      });
      setMovingId(null);
      return 'Запись перенесена';
    });

  const createBooking = () =>
    run(async () => {
      const res = await api<{ booking: Booking; duplicate: boolean }>('/bookings', {
        method: 'POST',
        body: form,
      });
      setForm({ clientId: '', slotId: '', idempotencyKey: `ui-${Date.now()}` });
      setShowForm(false);
      return res.duplicate
        ? 'Дубликат по idempotencyKey — запись не создана'
        : 'Клиент записан (CONFIRMED)';
    });

  const sync = () =>
    run(async () => {
      setSyncing(true);
      try {
        const res = await api<{ slots: number; services: number; specialists: number }>(
          '/schedule/sync',
          {
            method: 'POST',
          },
        );
        return `Синхронизировано: слотов ${res.slots}, услуг ${res.services}, специалистов ${res.specialists}`;
      } finally {
        setSyncing(false);
      }
    });

  if (loading) return <Spinner />;

  const freeSlots = (slots ?? []).filter((s) => s.bookedCount < s.capacity);

  return (
    <div>
      <PageTitle subtitle="Отмена/перенос — только для CONFIRMED (освобождение/перераспределение мест)">
        Записи и расписание
      </PageTitle>
      <ErrorBanner message={error ?? actionError} />
      <SuccessBanner message={notice} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Все статусы</option>
          {['PENDING', 'CONFIRMED', 'CANCELLED', 'RESCHEDULED'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        {canWrite && (
          <Button variant="secondary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Скрыть форму' : '+ Записать клиента'}
          </Button>
        )}
        {canWrite && (
          <Button variant="secondary" onClick={() => void sync()} disabled={syncing}>
            {syncing ? 'Синхронизация…' : '⟳ Синхронизировать расписание'}
          </Button>
        )}
      </div>

      {showForm && (
        <Card className="mb-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs text-slate-500">Клиент</label>
              <Select
                value={form.clientId}
                onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                className="w-full"
              >
                <option value="">— выберите —</option>
                {(clients ?? []).map((c) => (
                  <option key={c.id} value={c.id} disabled={!c.active}>
                    {c.fullName} {c.phone} {c.active ? '' : '(неактивен)'}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">Слот</label>
              <Select
                value={form.slotId}
                onChange={(e) => setForm({ ...form, slotId: e.target.value })}
                className="w-full"
              >
                <option value="">— выберите —</option>
                {freeSlots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {fmtDateTime(s.startAt)} · {serviceName(s.serviceId)} ·{' '}
                    {specialistName(s.specialistId)} · свободно {s.capacity - s.bookedCount}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">idempotencyKey</label>
              <Input
                value={form.idempotencyKey}
                onChange={(e) => setForm({ ...form, idempotencyKey: e.target.value })}
                className="w-full"
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={() => void createBooking()}
                disabled={!form.clientId || !form.slotId || !form.idempotencyKey}
              >
                Записать
              </Button>
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <div>
          <div className="mb-2 text-sm font-semibold text-slate-700">Записи</div>
          <Table headers={['Клиента', 'Услуга', 'Специалист', 'Слот', 'Статус', 'Действия']}>
            {filtered.length ? (
              filtered.map((b) => (
                <Fragment key={b.id}>
                  <tr>
                    <td className="px-3 py-2">
                      {clientById.get(b.clientId)?.fullName ?? b.clientId}
                    </td>
                    <td className="px-3 py-2">{serviceName(b.serviceId)}</td>
                    <td className="px-3 py-2">{specialistName(b.specialistId)}</td>
                    <td className="px-3 py-2 text-slate-500">{fmtDateTime(b.slotStart)}</td>
                    <td className="px-3 py-2">
                      <Badge color={BOOKING_COLORS[b.status]}>{b.status}</Badge>
                      {b.errorCode ? (
                        <div className="text-xs text-rose-600">{b.errorCode}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      {canWrite && b.status === 'CONFIRMED' ? (
                        <div className="flex gap-1">
                          <Button variant="danger" onClick={() => void cancel(b.id)}>
                            Отменить
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setMovingId(movingId === b.id ? null : b.id);
                              setTargetSlot('');
                            }}
                          >
                            Перенести
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                  {movingId === b.id && (
                    <tr>
                      <td colSpan={6} className="bg-slate-50 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Select
                            value={targetSlot}
                            onChange={(e) => setTargetSlot(e.target.value)}
                          >
                            <option value="">— целевой слот —</option>
                            {freeSlots
                              .filter((s) => s.id !== b.scheduleSlotId)
                              .map((s) => (
                                <option key={s.id} value={s.id}>
                                  {fmtDateTime(s.startAt)} · {serviceName(s.serviceId)} · свободно{' '}
                                  {s.capacity - s.bookedCount}
                                </option>
                              ))}
                          </Select>
                          <Button onClick={() => void reschedule(b.id)} disabled={!targetSlot}>
                            Перенести
                          </Button>
                          <Button variant="ghost" onClick={() => setMovingId(null)}>
                            Отмена
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            ) : (
              <tr>
                <td colSpan={6}>
                  <Empty text="Записей нет" />
                </td>
              </tr>
            )}
          </Table>
        </div>

        <div>
          <div className="mb-2 text-sm font-semibold text-slate-700">Слоты расписания</div>
          <Table headers={['Слот', 'Услуга', 'Специалист', 'Места']}>
            {(slots ?? []).length ? (
              (slots ?? []).map((s) => {
                const free = s.capacity - s.bookedCount;
                return (
                  <tr key={s.id}>
                    <td className="px-3 py-2 text-slate-500">{fmtDateTime(s.startAt)}</td>
                    <td className="px-3 py-2">{serviceName(s.serviceId)}</td>
                    <td className="px-3 py-2">{specialistName(s.specialistId)}</td>
                    <td className="px-3 py-2">
                      {free > 0 ? (
                        <Badge color="green">
                          свободно {free} из {s.capacity}
                        </Badge>
                      ) : (
                        <Badge color="red">мест нет</Badge>
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={4}>
                  <Empty text="Слотов нет — выполните синхронизацию" />
                </td>
              </tr>
            )}
          </Table>
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-2 text-sm font-semibold text-slate-700">Заявки (лиды)</div>
        <Table headers={['Создана', 'Источник', 'Статус', 'Внешний ID', 'Ключ']}>
          {(leads ?? []).length ? (
            (leads ?? []).map((l) => (
              <tr key={l.id}>
                <td className="px-3 py-2 text-slate-500">{fmtDateTime(l.createdAt)}</td>
                <td className="px-3 py-2">{l.source}</td>
                <td className="px-3 py-2">
                  <Badge
                    color={
                      l.status === 'ERROR' ? 'red' : l.status === 'SENT_TO_1C' ? 'green' : 'blue'
                    }
                  >
                    {l.status}
                  </Badge>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{l.externalId ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{l.idempotencyKey}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={5}>
                <Empty text="Заявок нет" />
              </td>
            </tr>
          )}
        </Table>
      </div>
    </div>
  );
}
