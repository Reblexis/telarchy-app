import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { api } from '../lib/api';
import { getInspectUtilitySummary } from '../lib/inspect-metrics';
import type { Market, Metric, TaskUtilitySummary } from '../types';

export function useTaskUtilitySummary(user: User | null, taskId: string) {
  const [summary, setSummary] = useState<TaskUtilitySummary | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError('');
      const [metrics, markets] = await Promise.all([
        api.getMetrics(user).catch((e: Error) => { setError(e.message); return null; }) as Promise<Metric[] | null>,
        api.getMarkets(user, taskId).catch((e: Error) => { setError(e.message); return null; }) as Promise<Market[] | null>,
      ]);

      if (cancelled) return;
      if (!metrics || !markets) {
        setSummary(undefined);
        setLoading(false);
        return;
      }

      setSummary(getInspectUtilitySummary(metrics, markets));
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [user, taskId]);

  return { summary, loading, error };
}
