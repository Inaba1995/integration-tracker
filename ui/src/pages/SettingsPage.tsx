import { useState } from 'react';
import { useAuth, useIsAdmin } from '../auth';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorBanner,
  PageTitle,
  Spinner,
  SuccessBanner,
  Table,
  fmtDateTime,
} from '../components';
import { api, errorMessage } from '../api';
import { useApi } from '../hooks';
import type { Settings } from '../types';

interface SafeUser {
  id: string;
  email: string;
  role: string;
  createdAt: string;
}

export default function SettingsPage() {
  const isAdmin = useIsAdmin();
  const { user } = useAuth();
  const { data: settings, error, loading, reload } = useApi<Settings>('/settings');
  const { data: users } = useApi<SafeUser[]>(isAdmin ? '/users' : '/settings');
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  const setMode = async (oneCMode: 'mock' | 'real') => {
    setSwitching(true);
    setActionError(null);
    try {
      await api<Settings>('/settings', { method: 'PATCH', body: { oneCMode } });
      setNotice(`Режим 1С переключён: ${oneCMode}`);
      reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setSwitching(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <PageTitle subtitle="Секреты хранятся только в окружении (env) и не отображаются">
        Настройки
      </PageTitle>
      <ErrorBanner message={error ?? actionError} />
      <SuccessBanner message={notice} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 text-sm font-semibold text-slate-700">Режим интеграции с 1С</div>
          <div className="mb-3 flex items-center gap-3">
            <Badge color={settings?.oneCMode === 'mock' ? 'blue' : 'green'}>
              {settings?.oneCMode === 'mock' ? 'MOCK (по умолчанию)' : 'REAL'}
            </Badge>
            <span className="text-sm text-slate-500">
              Переключатель действует на текущий процесс. Источник истины при запуске — env
              ONEC_MODE.
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              variant={settings?.oneCMode === 'mock' ? 'primary' : 'secondary'}
              disabled={!isAdmin || switching || settings?.oneCMode === 'mock'}
              onClick={() => void setMode('mock')}
              title={isAdmin ? '' : 'Только ADMIN'}
            >
              → mock
            </Button>
            <Button
              variant={settings?.oneCMode === 'real' ? 'primary' : 'secondary'}
              disabled={
                !isAdmin || switching || settings?.oneCMode === 'real' || !settings?.realConfigured
              }
              onClick={() => void setMode('real')}
              title={
                !settings?.realConfigured
                  ? 'Задайте ONEC_BASE_URL и ONEC_TOKEN в окружении'
                  : isAdmin
                    ? ''
                    : 'Только ADMIN'
              }
            >
              → real
            </Button>
          </div>
          <dl className="mt-4 space-y-1 text-sm">
            <Row
              label="ONEC_BASE_URL + ONEC_TOKEN заданы"
              value={settings?.realConfigured ? 'да' : 'нет'}
            />
            <Row label="Токен в окружении" value={settings?.tokenConfigured ? 'есть' : 'нет'} />
            <Row label="NODE_ENV" value={settings?.nodeEnv ?? '—'} />
            <Row label="CORS_ORIGIN" value={settings?.corsOrigin ?? '—'} />
          </dl>
          <a
            href="/openapi.yaml"
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block text-sm text-sky-600 hover:underline"
          >
            OpenAPI-спека (openapi.yaml) →
          </a>
        </Card>

        <Card>
          <div className="mb-3 text-sm font-semibold text-slate-700">
            Пользователи и роли {isAdmin ? '' : '(только ADMIN)'}
          </div>
          {isAdmin ? (
            <Table headers={['Email', 'Роль', 'Создан']}>
              {(users ?? []).length ? (
                (users ?? []).map((u) => (
                  <tr key={u.id}>
                    <td className="px-3 py-2">{u.email}</td>
                    <td className="px-3 py-2">
                      <Badge
                        color={
                          u.role === 'ADMIN' ? 'red' : u.role === 'INTEGRATOR' ? 'blue' : 'slate'
                        }
                      >
                        {u.role}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-slate-500">{fmtDateTime(u.createdAt)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3}>
                    <Empty text="Пользователей нет" />
                  </td>
                </tr>
              )}
            </Table>
          ) : (
            <div className="text-sm text-slate-500">
              Вы вошли как {user?.email} ({user?.role}). Раздел доступен администратору.
            </div>
          )}

          <div className="mt-4 text-xs text-slate-500">
            Роли: VIEWER — чтение; INTEGRATOR — создание/изменение и операции; ADMIN — настройки и
            пользователи.
          </div>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-700">{value}</dd>
    </div>
  );
}
