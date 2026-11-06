import { Navigate, Route, Routes, NavLink, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './auth';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import FeaturesPage from './pages/FeaturesPage';
import EndpointsPage from './pages/EndpointsPage';
import WebhooksPage from './pages/WebhooksPage';
import BookingsPage from './pages/BookingsPage';
import ErrorsPage from './pages/ErrorsPage';
import ReportPage from './pages/ReportPage';
import SettingsPage from './pages/SettingsPage';

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/features', label: 'Фичи' },
  { to: '/endpoints', label: 'API Explorer' },
  { to: '/webhooks', label: 'Webhook Console' },
  { to: '/bookings', label: 'Записи и расписание' },
  { to: '/errors', label: 'Ошибки' },
  { to: '/report', label: 'Отчёт' },
  { to: '/settings', label: 'Настройки' },
];

function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <div className="flex min-h-full">
      <aside className="no-print flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-4">
          <div className="text-sm font-semibold text-slate-900">Трекер интеграции</div>
          <div className="text-xs text-slate-500">ИИ-ассистент ↔ 1С:Фитнес</div>
        </div>
        <nav className="flex-1 space-y-0.5 p-2">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm ${
                  isActive
                    ? 'bg-sky-600 font-medium text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-3 text-xs text-slate-500">
          <div className="truncate font-medium text-slate-700">{user?.email}</div>
          <div className="mb-2">Роль: {user?.role}</div>
          <button
            onClick={logout}
            className="rounded-lg border border-slate-300 px-2 py-1 hover:bg-slate-50"
          >
            Выйти
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden p-6" key={location.pathname}>
        {children}
      </main>
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return <div className="p-10 text-sm text-slate-500">Загрузка…</div>;
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        }
      />
      <Route
        path="/features"
        element={
          <RequireAuth>
            <FeaturesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/endpoints"
        element={
          <RequireAuth>
            <EndpointsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/webhooks"
        element={
          <RequireAuth>
            <WebhooksPage />
          </RequireAuth>
        }
      />
      <Route
        path="/bookings"
        element={
          <RequireAuth>
            <BookingsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/errors"
        element={
          <RequireAuth>
            <ErrorsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/report"
        element={
          <RequireAuth>
            <ReportPage />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <SettingsPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
