import { useState, useEffect, useCallback, useRef } from 'react';
import type { User } from 'firebase/auth';
import { getCookie, setCookie, deleteCookie } from '../lib/cookies';
import { api } from '../lib/api';
import { cacheGet, cacheSet, cacheDelete } from '../lib/cache';
import {
  calculateXP, calculateRank, recalculateMetrics,
  calculateMetricDepths, detectCircularDependency,
  validateFormula,
} from '../lib/metrics-engine';
import type { FormulaWarning } from '../lib/metrics-engine';
import type { Metric, Market, MetricLog, UpdateEntry } from '../types';

function enrichMetrics(metrics: Metric[], consensusMap: Record<string, number> = {}): Metric[] {
  recalculateMetrics(metrics, consensusMap);
  const depths = calculateMetricDepths(metrics);
  metrics.forEach(m => { m.depth = depths[m.id] ?? 0; });
  metrics.sort((a, b) => a.depth !== b.depth ? a.depth - b.depth : (a.order || 999) - (b.order || 999));
  return metrics;
}

function buildConsensusMap(markets: Market[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const m of markets) {
    if (m.consensus !== null) {
      map[`${m.metricName}:${m.targetDate}`] = m.consensus;
    }
  }
  return map;
}

function buildWarnings(
  metrics: Metric[],
): Record<string, FormulaWarning[]> {
  const metricNames = new Set(metrics.map(m => m.name));
  const result: Record<string, FormulaWarning[]> = {};
  for (const m of metrics) {
    const warnings = validateFormula(m.formula || '0', metricNames);
    if (warnings.length > 0) result[m.id] = warnings;
  }
  return result;
}

export function useMetrics(user: User | null, inspectTaskId?: string | null) {
  const [metrics, setMetrics] = useState<Metric[]>(() => cacheGet<Metric[]>('metrics') || []);
  const [updates, setUpdates] = useState<UpdateEntry[]>(() => cacheGet<UpdateEntry[]>('updates') || []);
  const [formulaWarnings, setFormulaWarnings] = useState<Record<string, FormulaWarning[]>>({});
  const [focusedMetricId, setFocusedMetricId] = useState<string | null>(null);
  const [loading, setLoading] = useState(!cacheGet('metrics'));

  const consensusMapRef = useRef<Record<string, number>>({});

  const xp = calculateXP(metrics);
  const rank = calculateRank(xp);

  const loadData = useCallback(async () => {
    if (!user) return [];

    const [metricsData, marketsData, _] = await Promise.all([
      api.getMetrics(user) as Promise<Metric[]>,
      api.getMarkets(user, inspectTaskId || undefined).then((d: Market[]) => d, (): Market[] => []),
      api.getUpdates(user).then((list: UpdateEntry[]) => {
        const parsed = list.map(u => ({ ...u, timestamp: new Date(u.timestamp) }));
        setUpdates(parsed);
        cacheSet('updates', parsed);
      }),
    ]);

    // Build consensus map from whichever markets we fetched (conditional or regular)
    consensusMapRef.current = buildConsensusMap(marketsData);

    if (inspectTaskId) {
      // Re-enrich metrics using conditional market consensus instead of backend values
      const cloned = metricsData.map(m => ({ ...m }));
      setMetrics(enrichMetrics(cloned, consensusMapRef.current));
    } else {
      setMetrics(metricsData);
      cacheSet('metrics', metricsData);
    }

    // Compute formula warnings
    setFormulaWarnings(buildWarnings(metricsData));

    return metricsData;
  }, [user, inspectTaskId]);

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
      const loaded = await loadData();
      const savedFocus = getCookie('focusedMetricId');
      if (savedFocus && loaded.find((m: Metric) => m.id === savedFocus)) {
        setFocusedMetricId(savedFocus);
      } else if (savedFocus) {
        deleteCookie('focusedMetricId');
      }
      setLoading(false);
    })();
  }, [user, loadData]);

  const addMetric = async (name: string, description: string, value: number, formula: string) => {
    if (!user) return;
    if (detectCircularDependency(null, formula, metrics)) {
      throw new Error('This formula would create a circular dependency');
    }
    const { id } = await api.createMetric(user, { name, description, value, formula });
    const updated = [...metrics.map(m => ({ ...m })), { id, name, description, value, total: value, formula, order: 999, depth: 0 }];
    setMetrics(enrichMetrics(updated, consensusMapRef.current));
    setFormulaWarnings(buildWarnings(updated));
    loadData();
  };

  const editMetric = async (
    id: string, name: string, description: string, value: number,
    formula: string, oldValue: number, updateNote: string,
    timePreference?: { enabled: boolean; halfLife: number } | null,
  ) => {
    if (!user) return;
    if (detectCircularDependency(id, formula, metrics)) {
      throw new Error('This formula would create a circular dependency');
    }
    // Optimistic: update UI instantly, write in background
    const prev = metrics;
    const updated = metrics.map(m =>
      m.id === id
        ? { ...m, name, description, value, formula, timePreference: timePreference === null ? undefined : (timePreference ?? m.timePreference) }
        : { ...m }
    );
    setMetrics(enrichMetrics(updated, consensusMapRef.current));
    setFormulaWarnings(buildWarnings(updated));
    return api.updateMetric(user, id, { name, description, value, formula, oldValue, updateNote, timePreference: timePreference === undefined ? undefined : timePreference })
      .then(() => { delete logsCache.current[id]; cacheDelete('metrics'); loadData(); })
      .catch((err: Error) => { setMetrics(prev); throw err; });
  };

  const removeMetric = async (id: string) => {
    if (!user) return;
    if (focusedMetricId === id) {
      setFocusedMetricId(null);
      deleteCookie('focusedMetricId');
    }
    cacheDelete('metrics');
    await api.deleteMetric(user, id);
    await loadData();
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
    formulaWarnings,
    focusedMetricId, toggleFocus,
    addMetric, editMetric, removeMetric,
    loadMetricLogs,
  };
}
