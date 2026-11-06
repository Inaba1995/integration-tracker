import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorBanner,
  PageTitle,
  Spinner,
  Table,
  fmtMoney,
} from '../components';
import { api } from '../api';
import { useApi } from '../hooks';
import type { StandardVsCustomRow } from '../types';

const IMPL_LABELS: Record<string, string> = {
  STANDARD_API: 'Стандартный API',
  EXTENSION: 'Расширение конфигурации',
  CUSTOM_HTTP_SERVICE: 'Кастомный HTTP-сервис',
  TBD: 'Требует уточнения',
};

const IMPL_COLORS: Record<string, string> = {
  STANDARD_API: 'green',
  EXTENSION: 'amber',
  CUSTOM_HTTP_SERVICE: 'violet',
  TBD: 'slate',
};

const STATUS_COLORS: Record<string, string> = {
  PLANNED: 'slate',
  IN_PROGRESS: 'blue',
  BLOCKED: 'red',
  DONE: 'green',
};

interface ReportResponse {
  labels: Record<string, string>;
  rows: StandardVsCustomRow[];
}

export default function ReportPage() {
  const { data, error, loading } = useApi<ReportResponse>('/reports/standard-vs-custom');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const exportCsv = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const csv = await api<string>('/reports/standard-vs-custom.csv', { raw: true });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'standard-vs-custom.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <Spinner />;

  const rows = data?.rows ?? [];
  const byType = new Map<string, { count: number; days: number; cost: number }>();
  for (const r of rows) {
    const current = byType.get(r.implementationType) ?? { count: 0, days: 0, cost: 0 };
    current.count += 1;
    current.days += r.estimateDays ?? 0;
    current.cost += r.estimateCost ?? 0;
    byType.set(r.implementationType, current);
  }

  const totalDays = rows.reduce((s, r) => s + (r.estimateDays ?? 0), 0);
  const totalCost = rows.reduce((s, r) => s + (r.estimateCost ?? 0), 0);
  const totalTasks = rows.reduce((s, r) => s + r.tasksTotal, 0);
  const doneTasks = rows.reduce((s, r) => s + r.tasksDone, 0);

  return (
    <div>
      <PageTitle subtitle="Экспорт: CSV (кнопка) и PDF (печать браузера)">
        Отчёт: Стандартный API vs Доработки
      </PageTitle>
      <ErrorBanner message={error ?? exportError} />

      <div className="no-print mb-4 flex gap-2">
        <Button onClick={() => void exportCsv()} disabled={exporting}>
          {exporting ? 'Готовим CSV…' : '⬇ Экспорт CSV'}
        </Button>
        <Button variant="secondary" onClick={() => window.print()}>
          🖨 Печать / PDF
        </Button>
        <Link to="/" className="self-center text-sm text-sky-600 hover:underline">
          ← Dashboard
        </Link>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <div className="text-xs uppercase text-slate-500">Всего функций</div>
          <div className="text-2xl font-semibold">{rows.length}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-slate-500">Через стандартный API</div>
          <div className="text-2xl font-semibold text-emerald-600">
            {byType.get('STANDARD_API')?.count ?? 0}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-slate-500">Доработки / расширения</div>
          <div className="text-2xl font-semibold text-amber-600">
            {(byType.get('EXTENSION')?.count ?? 0) +
              (byType.get('CUSTOM_HTTP_SERVICE')?.count ?? 0)}
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-slate-500">Итого: дней / ₽</div>
          <div className="text-2xl font-semibold">
            {totalDays} дн · {fmtMoney(totalCost)} ₽
          </div>
        </Card>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-4">
        {['STANDARD_API', 'EXTENSION', 'CUSTOM_HTTP_SERVICE', 'TBD'].map((type) => {
          const stat = byType.get(type);
          return (
            <Card key={type}>
              <div className="mb-1 text-xs font-medium text-slate-600">
                <Badge color={IMPL_COLORS[type]}>{IMPL_LABELS[type]}</Badge>
              </div>
              <div className="text-sm text-slate-500">
                {stat?.count ?? 0} фич · {stat?.days ?? 0} дн · {fmtMoney(stat?.cost ?? 0)} ₽
              </div>
            </Card>
          );
        })}
      </div>

      <Table
        headers={[
          'Код',
          'Функция',
          'Статус',
          'Тип реализации',
          'Приоритет',
          'Дней',
          'Стоимость, ₽',
          'Задачи',
        ]}
      >
        {rows.length ? (
          rows.map((r) => (
            <tr key={r.code}>
              <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
              <td className="px-3 py-2">
                <div className="font-medium">{r.title}</div>
                {r.notes ? <div className="text-xs text-slate-400">{r.notes}</div> : null}
              </td>
              <td className="px-3 py-2">
                <Badge color={STATUS_COLORS[r.status]}>{r.status}</Badge>
              </td>
              <td className="px-3 py-2">
                <Badge color={IMPL_COLORS[r.implementationType]}>
                  {IMPL_LABELS[r.implementationType] ?? r.implementationType}
                </Badge>
              </td>
              <td className="px-3 py-2">{r.priority}</td>
              <td className="px-3 py-2 text-right">{r.estimateDays ?? '—'}</td>
              <td className="px-3 py-2 text-right">{fmtMoney(r.estimateCost)}</td>
              <td className="px-3 py-2 text-center">
                {r.tasksDone}/{r.tasksTotal}
              </td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={8}>
              <Empty text="Нет данных" />
            </td>
          </tr>
        )}
        {rows.length ? (
          <tr className="bg-slate-50 font-semibold">
            <td className="px-3 py-2" colSpan={5}>
              Итого
            </td>
            <td className="px-3 py-2 text-right">{totalDays}</td>
            <td className="px-3 py-2 text-right">{fmtMoney(totalCost)}</td>
            <td className="px-3 py-2 text-center">
              {doneTasks}/{totalTasks}
            </td>
          </tr>
        ) : null}
      </Table>
    </div>
  );
}
