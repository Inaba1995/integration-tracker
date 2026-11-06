import { Fragment, useState } from 'react';
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
import type { WebhookEvent } from '../types';

const STATUS_COLORS: Record<string, string> = {
  RECEIVED: 'blue',
  PROCESSED: 'green',
  DUPLICATE: 'amber',
  FAILED: 'red',
};

export default function WebhooksPage() {
  const canWrite = useCanWrite();
  const { data: events, error, loading, reload } = useApi<WebhookEvent[]>('/webhooks?limit=100');
  const [statusFilter, setStatusFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [form, setForm] = useState({
    eventType: 'lead.created',
    idempotencyKey: `ui-${Date.now()}`,
    payload:
      '{\n  "source": "TELEGRAM",\n  "client": {\n    "fullName": "Демо Клиент",\n    "phone": "+7 900 555-66-77"\n  }\n}',
  });
  const [showForm, setShowForm] = useState(false);

  const filtered = (events ?? []).filter((e) => !statusFilter || e.status === statusFilter);

  const reprocess = async (id: string) => {
    setActionError(null);
    try {
      const res = await api<{ status: string; error?: { message: string } }>(
        `/webhooks/${id}/reprocess`,
        { method: 'POST' },
      );
      setNotice(`Повтор: ${res.status}${res.error ? ` (${res.error.message})` : ''}`);
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  const sendTest = async () => {
    setActionError(null);
    let payload: unknown;
    try {
      payload = JSON.parse(form.payload);
    } catch {
      setActionError('Payload — не валидный JSON');
      return;
    }
    try {
      // Аутентификация — JWT из localStorage (без секрета в браузере).
      const res = await api<{ status: string; duplicate: boolean }>('/webhooks/1c', {
        method: 'POST',
        body: {
          source: 'console',
          eventType: form.eventType,
          idempotencyKey: form.idempotencyKey,
          payload,
        },
      });
      setNotice(`Событие: ${res.status}${res.duplicate ? ' (повтор ключа!)' : ''}`);
      setForm({ ...form, idempotencyKey: `ui-${Date.now()}` });
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <PageTitle subtitle="Повтор ключа → DUPLICATE (бизнес-сущности не создаются)">
        Webhook Console
      </PageTitle>
      <ErrorBanner message={error ?? actionError} />
      <SuccessBanner message={notice} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Все статусы</option>
          {['RECEIVED', 'PROCESSED', 'DUPLICATE', 'FAILED'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <div className="ml-auto">
          {canWrite && (
            <Button onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Скрыть' : '+ Тестовое событие'}
            </Button>
          )}
        </div>
      </div>

      {showForm && (
        <Card className="mb-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-slate-500">eventType</label>
              <Input
                value={form.eventType}
                onChange={(e) => setForm({ ...form, eventType: e.target.value })}
                className="w-full"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">idempotencyKey</label>
              <Input
                value={form.idempotencyKey}
                onChange={(e) => setForm({ ...form, idempotencyKey: e.target.value })}
                className="w-full"
                title="Повтор с тем же ключом даст DUPLICATE"
              />
            </div>
            <div className="flex items-end">
              <Button onClick={() => void sendTest()} disabled={!form.idempotencyKey.trim()}>
                Отправить (дважды — проверьте дубль)
              </Button>
            </div>
          </div>
          <div className="mt-3">
            <label className="mb-1 block text-xs text-slate-500">payload (JSON)</label>
            <textarea
              value={form.payload}
              onChange={(e) => setForm({ ...form, payload: e.target.value })}
              rows={7}
              className="w-full rounded-lg border border-slate-300 p-2 font-mono text-xs focus:border-sky-500 focus:outline-none"
            />
          </div>
        </Card>
      )}

      <Table headers={['Время', 'Тип', 'Источник', 'Статус', 'Ключ', '', '']}>
        {filtered.length ? (
          filtered.map((e) => (
            <Fragment key={e.id}>
              <tr
                className={
                  e.status === 'DUPLICATE' || e.status === 'FAILED' ? 'bg-amber-50/60' : ''
                }
              >
                <td className="px-3 py-2 text-slate-500">{fmtDateTime(e.receivedAt)}</td>
                <td className="px-3 py-2">{e.eventType}</td>
                <td className="px-3 py-2">{e.source}</td>
                <td className="px-3 py-2">
                  <Badge color={STATUS_COLORS[e.status]}>{e.status}</Badge>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{e.idempotencyKey}</td>
                <td className="px-3 py-2">
                  <Button
                    variant="ghost"
                    onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                  >
                    Payload
                  </Button>
                </td>
                <td className="px-3 py-2">
                  {canWrite && (
                    <Button variant="secondary" onClick={() => void reprocess(e.id)}>
                      Повторить
                    </Button>
                  )}
                </td>
              </tr>
              {expanded === e.id && (
                <tr>
                  <td colSpan={7} className="bg-slate-50 px-3 py-2">
                    <pre className="max-h-56 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
                      {prettyJson(e.payloadJson)}
                    </pre>
                  </td>
                </tr>
              )}
            </Fragment>
          ))
        ) : (
          <tr>
            <td colSpan={7}>
              <Empty text="Событий нет" />
            </td>
          </tr>
        )}
      </Table>
    </div>
  );
}

function prettyJson(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}
