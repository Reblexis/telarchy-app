import { useState, useEffect, useCallback } from 'react';
import type { User } from 'firebase/auth';
import { getCookie, setCookie, deleteCookie } from '../lib/cookies';
import { api } from '../lib/api';
import { calculateXP, calculateRank } from '../lib/metrics-engine';
import type { Metric, MetricLog, UpdateEntry } from '../types';

export function useMetrics(user: User | null) {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [updates, setUpdates] = useState<UpdateEntry[]>([]);
  const [focusedMetricId, setFocusedMetricId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const xp = calculateXP(metrics);
  const rank = calculateRank(xp);

  const loadMetrics = useCallback(async () => {
    if (!user) return [];
    const loaded: Metric[] = await api.getMetrics(user);
    setMetrics(loaded);
    return loaded;
  }, [user]);

  const loadUpdates = useCallback(async () => {
    if (!user) return;
    const list: UpdateEntry[] = await api.getUpdates(user);
    setUpdates(list.map(u => ({ ...u, timestamp: new Date(u.timestamp) })));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      await api.triggerDecay(user);
      const loaded = await loadMetrics();
      await loadUpdates();
      const savedFocus = getCookie('focusedMetricId');
      if (savedFocus && loaded.find((m: Metric) => m.id === savedFocus)) {
        setFocusedMetricId(savedFocus);
      } else if (savedFocus) {
        deleteCookie('focusedMetricId');
      }
      setLoading(false);
    })();
  }, [user, loadMetrics, loadUpdates]);

  const addMetric = async (name: string, description: string, value: number, formula: string, decay: boolean) => {
    if (!user) return;
    const loaded = await api.createMetric(user, { name, description, value, formula, decay });
    setMetrics(loaded);
    await loadUpdates();
  };

  const editMetric = async (
    id: string, name: string, description: string, value: number,
    formula: string, decay: boolean, oldValue: number, updateNote: string
  ) => {
    if (!user) return;
    const loaded = await api.updateMetric(user, id, { name, description, value, formula, decay, oldValue, updateNote });
    setMetrics(loaded);
    await loadUpdates();
  };

  const removeMetric = async (id: string) => {
    if (!user) return;
    if (focusedMetricId === id) {
      setFocusedMetricId(null);
      deleteCookie('focusedMetricId');
    }
    await api.deleteMetric(user, id);
    await loadMetrics();
  };

  const toggleFocus = (metricId: string) => {
    if (focusedMetricId === metricId) {
      setFocusedMetricId(null);
      deleteCookie('focusedMetricId');
    } else {
      setFocusedMetricId(metricId);
      setCookie('focusedMetricId', metricId);
    }
  };

  const loadMetricLogs = useCallback(async (metricId: string): Promise<MetricLog[]> => {
    if (!user) return [];
    const logs = await api.getMetricLogs(user, metricId);
    return logs.map((l: MetricLog) => ({ ...l, timestamp: new Date(l.timestamp) }));
  }, [user]);

  return {
    metrics, updates, xp, rank, loading,
    focusedMetricId, toggleFocus,
    addMetric, editMetric, removeMetric,
    loadMetricLogs,
  };
}
