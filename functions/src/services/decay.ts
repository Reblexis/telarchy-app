import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { calculateDaysPassed, getAffectedMetrics } from '../lib/metrics-engine';
import { getAllMetrics, logSpecificMetrics } from './metrics';

export async function applyDecay(): Promise<{ decayedCount: number; daysPassed: number } | null> {
  const firestore = getFirestore();
  const lastDecayRef = firestore.collection('system').doc('lastDecay');
  const lastDecayDoc = await lastDecayRef.get();

  const now = new Date();
  const today = now.toISOString().split('T')[0];

  if (!lastDecayDoc.exists) {
    await lastDecayRef.set({ lastDecayDate: today, timestamp: FieldValue.serverTimestamp() });
    return null;
  }

  const lastDecayDate = lastDecayDoc.data()!.lastDecayDate;
  const daysPassed = calculateDaysPassed(lastDecayDate, now);
  if (daysPassed <= 0) return null;

  const metricsSnapshot = await firestore.collection('metrics').get();
  const batch = firestore.batch();
  const decayedMetricIds: string[] = [];

  metricsSnapshot.docs.forEach(doc => {
    const data = doc.data();
    if (data.decay === true) {
      batch.update(doc.ref, { value: Math.max(0, data.value - daysPassed) });
      decayedMetricIds.push(doc.id);
    }
  });

  if (decayedMetricIds.length > 0) {
    await batch.commit();
    await firestore.collection('updates').add({
      metricName: 'Automatic Daily Decay',
      oldValue: 0, newValue: -daysPassed,
      description: `Automatic decay: ${daysPassed} day${daysPassed > 1 ? 's' : ''} passed (${decayedMetricIds.length} metrics affected)`,
      timestamp: FieldValue.serverTimestamp(),
    });
    const metrics = await getAllMetrics();
    await logSpecificMetrics(getAffectedMetrics(decayedMetricIds, metrics), metrics);
  }

  await lastDecayRef.set({ lastDecayDate: today, timestamp: FieldValue.serverTimestamp() });
  return { decayedCount: decayedMetricIds.length, daysPassed };
}
