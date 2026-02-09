import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { Metric, MetricLog, UpdateEntry } from '../types';
import {
  recalculateMetrics, calculateMetricDepths, calculateXP, calculateRank,
} from '../lib/metrics-engine';

function db() { return getFirestore(); }

function enrichMetrics(metrics: Metric[]): Metric[] {
  recalculateMetrics(metrics);
  const depths = calculateMetricDepths(metrics);
  metrics.forEach(m => { m.depth = depths[m.id] || 0; });
  metrics.sort((a, b) => a.depth !== b.depth ? a.depth - b.depth : (a.order || 999) - (b.order || 999));
  return metrics;
}

export async function getAllMetrics(): Promise<Metric[]> {
  const snapshot = await db().collection('metrics').get();
  return enrichMetrics(snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id, name: data.name, description: data.description || '',
      value: data.value, total: data.value, formula: data.formula || '0',
      decay: data.decay || false, order: data.order || 999, depth: 0,
    };
  }));
}

export async function getMetricById(id: string): Promise<Metric | null> {
  const metrics = await getAllMetrics();
  return metrics.find(m => m.id === id) || null;
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
