import { useState, useEffect, useCallback, useRef } from 'react';
import type { User } from 'firebase/auth';
import { getCookie, setCookie, deleteCookie } from '../lib/cookies';
import { api } from '../lib/api';
import { cacheGet, cacheSet, cacheDelete } from '../lib/cache';
import {
  calculateXP, calculateRank, recalculateMetrics,
  calculateMetricDepths, detectCircularDependency,
} from '../lib/metrics-engine';
import type { Metric, MetricLog, UpdateEntry } from '../types';

function enrichMetrics(metrics: Metric[]): Metric[] {
  recalculateMetrics(metrics);
  const depths = calculateMetricDepths(metrics);
  metrics.forEach(m => { m.depth = depths[m.id] || 0; });
  metrics.sort((a, b) => a.depth !== b.depth ? a.depth - b.depth : (a.order || 999) - (b.order || 999));
  return metrics;
}

// Track last decay trigger globally so we don't call it on every mount
let lastDecayTs = 0;
const DECAY_INTERVAL = 60_000; // once per minute max

export function useMetrics(user: User | null) {
  const [metrics, setMetrics] = useState<Metric[]>(() => cacheGet<Metric[]>('metrics') || []);
  const [updates, setUpdates] = useState<UpdateEntry[]>(() => cacheGet<UpdateEntry[]>('updates') || []);
  const [focusedMetricId, setFocusedMetricId] = useState<string | null>(null);
  const [loading, setLoading] = useState(!cacheGet('metrics'));

  const xp = calculateXP(metrics);
  const rank = calculateRank(xp);

  const loadMetrics = useCallback(async () => {
    if (!user) return [];
    const loaded: Metric[] = await api.getMetrics(user);
    setMetrics(loaded);
    cacheSet('metrics', loaded);
    return loaded;
  }, [user]);

  const loadUpdates = useCallback(async () => {
    if (!user) return;
    const list: UpdateEntry[] = await api.getUpdates(user);
    const parsed = list.map(u => ({ ...u, timestamp: new Date(u.timestamp) }));
    setUpdates(parsed);
    cacheSet('updates', parsed);
  }, [user]);

  useEffect(() => {
    if (!user) return;

    // If we have cached data, show it immediately and refresh in background
    const cached = cacheGet<Metric[]>('metrics');
    if (cached) {
      const savedFocus = getCookie('focusedMetricId');
      if (savedFocus && cached.find((m: Metric) => m.id === savedFocus)) {
        setFocusedMetricId(savedFocus);
      }
    }

    (async () => {
      if (!cached) setLoading(true);

      // Only trigger decay if enough time has passed
      if (Date.now() - lastDecayTs > DECAY_INTERVAL) {
        await api.triggerDecay(user);
        lastDecayTs = Date.now();
      }

      const [loaded] = await Promise.all([loadMetrics(), loadUpdates()]);
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
    if (detectCircularDependency(null, formula, metrics)) {
      throw new Error('This formula would create a circular dependency');
    }
    const { id } = await api.createMetric(user, { name, description, value, formula, decay });
    const updated = [...metrics.map(m => ({ ...m })), { id, name, description, value, total: value, formula, decay, order: 999, depth: 0 }];
    setMetrics(enrichMetrics(updated));
    loadUpdates();
  };

  const editMetric = async (
    id: string, name: string, description: string, value: number,
    formula: string, decay: boolean, oldValue: number, updateNote: string
  ) => {
    if (!user) return;
    if (detectCircularDependency(id, formula, metrics)) {
      throw new Error('This formula would create a circular dependency');
    }
    // Optimistic: update UI instantly, write in background
    const prev = metrics;
    const updated = metrics.map(m => m.id === id ? { ...m, name, description, value, formula, decay } : { ...m });
    setMetrics(enrichMetrics(updated));
    api.updateMetric(user, id, { name, description, value, formula, decay, oldValue, updateNote })
      .then(() => { delete logsCache.current[id]; cacheDelete('metrics'); loadUpdates(); })
      .catch(() => setMetrics(prev));
  };

  const removeMetric = async (id: string) => {
    if (!user) return;
    if (focusedMetricId === id) {
      setFocusedMetricId(null);
      deleteCookie('focusedMetricId');
    }
    cacheDelete('metrics');
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

  const logsCache = useRef<Record<string, MetricLog[]>>({});

  const loadMetricLogs = useCallback(async (metricId: string): Promise<MetricLog[]> => {
    if (!user) return [];
    if (logsCache.current[metricId]) return logsCache.current[metricId];
    const logs = await api.getMetricLogs(user, metricId);
    const parsed = logs.map((l: MetricLog) => ({ ...l, timestamp: new Date(l.timestamp) }));
    logsCache.current[metricId] = parsed;
    return parsed;
  }, [user]);

  return {
    metrics, updates, xp, rank, loading,
    focusedMetricId, toggleFocus,
    addMetric, editMetric, removeMetric,
    loadMetricLogs,
  };
}
