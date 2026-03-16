import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../lib/db';
import type { Metric, MetricLog, UpdateEntry } from '../types';
import { recalculateMetrics, calculateMetricDepths, calculateXP, calculateRank, evaluateFormulaAtTime } from '../lib/metrics-engine';
import { sampleTimePoints, getLeafDescendantNames } from '../lib/time-preference';
import { consensus as ammConsensus, AMM_DEFAULTS } from '../lib/amm';
import { toISOWeekString } from '../lib/date-utils';
import { emitEvent } from './events';

function enrichMetrics(metrics: Metric[], consensusMap: Record<string, number> = {}): Metric[] {
  recalculateMetrics(metrics, consensusMap);
  const depths = calculateMetricDepths(metrics);
  metrics.forEach(m => {
    if (depths[m.id] === undefined) console.error(`enrichMetrics: no depth calculated for metric ${m.id} (${m.name})`);
    m.depth = depths[m.id] ?? 0;
  });

  const nameToFormula: Record<string, string> = {};
  metrics.forEach(m => { nameToFormula[m.name] = m.formula || '0'; });

  const nameToTimeSeries: Record<string, Array<{ date: string; value: number }>> = {};

  for (const tpMetric of metrics) {
    if (!tpMetric.timePreference?.enabled) continue;

    // Use the TP node's own time points — always future dates, always the right set.
    const timePoints = sampleTimePoints(tpMetric.timePreference.halfLife);

    // BFS to collect all descendants.
    const descendants = new Set<string>();
    const queue = [tpMetric.name];
    const visited = new Set([tpMetric.name]);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const refs = (nameToFormula[current] || '').match(/\{([^}]+)\}/g) ?? [];
      for (const ref of refs) {
        const name = ref.slice(1, -1).trim();
        if (!visited.has(name)) { visited.add(name); descendants.add(name); queue.push(name); }
      }
    }

    const memo: Record<string, number> = {};
    for (const name of descendants) {
      if (nameToTimeSeries[name]) continue;
      const formula = nameToFormula[name] || '0';
      const isLeaf = formula.trim() === '0';
      const series: Array<{ date: string; value: number }> = [];

      for (const { date } of timePoints) {
        if (isLeaf) {
          const val = consensusMap[`${name}:${date}`];
          if (val === undefined) {
            console.error(`enrichMetrics: no market consensus for leaf "${name}" at date "${date}" — market missing or date mismatch`);
          } else {
            series.push({ date, value: val });
          }
        } else {
          series.push({ date, value: evaluateFormulaAtTime(formula, nameToFormula, consensusMap, date, memo) });
        }
      }

      if (series.length > 0) nameToTimeSeries[name] = series;
    }
  }

  metrics.forEach(m => { if (nameToTimeSeries[m.name]) m.timeSeries = nameToTimeSeries[m.name]; });
  metrics.sort((a, b) => a.depth !== b.depth ? a.depth - b.depth : (a.order || 999) - (b.order || 999));
  return metrics;
}

export async function buildConsensusMap(): Promise<Record<string, number>> {
  const marketSnap = await db().collection('markets').where('resolved', '==', false).get();
  if (marketSnap.empty) return {};

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const map: Record<string, number> = {};

  for (const doc of marketSnap.docs) {
    const m = doc.data();
    if (m.taskId) continue;
    if (m.active === false) continue;
    if (!m.shares) continue;
    // consensus() handles b=0 (no liquidity) by returning rangeMin as the uninformed prior.
    const c = ammConsensus(m.shares, m.liquidity ?? 0, m.rangeMin, m.rangeMax);
    map[`${m.metricName}:${m.targetDate}`] = c;

    // Bridge old-format dates to new-format keys so that sampleTimePoints lookups
    // still resolve correctly while existing markets retain their original targetDate.
    // Zone 1: old YYYY-MM-DD (7–30 days away) → new YYYY-Www
    if (/^\d{4}-\d{2}-\d{2}$/.test(m.targetDate)) {
      const target = new Date(m.targetDate);
      const diffDays = (target.getTime() - today.getTime()) / 86400000;
      if (diffDays >= 7 && diffDays < 31) {
        const weekKey = `${m.metricName}:${toISOWeekString(target)}`;
        if (!map[weekKey]) map[weekKey] = c;
      }
    }
    // Zone 2: old YYYY-MM (1–2 years away) → new YYYY
    if (/^\d{4}-\d{2}$/.test(m.targetDate)) {
      const [y, mo] = m.targetDate.split('-').map(Number);
      const target = new Date(y, mo - 1, 15);
      const diffYears = (target.getTime() - today.getTime()) / (365.25 * 86400000);
      if (diffYears >= 1 && diffYears < 2) {
        const yearKey = `${m.metricName}:${y}`;
        if (!map[yearKey]) map[yearKey] = c;
      }
    }
  }
  return map;
}

export async function getAllMetrics(): Promise<Metric[]> {
  const [snapshot, consensusMap] = await Promise.all([
    db().collection('metrics').get(),
    buildConsensusMap(),
  ]);
  return enrichMetrics(snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id, name: data.name, description: data.description || '',
      value: data.value, total: data.value, formula: data.formula || '0',
      order: data.order || 999, depth: 0,
      timePreference: data.timePreference?.enabled ? data.timePreference : undefined,
      marketRangeMax: data.marketRangeMax,
    };
  }), consensusMap);
}

