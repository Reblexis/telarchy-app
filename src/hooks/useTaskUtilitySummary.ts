import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { getInspectUtilitySummary } from '../lib/inspect-metrics';
import type { Market, Metric, TaskUtilitySummary } from '../types';

export function useTaskUtilitySummary(authenticated: boolean, taskId: string) {
  const [summary, setSummary] = useState<TaskUtilitySummary | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!authenticated) { setSummary(undefined); setError(''); setLoading(false); return; }
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError('');
      const [metrics, markets] = await Promise.all([
        api.getMetrics().catch((e: Error) => { setError(e.message); return null; }) as Promise<Metric[] | null>,
        api.getMarkets(taskId).catch((e: Error) => { setError(e.message); return null; }) as Promise<Market[] | null>,
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
  }, [authenticated, taskId]);

  return { summary, loading, error };
}
