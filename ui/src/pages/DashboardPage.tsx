import { Link } from 'react-router-dom';
import {
  Card,
  Empty,
  ErrorBanner,
  PageTitle,
  Spinner,
  StatCard,
  Table,
  Badge,
  fmtDateTime,
  fmtMoney,
} from '../components';
import { useApi } from '../hooks';
import type { SummaryReport, WebhookEvent } from '../types';

const STATUS_COLORS: Record<string, string> = {
  PLANNED: 'slate',
  IN_PROGRESS: 'blue',
  BLOCKED: 'red',
  DONE: 'green',
  FAILED: 'red',
  RESOLVED: 'green',
  RETRYING: 'amber',
  PENDING: 'amber',
  DUPLICATE: 'amber',
  PROCESSED: 'green',
  RECEIVED: 'blue',
  CONFIRMED: 'green',
  CANCELLED: 'slate',
  RESCHEDULED: 'violet',
  SENT_TO_1C: 'green',
  NEW: 'blue',
  ERROR: 'red',
};

export function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? 'slate';
}

const TYPE_LABELS: Record<string, string> = {
  STANDARD_API: 'Стандартный API',
  EXTENSION: 'Расширение',
  CUSTOM_HTTP_SERVICE: 'Кастомный HTTP-сервис',
  TBD: 'Требует уточнения',
};

export { TYPE_LABELS };

export default function DashboardPage() {
  const { data: summary, error, loading } = useApi<SummaryReport>('/reports/summary');
  const { data: webhooks } = useApi<WebhookEvent[]>('/webhooks?limit=8');

  if (loading) return <Spinner />;

  const failed = summary?.errors.byStatus.find((s) => s.status === 'FAILED')?.count ?? 0;
  const duplicated = summary ? summary.duplicates.webhookEvents + summary.duplicates.leads : 0;

  return (
    <div>
      <PageTitle
        subtitle={
          summary
            ? `Клиентов: ${summary.inventory.clients} · Слотов: ${summary.inventory.slots}`
            : ''
        }
      >
        Dashboard
      </PageTitle>
      <ErrorBanner message={error} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Фичи"
          value={summary?.features.total ?? 0}
          hint={summary?.features.byStatus.map((s) => `${s.status}: ${s.count}`).join(' · ')}
        />
        <StatCard
          label="Оценка (часы / ₽)"
          value={`${summary?.estimates.hours ?? 0} ч`}
          hint={`Ставка фич: ${fmtMoney(summary?.features.totals.estimateCost)} ₽ · дней: ${summary?.features.totals.estimateDays ?? 0}`}
          accent="violet"
        />
        <StatCard
          label="Ошибки / дубли"
          value={`${failed} / ${duplicated}`}
          hint={`Всего ошибок: ${summary?.errors.total ?? 0} · событий: ${summary?.inventory.webhooks ?? 0}`}
          accent={failed > 0 ? 'rose' : 'emerald'}
        />
        <StatCard
          label="Записи / заявки"
          value={`${summary?.bookings.total ?? 0} / ${summary?.leads.total ?? 0}`}
          hint={`Заявок SENT_TO_1C: ${summary?.leads.byStatus.find((s) => s.status === 'SENT_TO_1C')?.count ?? 0}`}
          accent="amber"
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <Card>
          <div className="mb-3 text-sm font-semibold text-slate-700">Фичи по статусам</div>
          <div className="space-y-2">
            {summary?.features.byStatus.map((s) => (
              <div key={s.status} className="flex items-center justify-between text-sm">
                <Badge color={statusColor(s.status)}>{s.status}</Badge>
                <span className="font-medium">{s.count}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="mb-3 text-sm font-semibold text-slate-700">
            Стандартный API vs Доработки
          </div>
          <div className="space-y-2">
            {summary?.features.byImplementationType.map((t) => (
              <div key={t.type} className="flex items-center justify-between text-sm">
                <span className="text-slate-600">{TYPE_LABELS[t.type] ?? t.type}</span>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-24 rounded bg-slate-100">
                    <div
                      className="h-2 rounded bg-sky-500"
                      style={{
                        width: `${summary.features.total ? (t.count / summary.features.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="w-5 text-right font-medium">{t.count}</span>
                </div>
              </div>
            ))}
          </div>
          <Link to="/report" className="mt-3 block text-xs text-sky-600 hover:underline">
            Отчёт целиком →
          </Link>
        </Card>

        <Card>
          <div className="mb-3 text-sm font-semibold text-slate-700">Последние ошибки</div>
          {summary?.errors.recent.length ? (
            <ul className="space-y-2 text-sm">
              {summary.errors.recent.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-slate-700">{e.errorCode}</div>
                    <div className="truncate text-xs text-slate-500">
                      {e.context}: {e.message}
                    </div>
                  </div>
                  <Badge color={statusColor(e.status)}>{e.status}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <Empty text="Ошибок нет" />
          )}
          <Link to="/errors" className="mt-3 block text-xs text-sky-600 hover:underline">
            Журнал ошибок →
          </Link>
        </Card>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-700">Последние события вебхуков</div>
          <Link to="/webhooks" className="text-xs text-sky-600 hover:underline">
            Webhook Console →
          </Link>
        </div>
        <Table headers={['Время', 'Тип', 'Источник', 'Статус', 'Ключ']}>
          {webhooks?.length ? (
            webhooks.slice(0, 6).map((e) => (
              <tr key={e.id}>
                <td className="px-3 py-2 text-slate-500">{fmtDateTime(e.receivedAt)}</td>
                <td className="px-3 py-2">{e.eventType}</td>
                <td className="px-3 py-2">{e.source}</td>
                <td className="px-3 py-2">
                  <Badge color={statusColor(e.status)}>{e.status}</Badge>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">{e.idempotencyKey}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={5}>
                <Empty text="Событий пока нет" />
              </td>
            </tr>
          )}
        </Table>
      </div>
    </div>
  );
}
