import { useMemo, useState } from 'react';
import { useAuth, useCanWrite } from '../auth';
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
  fmtMoney,
} from '../components';
import { api, errorMessage } from '../api';
import { useApi } from '../hooks';
import type { Feature, Task } from '../types';
import { TYPE_LABELS } from './DashboardPage';

const STATUS_COLORS: Record<string, string> = {
  PLANNED: 'slate',
  IN_PROGRESS: 'blue',
  BLOCKED: 'red',
  DONE: 'green',
};

const IMPL_COLORS: Record<string, string> = {
  STANDARD_API: 'green',
  EXTENSION: 'amber',
  CUSTOM_HTTP_SERVICE: 'violet',
  TBD: 'slate',
};

const TYPE_OPTIONS = Object.keys(IMPL_COLORS);

export default function FeaturesPage() {
  const canWrite = useCanWrite();
  const { user } = useAuth();
  const { data: features, error, loading, reload } = useApi<Feature[]>('/features');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    code: '',
    title: '',
    implementationType: 'TBD',
    estimateDays: '',
    estimateCost: '',
  });

  const filtered = useMemo(
    () =>
      (features ?? []).filter(
        (f) =>
          (!statusFilter || f.status === statusFilter) &&
          (!typeFilter || f.implementationType === typeFilter) &&
          (!priorityFilter || f.priority === priorityFilter),
      ),
    [features, statusFilter, typeFilter, priorityFilter],
  );

  const patch = async (id: string, body: Partial<Feature>, message = 'Сохранено') => {
    try {
      await api(`/features/${id}`, { method: 'PATCH', body });
      setNotice(message);
      setTimeout(() => setNotice(null), 2500);
      reload();
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };

  const createFeature = async () => {
    setFormError(null);
    try {
      await api('/features', {
        method: 'POST',
        body: {
          code: form.code,
          title: form.title,
          implementationType: form.implementationType,
          estimateDays: form.estimateDays ? Number(form.estimateDays) : null,
          estimateCost: form.estimateCost ? Number(form.estimateCost) : null,
        },
      });
      setShowForm(false);
      setForm({
        code: '',
        title: '',
        implementationType: 'TBD',
        estimateDays: '',
        estimateCost: '',
      });
      setNotice('Фича создана');
      reload();
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <PageTitle subtitle={`Пользователь: ${user?.role}`}>Features Board</PageTitle>
      <ErrorBanner message={error ?? formError} />
      <SuccessBanner message={notice} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Все статусы</option>
          {['PLANNED', 'IN_PROGRESS', 'BLOCKED', 'DONE'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">Все типы реализации</option>
          {TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
        <Select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
          <option value="">Все приоритеты</option>
          {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <div className="ml-auto">
          {canWrite && (
            <Button onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Скрыть форму' : '+ Новая фича'}
            </Button>
          )}
        </div>
      </div>

      {showForm && (
        <Card className="mb-4">
          <div className="grid gap-2 md:grid-cols-5">
            <Input
              placeholder="Код (F-07)"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
            <Input
              placeholder="Название"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="md:col-span-2"
            />
            <Select
              value={form.implementationType}
              onChange={(e) => setForm({ ...form, implementationType: e.target.value })}
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
            <div className="flex gap-2">
              <Input
                placeholder="Дней"
                value={form.estimateDays}
                onChange={(e) => setForm({ ...form, estimateDays: e.target.value })}
                className="w-20"
              />
              <Input
                placeholder="₽"
                value={form.estimateCost}
                onChange={(e) => setForm({ ...form, estimateCost: e.target.value })}
                className="w-24"
              />
            </div>
          </div>
          <div className="mt-3">
            <Button onClick={() => void createFeature()} disabled={!form.code || !form.title}>
              Создать
            </Button>
          </div>
        </Card>
      )}

      <Table
        headers={[
          '',
          'Код',
          'Функция',
          'Статус',
          'Тип реализации',
          'Приор.',
          'Дней',
          'Стоимость, ₽',
        ]}
      >
        {filtered.length ? (
          filtered.map((f) => (
            <FeatureRow
              key={f.id}
              feature={f}
              canWrite={canWrite}
              expanded={expanded === f.id}
              onToggle={() => setExpanded(expanded === f.id ? null : f.id)}
              onPatch={patch}
            />
          ))
        ) : (
          <tr>
            <td colSpan={8}>
              <Empty text="Нет фич по заданным фильтрам" />
            </td>
          </tr>
        )}
      </Table>

      {expanded && <TaskPanel featureId={expanded} onError={setFormError} onChanged={reload} />}
    </div>
  );
}

function FeatureRow({
  feature,
  canWrite,
  expanded,
  onToggle,
  onPatch,
}: {
  feature: Feature;
  canWrite: boolean;
  expanded: boolean;
  onToggle: () => void;
  onPatch: (id: string, body: Partial<Feature>, message?: string) => void;
}) {
  const [days, setDays] = useState(
    feature.estimateDays == null ? '' : String(feature.estimateDays),
  );
  const [cost, setCost] = useState(
    feature.estimateCost == null ? '' : String(feature.estimateCost),
  );

  const commit = (field: 'estimateDays' | 'estimateCost', value: string) => {
    const parsed = value === '' ? null : Number(value);
    const original = field === 'estimateDays' ? feature.estimateDays : feature.estimateCost;
    if (parsed !== original) {
      onPatch(feature.id, { [field]: parsed }, 'Оценка обновлена');
    }
  };

  return (
    <>
      <tr className={expanded ? 'bg-sky-50/60' : 'hover:bg-slate-50'}>
        <td className="px-2 py-2">
          <button
            onClick={onToggle}
            title="Показать задачи"
            className="h-6 w-6 rounded border border-slate-300 text-slate-500 hover:bg-slate-100"
          >
            {expanded ? '−' : '+'}
          </button>
        </td>
        <td className="px-3 py-2 font-mono text-xs">{feature.code}</td>
        <td className="px-3 py-2">
          <div className="font-medium text-slate-800">{feature.title}</div>
          <div className="text-xs text-slate-500">{feature.description}</div>
        </td>
        <td className="px-3 py-2">
          {canWrite ? (
            <Select
              value={feature.status}
              onChange={(e) => onPatch(feature.id, { status: e.target.value as Feature['status'] })}
            >
              {['PLANNED', 'IN_PROGRESS', 'BLOCKED', 'DONE'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          ) : (
            <Badge color={STATUS_COLORS[feature.status]}>{feature.status}</Badge>
          )}
        </td>
        <td className="px-3 py-2">
          {canWrite ? (
            <Select
              value={feature.implementationType}
              onChange={(e) =>
                onPatch(
                  feature.id,
                  { implementationType: e.target.value as Feature['implementationType'] },
                  'Тип реализации обновлён',
                )
              }
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          ) : (
            <Badge color={IMPL_COLORS[feature.implementationType]}>
              {TYPE_LABELS[feature.implementationType]}
            </Badge>
          )}
        </td>
        <td className="px-3 py-2">
          <Badge
            color={feature.priority === 'CRITICAL' || feature.priority === 'HIGH' ? 'red' : 'slate'}
          >
            {feature.priority}
          </Badge>
        </td>
        <td className="px-3 py-2">
          <Input
            value={days}
            disabled={!canWrite}
            className="w-16 text-right"
            onChange={(e) => setDays(e.target.value)}
            onBlur={() => commit('estimateDays', days)}
            onKeyDown={(e) => e.key === 'Enter' && commit('estimateDays', days)}
          />
        </td>
        <td className="px-3 py-2">
          <Input
            value={cost}
            disabled={!canWrite}
            className="w-28 text-right"
            onChange={(e) => setCost(e.target.value)}
            onBlur={() => commit('estimateCost', cost)}
            onKeyDown={(e) => e.key === 'Enter' && commit('estimateCost', cost)}
          />
          <div className="mt-0.5 text-right text-xs text-slate-400">
            {fmtMoney(feature.estimateCost)} ₽
          </div>
        </td>
      </tr>
    </>
  );
}

function TaskPanel({
  featureId,
  onError,
  onChanged,
}: {
  featureId: string;
  onError: (msg: string | null) => void;
  onChanged: () => void;
}) {
  const { data: tasks, loading } = useApi<Task[]>(`/tasks?featureId=${featureId}`, [featureId]);
  const canWrite = useCanWrite();
  const [title, setTitle] = useState('');

  const patchTask = async (id: string, status: Task['status']) => {
    try {
      await api(`/tasks/${id}`, { method: 'PATCH', body: { status } });
      onChanged();
    } catch (err) {
      onError(errorMessage(err));
    }
  };

  const addTask = async () => {
    try {
      await api('/tasks', { method: 'POST', body: { featureId, title } });
      setTitle('');
      onChanged();
    } catch (err) {
      onError(errorMessage(err));
    }
  };

  if (loading) return <Spinner />;

  return (
    <Card className="mt-3">
      <div className="mb-2 text-sm font-semibold text-slate-700">Задачи фичи</div>
      <ul className="space-y-2">
        {tasks?.length ? (
          tasks.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 text-sm">
              <span className={t.status === 'DONE' ? 'text-slate-400 line-through' : ''}>
                {t.title}
              </span>
              {canWrite ? (
                <Select
                  value={t.status}
                  onChange={(e) => void patchTask(t.id, e.target.value as Task['status'])}
                >
                  {['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE'].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              ) : (
                <Badge>{t.status}</Badge>
              )}
            </li>
          ))
        ) : (
          <Empty text="Задач нет" />
        )}
      </ul>
      {canWrite && (
        <div className="mt-3 flex gap-2">
          <Input
            placeholder="Новая задача…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="flex-1"
            onKeyDown={(e) => e.key === 'Enter' && void addTask()}
          />
          <Button onClick={() => void addTask()} disabled={!title.trim()}>
            Добавить
          </Button>
        </div>
      )}
    </Card>
  );
}
