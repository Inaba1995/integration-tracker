import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { Button, Card, ErrorBanner, Input } from '../components';
import { errorMessage } from '../hooks';

export default function LoginPage() {
  const { user, login } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('admin@tracker.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <div className="mb-4">
          <div className="text-lg font-semibold text-slate-900">Трекер интеграции</div>
          <div className="text-sm text-slate-500">ИИ-ассистент ↔ 1С:Фитнес клуб</div>
        </div>
        <ErrorBanner message={error} />
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-slate-500">Email</label>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full"
              autoComplete="username"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Пароль</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full"
              autoComplete="current-password"
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
            />
          </div>
          <Button onClick={() => void submit()} disabled={busy} type="submit">
            {busy ? 'Входим…' : 'Войти'}
          </Button>
        </div>
        <div className="mt-4 text-xs text-slate-400">
          Демо-доступы: admin@tracker.local · integrator@tracker.local · viewer@tracker.local
          (пароль: Password123!)
        </div>
      </Card>
    </div>
  );
}
