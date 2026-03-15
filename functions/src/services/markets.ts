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
 * Ensure markets exist for all time-preferenced metrics.
 * Markets that fall out of the desired (leaf, date) set are marked active:false
 * (not voided) so they can still be naturally resolved when their date arrives.
 * Called by the daily cron (00:10 UTC) and the manual "Refresh Markets" button.
 *
 * A Firestore distributed lock prevents concurrent executions (e.g. cron + manual
 * trigger overlapping) from creating duplicate markets.
 */
export async function refreshRelativeDateMarkets(): Promise<{ created: number; deactivated: number; deduplicated: number }> {
  const lockRef = db().doc('_system/marketRefreshLock');
  const acquired = await db().runTransaction(async tx => {
    const lock = await tx.get(lockRef);
    const d = lock.data() ?? {};
    if (lock.exists && d.locked && (d.expiresAt as number) > Date.now()) return false;
    tx.set(lockRef, { locked: true, expiresAt: Date.now() + 120_000 });
    return true;
  });
  if (!acquired) return { created: 0, deactivated: 0, deduplicated: 0 };
  const metricsSnap = await db().collection('metrics').get();
  const nameToFormula: Record<string, string> = {};
  const nameToId = new Map<string, string>();
  const idToRangeMax = new Map<string, number>();
  const tpMetrics: { id: string; name: string; halfLife: number }[] = [];

  for (const doc of metricsSnap.docs) {
    const d = doc.data();
    nameToFormula[d.name] = d.formula || '0';
    nameToId.set(d.name, doc.id);
    if (d.marketRangeMax != null) idToRangeMax.set(doc.id, d.marketRangeMax);
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

  // Only load open markets — resolved/voided docs must not block re-creation
  const marketSnap = await db().collection('markets').where('resolved', '==', false).get();
  const openKeys = new Set<string>();

  const batch = db().batch();
  let deactivated = 0;

  // Track non-task markets per key to detect duplicates
  const seenNonTask = new Map<string, { doc: QueryDocumentSnapshot; createdSecs: number }>();
  const toVoid: QueryDocumentSnapshot[] = [];

  for (const doc of marketSnap.docs) {
    const d = doc.data();
    const key = `${d.metricId}:${d.targetDate}`;
    openKeys.add(key);
    // Task-conditional markets are managed by the task lifecycle — skip them.
    if (d.taskId) continue;

    // Detect duplicates: keep the oldest, mark extras for voiding
    const createdSecs = (d.createdAt as { seconds?: number })?.seconds ?? 0;
    const prev = seenNonTask.get(key);
    if (!prev) {
      seenNonTask.set(key, { doc, createdSecs });
    } else if (createdSecs < prev.createdSecs) {
      toVoid.push(prev.doc);
      seenNonTask.set(key, { doc, createdSecs });
    } else {
      toVoid.push(doc);
    }

    const shouldBeActive = desiredRefs.has(key);
    if (shouldBeActive && d.active === false) {
      batch.update(doc.ref, { active: true });
    } else if (!shouldBeActive && d.active !== false) {
      batch.update(doc.ref, { active: false });
      deactivated++;
    }
  }

  // Create missing markets
  let created = 0;
  for (const [key, { metricId, metricName, targetDate }] of desiredRefs) {
    if (openKeys.has(key)) continue;
    const rMax = idToRangeMax.get(metricId) ?? AMM_DEFAULTS.rangeMax;
    const ref = db().collection('markets').doc();
    batch.set(ref, {
      id: ref.id, metricId, metricName, targetDate,
      resolved: false, resolvedAt: null, actualValue: null, active: true,
      createdAt: FieldValue.serverTimestamp(),
      rangeMin: AMM_DEFAULTS.rangeMin, rangeMax: rMax,
      shares: [0, 0], liquidity: AMM_DEFAULTS.liquidity,
    });
    const liqRef = db().collection('liquidityEvents').doc();
    batch.set(liqRef, { id: liqRef.id, marketId: ref.id, amount: AMM_DEFAULTS.liquidity, totalLiquidity: AMM_DEFAULTS.liquidity, type: 'initial', createdAt: FieldValue.serverTimestamp() });
    created++;
  }

  if (created > 0 || deactivated > 0) await batch.commit();

  // Void duplicate markets (sequential to respect Firestore limits)
  for (const doc of toVoid) await voidMarket(doc);
  const deduplicated = toVoid.length;

  await lockRef.set({ locked: false });
  return { created, deactivated, deduplicated };
}
