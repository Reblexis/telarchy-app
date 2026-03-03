import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { Metric, MetricLog, UpdateEntry } from '../types';
import { recalculateMetrics, calculateMetricDepths, calculateXP, calculateRank } from '../lib/metrics-engine';
import { sampleTimePoints, getLeafDescendantNames } from '../lib/time-preference';
import { consensus as ammConsensus, AMM_DEFAULTS } from '../lib/amm';

function db() { return getFirestore(); }

function enrichMetrics(metrics: Metric[], consensusMap: Record<string, number> = {}): Metric[] {
  recalculateMetrics(metrics, consensusMap);
  const depths = calculateMetricDepths(metrics);
  metrics.forEach(m => { m.depth = depths[m.id] ?? 0; });
  metrics.sort((a, b) => a.depth !== b.depth ? a.depth - b.depth : (a.order || 999) - (b.order || 999));
  return metrics;
}

async function buildConsensusMap(): Promise<Record<string, number>> {
  const marketSnap = await db().collection('markets').where('resolved', '==', false).get();
  if (marketSnap.empty) return {};

  const map: Record<string, number> = {};
  for (const doc of marketSnap.docs) {
    const m = doc.data();
    if (!m.shares || !m.liquidity) continue;
    const key = `${m.metricName}:${m.targetDate}`;
    map[key] = ammConsensus(m.shares, m.liquidity, m.rangeMin, m.rangeMax);
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

  for (const doc of metricsSnap.docs) {
    const d = doc.data();
    nameToFormula[d.name] = d.formula || '0';
    nameToId.set(d.name, doc.id);
    idToName.set(doc.id, d.name);
    if (doc.id === tpMetricId) tpMetricName = d.name;
  }

  if (!tpMetricName) return;

  const leafNames = getLeafDescendantNames(tpMetricName, nameToFormula);
  if (leafNames.length === 0) return;

  const timePoints = sampleTimePoints(halfLife);

  // Load all existing markets once to avoid N individual reads
  const existingMarkets = new Set<string>();
  const marketSnap = await db().collection('markets').get();
  for (const doc of marketSnap.docs) {
    const d = doc.data();
    existingMarkets.add(`${d.metricId}:${d.targetDate}`);
  }

  const batch = db().batch();
  let writes = 0;

  for (const leafName of leafNames) {
    const leafId = nameToId.get(leafName);
    if (!leafId) continue;

    for (const { date } of timePoints) {
      const key = `${leafId}:${date}`;
      if (existingMarkets.has(key)) continue;
      existingMarkets.add(key);

      const ref = db().collection('markets').doc();
      batch.set(ref, {
        id: ref.id, metricId: leafId, metricName: leafName, targetDate: date,
        resolved: false, resolvedAt: null, actualValue: null,
        createdAt: FieldValue.serverTimestamp(),
        rangeMin: AMM_DEFAULTS.rangeMin, rangeMax: AMM_DEFAULTS.rangeMax,
        shares: [0, 0], liquidity: AMM_DEFAULTS.liquidity,
      });
      writes++;
    }
  }

  if (writes > 0) await batch.commit();
}

/**
 * Void all open markets for the leaf descendants of a time-preferenced node,
 * refunding positions, then recreate fresh markets.
 */
export async function respawnMarketsForTimePreference(
  tpMetricId: string,
  halfLife: number,
): Promise<void> {
  const metricsSnap = await db().collection('metrics').get();
  const nameToFormula: Record<string, string> = {};
  const nameToId = new Map<string, string>();
  let tpMetricName = '';

  for (const doc of metricsSnap.docs) {
    const d = doc.data();
    nameToFormula[d.name] = d.formula || '0';
    nameToId.set(d.name, doc.id);
    if (doc.id === tpMetricId) tpMetricName = d.name;
  }

  if (!tpMetricName) return;

  const leafNames = getLeafDescendantNames(tpMetricName, nameToFormula);
  if (leafNames.length === 0) return;

  const leafIds = new Set(leafNames.map(n => nameToId.get(n)).filter(Boolean) as string[]);

  // Void all open markets for these leaves (refund positions)
  const openMarkets = await db().collection('markets').where('resolved', '==', false).get();
  for (const doc of openMarkets.docs) {
    const m = doc.data();
    if (!leafIds.has(m.metricId)) continue;

    const posSnap = await db().collection('positions').where('marketId', '==', doc.id).get();
    const batch = db().batch();
    batch.update(doc.ref, { resolved: true, resolvedAt: FieldValue.serverTimestamp(), actualValue: null, voided: true });

    for (const posDoc of posSnap.docs) {
      const pos = posDoc.data();
      if (pos.totalCost <= 0) continue;
      batch.update(db().collection('agents').doc(pos.agentId), {
        balance: FieldValue.increment(pos.totalCost),
        earnedBetting: FieldValue.increment(pos.totalCost),
        spentBetting: FieldValue.increment(-pos.totalCost),
      });
    }
    await batch.commit();
  }

  // Now spawn fresh markets
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
