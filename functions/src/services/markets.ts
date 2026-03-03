import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { sampleTimePoints, getLeafDescendantNames } from '../lib/time-preference';
import { AMM_DEFAULTS } from '../lib/amm';

function db() { return getFirestore(); }

/**
 * Ensure markets exist for all time-preferenced metrics.
 * Called by the daily cron (00:10 UTC) and the manual "Refresh Markets" button.
 * Creates markets for any (leaf, date) pair not yet present.
 */
export async function refreshRelativeDateMarkets(): Promise<{ created: number }> {
  const metricsSnap = await db().collection('metrics').get();
  const nameToFormula: Record<string, string> = {};
  const nameToId = new Map<string, string>();
  const tpMetrics: { id: string; name: string; halfLife: number }[] = [];

  for (const doc of metricsSnap.docs) {
    const d = doc.data();
    nameToFormula[d.name] = d.formula || '0';
    nameToId.set(d.name, doc.id);
    if (d.timePreference?.enabled) {
      tpMetrics.push({ id: doc.id, name: d.name, halfLife: d.timePreference.halfLife });
    }
  }

  if (tpMetrics.length === 0) return { created: 0 };

  // Collect all (leaf, date) pairs across all TP metrics
  const allRefs = new Map<string, { metricId: string; metricName: string; targetDate: string }>();
  for (const tp of tpMetrics) {
    const leafNames = getLeafDescendantNames(tp.name, nameToFormula);
    const timePoints = sampleTimePoints(tp.halfLife);

    for (const leafName of leafNames) {
      const leafId = nameToId.get(leafName);
      if (!leafId) continue;
      for (const { date } of timePoints) {
        allRefs.set(`${leafId}:${date}`, { metricId: leafId, metricName: leafName, targetDate: date });
      }
    }
  }

  if (allRefs.size === 0) return { created: 0 };

  const existingMarkets = new Set<string>();
  const marketSnap = await db().collection('markets').get();
  for (const doc of marketSnap.docs) {
    const d = doc.data();
    existingMarkets.add(`${d.metricId}:${d.targetDate}`);
  }

  const batch = db().batch();
  let created = 0;

  for (const [key, { metricId, metricName, targetDate }] of allRefs) {
    if (existingMarkets.has(key)) continue;
    const ref = db().collection('markets').doc();
    batch.set(ref, {
      id: ref.id, metricId, metricName, targetDate,
      resolved: false, resolvedAt: null, actualValue: null,
      createdAt: FieldValue.serverTimestamp(),
      rangeMin: AMM_DEFAULTS.rangeMin, rangeMax: AMM_DEFAULTS.rangeMax,
      shares: [0, 0], liquidity: AMM_DEFAULTS.liquidity,
    });
    created++;
  }

  if (created > 0) await batch.commit();
  return { created };
}
