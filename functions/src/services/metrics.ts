import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { Metric, MetricLog, UpdateEntry } from '../types';
import {
  recalculateMetrics, calculateMetricDepths, calculateXP, calculateRank,
  extractConsensusReferences,
} from '../lib/metrics-engine';

function db() { return getFirestore(); }

function enrichMetrics(metrics: Metric[], consensusMap: Record<string, number> = {}): Metric[] {
  recalculateMetrics(metrics, consensusMap);
  const depths = calculateMetricDepths(metrics);
  metrics.forEach(m => { m.depth = depths[m.id] || 0; });
  metrics.sort((a, b) => a.depth !== b.depth ? a.depth - b.depth : (a.order || 999) - (b.order || 999));
  return metrics;
}

async function buildConsensusMap(): Promise<Record<string, number>> {
  const predSnap = await db().collection('predictions').where('resolved', '==', false).get();
  if (predSnap.empty) return {};

  // Fetch all open markets to get metric names
  const marketSnap = await db().collection('markets').where('resolved', '==', false).get();
  const marketMetricNames = new Map<string, string>(); // metricId -> metricName
  for (const doc of marketSnap.docs) {
    const m = doc.data();
    marketMetricNames.set(m.metricId, m.metricName);
  }

  // Group predictions by metricName:targetDate
  const groups = new Map<string, { weightedSum: number; totalStake: number }>();
  for (const doc of predSnap.docs) {
    const { metricId, targetDate, predictedValue, stake } = doc.data();
    const metricName = marketMetricNames.get(metricId);
    if (!metricName) continue;
    const key = `${metricName}:${targetDate}`;
    const existing = groups.get(key);
    if (existing) {
      existing.weightedSum += predictedValue * stake;
      existing.totalStake += stake;
    } else {
      groups.set(key, { weightedSum: predictedValue * stake, totalStake: stake });
    }
  }

  const map: Record<string, number> = {};
  for (const [key, { weightedSum, totalStake }] of groups) {
    if (totalStake > 0) {
      map[key] = Math.round((weightedSum / totalStake) * 100) / 100;
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
    };
  }), consensusMap);
}

export async function getMetricById(id: string): Promise<Metric | null> {
  const metrics = await getAllMetrics();
  return metrics.find(m => m.id === id) || null;
}

/**
 * Auto-create markets for any consensus() references in a formula
 * where the metric exists and the market doesn't yet exist.
 */
export async function ensureMarketsForFormula(formula: string): Promise<void> {
  const refs = extractConsensusReferences(formula);
  if (refs.length === 0) return;

  // Look up which metrics exist by name
  const metricsSnap = await db().collection('metrics').get();
  const nameToMetric = new Map<string, { id: string; name: string }>();
  for (const doc of metricsSnap.docs) {
    const d = doc.data();
    nameToMetric.set(d.name, { id: doc.id, name: d.name });
  }

  const batch = db().batch();
  let writes = 0;

  for (const { name, date } of refs) {
    const metric = nameToMetric.get(name);
    if (!metric) continue; // metric doesn't exist, skip

    // Check if market already exists
    const existing = await db().collection('markets')
      .where('metricId', '==', metric.id)
      .where('targetDate', '==', date)
      .limit(1)
      .get();
    if (!existing.empty) continue;

    const ref = db().collection('markets').doc();
    batch.set(ref, {
      id: ref.id,
      metricId: metric.id,
      metricName: metric.name,
      targetDate: date,
      resolved: false,
      resolvedAt: null,
      actualValue: null,
      createdAt: FieldValue.serverTimestamp(),
    });
    writes++;
  }

  if (writes > 0) await batch.commit();
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
