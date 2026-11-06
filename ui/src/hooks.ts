import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from './api';

export { errorMessage };

/** Простой хук загрузки данных с ручкой reload. */
export function useApi<T>(path: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    api<T>(path)
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [path]);

  useEffect(() => {
    reload();
  }, [reload, ...deps]);

  return { data, error, loading, reload };
}
