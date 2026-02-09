import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { Metric, MetricLog, UpdateEntry } from '../types';
import {
  recalculateMetrics, calculateMetricDepths, calculateXP, calculateRank,
  getAffectedMetrics, detectCircularDependency,
} from '../lib/metrics-engine';

function db() { return getFirestore(); }

export async function getAllMetrics(): Promise<Metric[]> {
  const snapshot = await db().collection('metrics').get();
  const metrics: Metric[] = snapshot.docs.map(doc => {
    const data = doc.data();
    return {
      id: doc.id,
      name: data.name,
      description: data.description || '',
      value: data.value,
      total: data.value,
      formula: data.formula || '0',
      decay: data.decay || false,
      order: data.order || 999,
      depth: 0,
    };
  });

  recalculateMetrics(metrics);
  const depths = calculateMetricDepths(metrics);
  metrics.forEach(m => { m.depth = depths[m.id] || 0; });
  metrics.sort((a, b) => a.depth !== b.depth ? a.depth - b.depth : (a.order || 999) - (b.order || 999));
  return metrics;
}

export async function getMetricById(id: string): Promise<Metric | null> {
  const metrics = await getAllMetrics();
  return metrics.find(m => m.id === id) || null;
}

export async function createMetric(
  name: string, description: string, value: number, formula: string, decay: boolean
): Promise<Metric[]> {
  const current = await getAllMetrics();
  if (detectCircularDependency(null, formula, current)) {
    throw new Error('This formula would create a circular dependency');
  }
  const docRef = await db().collection('metrics').add({ name, value, formula, description, decay, order: 999 });
  // Re-fetch once after insert, reuse for both affected calculation and logging
  const metrics = await getAllMetrics();
  await logSpecificMetrics(getAffectedMetrics([docRef.id], metrics), metrics);
  return metrics;
}

export async function updateMetric(
  id: string, name: string, description: string, value: number,
  formula: string, decay: boolean, oldValue: number, updateNote: string
): Promise<Metric[]> {
  const current = await getAllMetrics();
  if (detectCircularDependency(id, formula, current)) {
    throw new Error('This formula would create a circular dependency');
  }
  const updatePromise = db().collection('metrics').doc(id).update({ name, description, value, formula, decay });
  const logPromise = oldValue !== value
    ? db().collection('updates').add({
        metricName: name, oldValue, newValue: value,
        description: updateNote || 'Value updated',
        timestamp: FieldValue.serverTimestamp(),
      })
    : Promise.resolve();
  await Promise.all([updatePromise, logPromise]);
  // Single re-fetch after writes, reuse for affected calculation and logging
  const metrics = await getAllMetrics();
  await logSpecificMetrics(getAffectedMetrics([id], metrics), metrics);
  return metrics;
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
      const ref = db().collection('metricLogs').doc();
      batch.set(ref, {
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