export async function getMetricById(id: string): Promise<Metric | null> {
  const metrics = await getAllMetrics();
  return metrics.find(m => m.id === id) || null;
}

/**
 * Create markets for all leaf descendants of a time-preferenced node at the
 * time points sampled from its decay curve. Skips already-existing markets.
 */
export async function ensureMarketsForTimePreference(
  tpMetricId: string,
  halfLife: number,
): Promise<void> {
  const metricsSnap = await db().collection('metrics').get();
  const nameToFormula: Record<string, string> = {};
  const nameToId = new Map<string, string>();
  const idToName = new Map<string, string>();
  let tpMetricName = '';

  const idToRangeMax = new Map<string, number>();

  for (const doc of metricsSnap.docs) {
    const d = doc.data();
    nameToFormula[d.name] = d.formula || '0';
    nameToId.set(d.name, doc.id);
    idToName.set(doc.id, d.name);
    if (d.marketRangeMax != null) idToRangeMax.set(doc.id, d.marketRangeMax);
    if (doc.id === tpMetricId) tpMetricName = d.name;
  }

  if (!tpMetricName) return;

  const leafNames = getLeafDescendantNames(tpMetricName, nameToFormula);
  if (leafNames.length === 0) return;

  const timePoints = sampleTimePoints(halfLife);

  // Only check open markets — resolved/voided docs must not block re-creation
  const existingMarkets = new Set<string>();
  const marketSnap = await db().collection('markets').where('resolved', '==', false).get();
  for (const doc of marketSnap.docs) {
    const d = doc.data();
    existingMarkets.add(`${d.metricId}:${d.targetDate}`);
  }

  const batch = db().batch();
  const created: Array<{ marketId: string; metricName: string; targetDate: string }> = [];

  for (const leafName of leafNames) {
    const leafId = nameToId.get(leafName);
    if (!leafId) continue;
    const rMax = idToRangeMax.get(leafId) ?? AMM_DEFAULTS.rangeMax;

    for (const { date } of timePoints) {
      const key = `${leafId}:${date}`;
      if (existingMarkets.has(key)) continue;
      existingMarkets.add(key);

      const ref = db().collection('markets').doc();
      batch.set(ref, {
        id: ref.id, metricId: leafId, metricName: leafName, targetDate: date,
        resolved: false, resolvedAt: null, actualValue: null, active: true,
        createdAt: FieldValue.serverTimestamp(),
        rangeMin: AMM_DEFAULTS.rangeMin, rangeMax: rMax,
        shares: [0, 0], liquidity: AMM_DEFAULTS.liquidity,
      });
      const liqRef = db().collection('liquidityEvents').doc();
      batch.set(liqRef, { id: liqRef.id, marketId: ref.id, amount: AMM_DEFAULTS.liquidity, totalLiquidity: AMM_DEFAULTS.liquidity, type: 'initial', createdAt: FieldValue.serverTimestamp() });
      created.push({ marketId: ref.id, metricName: leafName, targetDate: date });
    }
  }

  if (created.length > 0) {
    await batch.commit();
    for (const { marketId, metricName, targetDate } of created) {
      await emitEvent('market:created', { marketId, metricName, targetDate });
    }
  }
}

/**
 * Ensure markets exist for the new desired set of leaf/date pairs after a
 * definition change. Existing markets are left running (betting disabled by the
 * daily refresh if they fall out of the desired set) so agents' bets resolve
 * naturally at the target date.
 */
export async function respawnMarketsForTimePreference(
  tpMetricId: string,
  halfLife: number,
): Promise<void> {
  await ensureMarketsForTimePreference(tpMetricId, halfLife);
}

export async function deleteMetric(id: string): Promise<void> {
  await db().collection('metrics').doc(id).delete();
}

export async function getMetricLogs(metricId: string): Promise<MetricLog[]> {
  const snapshot = await db().collection('metricLogs')
    .where('metricId', '==', metricId)
    .orderBy('timestamp', 'asc')
    .get();
  return snapshot.docs.map(doc => {
    const data = doc.data();
    return { metricId: data.metricId, metricName: data.metricName, value: data.value, timestamp: data.timestamp.toDate() };
  });
}

export async function getUpdates(limit?: number): Promise<UpdateEntry[]> {
  const ref = db().collection('updates').orderBy('timestamp', 'desc');
  const snapshot = await (limit ? ref.limit(limit) : ref).get();
  return snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      metricName: data.metricName, oldValue: data.oldValue, newValue: data.newValue,
      description: data.description, timestamp: data.timestamp.toDate(),
    };
  });
}

export async function logSpecificMetrics(metricIds: string[], metrics: Metric[]): Promise<void> {
  const batch = db().batch();
  for (const metricId of metricIds) {
    const metric = metrics.find(m => m.id === metricId);
    if (metric) {
      batch.set(db().collection('metricLogs').doc(), {
        metricId: metric.id, metricName: metric.name, value: metric.total,
        timestamp: FieldValue.serverTimestamp(),
      });
    }
  }
  await batch.commit();
}

export function getStatus(metrics: Metric[]) {
  const xp = calculateXP(metrics);
  return {
    xp,
    rank: calculateRank(xp),
    metrics: metrics.map(m => ({ name: m.name, value: m.value, total: m.total })),
  };
}
