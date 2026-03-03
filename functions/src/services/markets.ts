import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { sampleTimePoints, getLeafDescendantNames } from '../lib/time-preference';
import { AMM_DEFAULTS } from '../lib/amm';

function db() { return getFirestore(); }

/** Void a single open market: refund all positions at cost, mark resolved+voided. */
export async function voidMarket(marketDoc: QueryDocumentSnapshot): Promise<void> {
  const posSnap = await db().collection('positions').where('marketId', '==', marketDoc.id).get();
  const batch = db().batch();
  batch.update(marketDoc.ref, {
    resolved: true, resolvedAt: FieldValue.serverTimestamp(), actualValue: null, voided: true,
  });
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

/** Void all open markets whose metricId is in the provided set. */
export async function voidOpenMarketsForMetrics(metricIds: Set<string>): Promise<void> {
  const openSnap = await db().collection('markets').where('resolved', '==', false).get();
  for (const doc of openSnap.docs) {
    if (metricIds.has(doc.data().metricId)) await voidMarket(doc);
  }
}

/**
 * Ensure markets exist for all time-preferenced metrics, and prune any open
 * markets that are no longer in the desired (leaf, date) set.
 * Called by the daily cron (00:10 UTC) and the manual "Refresh Markets" button.
 */
export async function refreshRelativeDateMarkets(): Promise<{ created: number; voided: number }> {
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

  // Collect desired (leaf, date) pairs across all TP metrics
  const desiredRefs = new Map<string, { metricId: string; metricName: string; targetDate: string }>();
  for (const tp of tpMetrics) {
    const leafNames = getLeafDescendantNames(tp.name, nameToFormula);
    const timePoints = sampleTimePoints(tp.halfLife);
    for (const leafName of leafNames) {
      const leafId = nameToId.get(leafName);
      if (!leafId) continue;
      for (const { date } of timePoints) {
        desiredRefs.set(`${leafId}:${date}`, { metricId: leafId, metricName: leafName, targetDate: date });
      }
    }
  }

  // Single pass over all markets: track existing keys and collect open stale docs
  const marketSnap = await db().collection('markets').get();
  const existingAllKeys = new Set<string>();
  const staleOpenDocs: QueryDocumentSnapshot[] = [];

  for (const doc of marketSnap.docs) {
    const d = doc.data();
    const key = `${d.metricId}:${d.targetDate}`;
    existingAllKeys.add(key);
    if (!d.resolved && !desiredRefs.has(key)) staleOpenDocs.push(doc);
  }

  // Prune stale open markets
  let voided = 0;
  for (const doc of staleOpenDocs) {
    await voidMarket(doc);
    voided++;
  }

  // Create missing markets
  const batch = db().batch();
  let created = 0;
  for (const [key, { metricId, metricName, targetDate }] of desiredRefs) {
    if (existingAllKeys.has(key)) continue;
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
  return { created, voided };
}
