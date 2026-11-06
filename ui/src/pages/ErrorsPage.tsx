import { Fragment, useState } from 'react';
import { useCanWrite } from '../auth';
import {
  Badge,
  Button,
  Empty,
  ErrorBanner,
  PageTitle,
  Select,
  Spinner,
  SuccessBanner,
  Table,
  fmtDateTime,
} from '../components';
import { api, errorMessage } from '../api';
import { useApi } from '../hooks';
import type { ErrorLog } from '../types';

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'amber',
  RETRYING: 'blue',
  FAILED: 'red',
  RESOLVED: 'green',
};

export default function ErrorsPage() {
  const canWrite = useCanWrite();
  const [status, setStatus] = useState('FAILED');
  const [context, setContext] = useState('');
  const query = `/errors?${new URLSearchParams({ ...(status ? { status } : {}), ...(context ? { context } : {}) })}`;
  const { data: errors, error, loading, reload } = useApi<ErrorLog[]>(query, [status, context]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const retry = async (id: string) => {
    setRetryingId(id);
    setActionError(null);
    try {
      const res = await api<ErrorLog>(`/errors/${id}/retry`, { method: 'POST' });
      setNotice(`Повтор завершён: ${res.status}`);
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
      reload();
    } finally {
      setRetryingId(null);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <PageTitle subtitle="Ретраи: экспоненциальная задержка, max 3 → FAILED; кнопка — повтор">
        Журнал ошибок
      </PageTitle>
      <ErrorBanner message={error ?? actionError} />
      <SuccessBanner message={notice} />

      <div className="mb-4 flex gap-2">
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Все статусы</option>
          {['PENDING', 'RETRYING', 'FAILED', 'RESOLVED'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select value={context} onChange={(e) => setContext(e.target.value)}>
          <option value="">Все контексты</option>
          {['lead.send', 'booking.create', 'schedule.sync', 'webhook'].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </div>

      <Table
        headers={[
          'Создана',
          'Контекст',
          'Код (внутр.)',
          'Код 1С',
          'Сообщение',
          'Ретраи',
          'Статус',
          '',
        ]}
      >
        {errors?.length ? (
          errors.map((e) => (
            <Fragment key={e.id}>
              <tr className={e.status === 'FAILED' ? 'bg-rose-50/50' : ''}>
                <td className="px-3 py-2 text-slate-500">{fmtDateTime(e.createdAt)}</td>
                <td className="px-3 py-2 font-mono text-xs">{e.context}</td>
                <td className="px-3 py-2">
                  <Badge color="red">{e.errorCode}</Badge>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{e.rawCode || '—'}</td>
                <td className="max-w-md truncate px-3 py-2">{e.message}</td>
                <td className="px-3 py-2 text-center">{e.retryCount}</td>
                <td className="px-3 py-2">
                  <Badge color={STATUS_COLORS[e.status]}>{e.status}</Badge>
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                    >
                      Payload
                    </Button>
                    {canWrite && e.status !== 'RESOLVED' && (
                      <Button
                        variant="secondary"
                        disabled={retryingId === e.id}
                        onClick={() => void retry(e.id)}
                      >
                        {retryingId === e.id ? '…' : 'Повторить'}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
              {expanded === e.id && (
                <tr>
                  <td colSpan={8} className="bg-slate-50 px-3 py-2">
                    <pre className="max-h-56 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
                      {pretty(e.payloadJson)}
                    </pre>
                  </td>
                </tr>
              )}
            </Fragment>
          ))
        ) : (
          <tr>
            <td colSpan={8}>
              <Empty text="Ошибок по фильтру нет" />
            </td>
          </tr>
        )}
      </Table>
    </div>
  );
}

function pretty(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}
