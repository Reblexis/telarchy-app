import { useState, useEffect, useCallback, useRef } from 'react';
import { getCookie, setCookie, deleteCookie } from '../lib/cookies';
import { api } from '../lib/api';
import { cacheGet, cacheSet, cacheDelete } from '../lib/cache';
import { buildConsensusMap, buildInspectMetrics, enrichMetrics } from '../lib/inspect-metrics';
import {
  detectCircularDependency,
  validateFormula,
} from '../lib/metrics-engine';
import type { FormulaWarning } from '../lib/metrics-engine';
import type { Metric, Market, MetricLog, UpdateEntry } from '../types';

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

export function useMetrics(authenticated: boolean, inspectProposalId?: string | null, canViewUpdates = true) {
  const [metrics, setMetrics] = useState<Metric[]>(() => cacheGet<Metric[]>('metrics') || []);
  const [updates, setUpdates] = useState<UpdateEntry[]>(() => cacheGet<UpdateEntry[]>('updates') || []);
  const [formulaWarnings, setFormulaWarnings] = useState<Record<string, FormulaWarning[]>>({});
  const [focusedMetricId, setFocusedMetricId] = useState<string | null>(null);
  const [loading, setLoading] = useState(!cacheGet('metrics'));
  const [error, setError] = useState('');

  const consensusMapRef = useRef<Record<string, number>>({});

  const loadData = useCallback(async () => {
    if (!authenticated) return [];
    setError('');

    const [metricsData, marketsData] = await Promise.all([
      api.getMetrics() as Promise<Metric[]>,
      api.getMarkets(
        inspectProposalId || undefined,
        undefined,
        // Inspect mode (looking back at a resolved/declined proposal): pull
        // every conditional market so the per-metric consensus row still
        // renders. Live metrics view (no inspectProposalId): default
        // status=open is enough.
        inspectProposalId ? { status: 'all' } : undefined,
      ).catch((e: Error) => { console.error('Failed to load markets for metrics page:', e.message); return [] as Market[]; }),
      canViewUpdates
        ? api.getUpdates().then((list: UpdateEntry[]) => {
            const parsed = list.map(u => ({ ...u, timestamp: new Date(u.timestamp) }));
            setUpdates(parsed);
            cacheSet('updates', parsed);
          }).catch((e: Error) => console.error('Failed to load updates:', e.message))
        : Promise.resolve(),
    ]);

    consensusMapRef.current = buildConsensusMap(marketsData);
    if (inspectProposalId) {
      setMetrics(buildInspectMetrics(metricsData, marketsData));
    } else {
      setMetrics(metricsData);
      cacheSet('metrics', metricsData);
    }

    setFormulaWarnings(buildWarnings(metricsData));

    return metricsData;
  }, [authenticated, inspectProposalId, canViewUpdates]);

  useEffect(() => {
    if (!authenticated) { setLoading(false); return; }

    const cached = cacheGet<Metric[]>('metrics');
    if (cached) {
      const savedFocus = getCookie('focusedMetricId');
      if (savedFocus && cached.find((m: Metric) => m.id === savedFocus)) {
        setFocusedMetricId(savedFocus);
      }
    }

    (async () => {
      if (!cached) setLoading(true);
      try {
        const loaded = await loadData();
        const savedFocus = getCookie('focusedMetricId');
        if (savedFocus && loaded.find((m: Metric) => m.id === savedFocus)) {
          setFocusedMetricId(savedFocus);
        } else if (savedFocus) {
          deleteCookie('focusedMetricId');
        }
      } catch (err: unknown) {
        const e = err as { message?: string };
        setError(e.message || 'Failed to load metrics');
      } finally {
        setLoading(false);
      }
    })();
  }, [authenticated, loadData]);

  const addMetric = async (
    name: string, description: string, value: number, formula: string,
    marketRangeMax?: number,
  ): Promise<string[]> => {
    if (detectCircularDependency(null, formula, metrics)) {
      throw new Error('This formula would create a circular dependency');
    }
    const { id, warnings = [] } = await api.createMetric({ name, description, value, formula, marketRangeMax });
    const updated = [...metrics.map(m => ({ ...m })), { id, name, description, value, total: value, formula, order: 999, depth: 0, marketRangeMax }];
    setMetrics(enrichMetrics(updated, consensusMapRef.current));
    setFormulaWarnings(buildWarnings(updated));
    loadData();
    return warnings;
  };

  const editMetric = async (
    id: string, name: string, description: string, value: number,
    formula: string, oldValue: number, updateNote: string,
    timePreference?: import('../types').TimePreference | null,
    marketRangeMax?: number,
  ) => {
    if (detectCircularDependency(id, formula, metrics)) {
      throw new Error('This formula would create a circular dependency');
    }
    const prev = metrics;
    const updated = metrics.map(m =>
      m.id === id
        ? { ...m, name, description, value, formula, marketRangeMax, timePreference: timePreference === null ? undefined : (timePreference ?? m.timePreference) }
        : { ...m }
    );
    setMetrics(enrichMetrics(updated, consensusMapRef.current));
    setFormulaWarnings(buildWarnings(updated));
    return api.updateMetric(id, { name, description, value, formula, oldValue, updateNote, timePreference: timePreference === undefined ? undefined : timePreference, marketRangeMax })
      .then((resp: { warnings?: string[] }) => { delete logsCache.current[id]; cacheDelete('metrics'); loadData(); return resp.warnings || []; })
      .catch((err: Error) => { setMetrics(prev); throw err; });
  };

  const removeMetric = async (id: string) => {
    if (focusedMetricId === id) {
      setFocusedMetricId(null);
      deleteCookie('focusedMetricId');
    }
    cacheDelete('metrics');
    await api.deleteMetric(id);
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
    if (!authenticated) return [];
    if (logsCache.current[metricId]) return logsCache.current[metricId];
    const logs = await api.getMetricLogs(metricId);
    const parsed = logs.map((l: MetricLog) => ({ ...l, timestamp: new Date(l.timestamp) }));
    logsCache.current[metricId] = parsed;
    return parsed;
  }, [authenticated]);

  return {
    metrics, updates, loading, error,
    formulaWarnings,
    focusedMetricId, toggleFocus,
    addMetric, editMetric, removeMetric,
    loadMetricLogs,
  };
}
