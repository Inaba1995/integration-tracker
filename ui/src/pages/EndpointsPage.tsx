import { useState } from 'react';
import { useCanWrite } from '../auth';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorBanner,
  PageTitle,
  Select,
  Spinner,
  SuccessBanner,
  Table,
} from '../components';
import { api, errorMessage } from '../api';
import { useApi } from '../hooks';
import type { ApiEndpoint } from '../types';

const METHOD_COLORS: Record<string, string> = {
  GET: 'blue',
  POST: 'green',
  PATCH: 'amber',
  PUT: 'amber',
  DELETE: 'red',
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'slate',
  MOCKED: 'blue',
  LIVE: 'green',
  FAILING: 'red',
};

interface TestResult {
  endpointId: string;
  mode: 'mock' | 'real';
  durationMs: number;
  request: unknown;
  response: unknown;
  endpointStatus: string;
}

export default function EndpointsPage() {
  const canWrite = useCanWrite();
  const { data: endpoints, error, loading, reload } = useApi<ApiEndpoint[]>('/endpoints');
  const [directionFilter, setDirectionFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [result, setResult] = useState<TestResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const filtered = (endpoints ?? []).filter(
    (e) =>
      (!directionFilter || e.direction === directionFilter) &&
      (!statusFilter || e.status === statusFilter),
  );

  const test = async (id: string) => {
    setTestingId(id);
    setActionError(null);
    setResult(null);
    try {
      const res = await api<TestResult>(`/endpoints/${id}/test`, { method: 'POST' });
      setResult(res);
      setNotice(
        `Тест выполнен за ${res.durationMs} мс (${res.mode === 'mock' ? 'mock-симуляция' : 'real-запрос'})`,
      );
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
      reload();
    } finally {
      setTestingId(null);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <PageTitle subtitle="Тестовый запрос в mock-режиме — симуляция; мутирующие запросы в real заблокированы">
        API Explorer
      </PageTitle>
      <ErrorBanner message={error ?? actionError} />
      <SuccessBanner message={notice} />

      <div className="mb-4 flex gap-2">
        <Select value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value)}>
          <option value="">Все направления</option>
          <option value="OUTBOUND">OUTBOUND (трекер → 1С)</option>
          <option value="INBOUND">INBOUND (1С → трекер)</option>
        </Select>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Все статусы</option>
          {['DRAFT', 'MOCKED', 'LIVE', 'FAILING'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>

      <Table headers={['Метод', 'Путь', 'Название', 'Направление', 'Статус', 'Действие']}>
        {filtered.length ? (
          filtered.map((e) => (
            <tr key={e.id}>
              <td className="px-3 py-2">
                <Badge color={METHOD_COLORS[e.method]}>{e.method}</Badge>
              </td>
              <td className="px-3 py-2 font-mono text-xs">{e.path}</td>
              <td className="px-3 py-2">
                <div>{e.name}</div>
                {e.notes ? <div className="text-xs text-slate-400">{e.notes}</div> : null}
              </td>
              <td className="px-3 py-2">
                <Badge color={e.direction === 'OUTBOUND' ? 'violet' : 'sky'}>{e.direction}</Badge>
              </td>
              <td className="px-3 py-2">
                <Badge color={STATUS_COLORS[e.status]}>{e.status}</Badge>
              </td>
              <td className="px-3 py-2">
                <Button
                  variant="secondary"
                  disabled={!canWrite || testingId === e.id}
                  onClick={() => void test(e.id)}
                  title={canWrite ? '' : 'Нужна роль INTEGRATOR'}
                >
                  {testingId === e.id ? 'Выполняется…' : 'Тестовый запрос'}
                </Button>
              </td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={6}>
              <Empty text="Эндпоинтов нет" />
            </td>
          </tr>
        )}
      </Table>

      {result && (
        <Card className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-700">
              Результат теста · {result.durationMs} мс · {result.mode}
            </div>
            <Button variant="ghost" onClick={() => setResult(null)}>
              Закрыть
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-medium uppercase text-slate-500">Запрос</div>
              <pre className="max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
                {JSON.stringify(result.request, null, 2)}
              </pre>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium uppercase text-slate-500">Ответ</div>
              <pre className="max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
                {JSON.stringify(result.response, null, 2)}
              </pre>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
