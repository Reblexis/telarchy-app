import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { extractConsensusReferences } from '../lib/metrics-engine';
import { toAbsoluteDate } from '../lib/date-utils';

function db() { return getFirestore(); }

/**
 * Refresh markets for consensus references in formulas.
 * Scans all metrics, finds consensus references (absolute and relative dates),
 * and creates markets if they don't exist. Relative dates are resolved to absolute.
 */
export async function refreshRelativeDateMarkets(): Promise<{ created: number }> {
  const metricsSnap = await db().collection('metrics').get();
  const nameToMetric = new Map<string, { id: string; name: string }>();
  const formulasByDoc: Array<{ formula: string }> = [];

  for (const doc of metricsSnap.docs) {
    const data = doc.data();
    nameToMetric.set(data.name, { id: doc.id, name: data.name });
    if (data.formula) formulasByDoc.push({ formula: data.formula });
  }

  const allRefs = new Map<string, { metricId: string; metricName: string; targetDate: string }>();
  for (const { formula } of formulasByDoc) {
    for (const { name, date, isRelative } of extractConsensusReferences(formula)) {
      const targetDate = isRelative ? toAbsoluteDate(date) : date;
      const metric = nameToMetric.get(name);
      if (metric) {
        allRefs.set(`${metric.id}:${targetDate}`, {
          metricId: metric.id,
          metricName: metric.name,
          targetDate,
        });
      }
    }
  }
  
  if (allRefs.size === 0) {
    return { created: 0 };
  }

  const existingMarkets = new Set<string>();
  const marketSnap = await db().collection('markets').get();
  for (const doc of marketSnap.docs) {
    const data = doc.data();
    existingMarkets.add(`${data.metricId}:${data.targetDate}`);
  }

  const batch = db().batch();
  let created = 0;
  for (const [key, { metricId, metricName, targetDate }] of allRefs) {
    if (existingMarkets.has(key)) continue;
    
    const ref = db().collection('markets').doc();
    batch.set(ref, {
      id: ref.id,
      metricId,
      metricName,
      targetDate,
      resolved: false,
      resolvedAt: null,
      actualValue: null,
      createdAt: FieldValue.serverTimestamp(),
    });
    created++;
  }
  
  if (created > 0) {
    await batch.commit();
  }
  
  return { created };
}
