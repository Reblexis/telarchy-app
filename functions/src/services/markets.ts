import { FieldValue, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { db } from '../lib/db';
import { wsCol, wsLockDoc } from '../lib/workspace';
import { sampleTimePoints, getLeafDescendantNames } from '../lib/time-preference';
import { AMM_DEFAULTS, initialPool } from '../lib/amm';
import { emitEvent } from './events';
import { toUnits, fromUnits } from '../lib/validation';

/**
 * Read liquidityEvents for a market and credit the given pool amount back to
 * LPs proportionally to their recorded poolContribution. Mutates the batch.
 */
export async function distributeLPLeftover(
  batch: FirebaseFirestore.WriteBatch,
  marketId: string,
  poolAmount: number,
  workspaceId: string,
): Promise<void> {
  if (poolAmount <= 0) return;
  const liqSnap = await wsCol(workspaceId, 'liquidityEvents').where('marketId', '==', marketId).get();

  const contributions = new Map<string, number>();
  let total = 0;
  for (const doc of liqSnap.docs) {
    const d = doc.data();
    if (typeof d.agentId !== 'string' || !d.agentId) continue;
    if (typeof d.poolContribution !== 'number' || d.poolContribution <= 0) continue;
    contributions.set(d.agentId, (contributions.get(d.agentId) ?? 0) + d.poolContribution);
    total += d.poolContribution;
  }
  if (total <= 0) return;

  let distributed = 0;
  const entries = [...contributions.entries()];
  for (let i = 0; i < entries.length; i++) {
    const [agentId, contribution] = entries[i];
    const share = i === entries.length - 1
      ? Math.round((poolAmount - distributed) * 100) / 100
      : Math.round(poolAmount * contribution / total * 100) / 100;
    if (share <= 0) continue;
    distributed += share;
    batch.update(db().collection('agents').doc(agentId), {
      balance: FieldValue.increment(toUnits(share)),
      earnedBetting: FieldValue.increment(share),
    });
  }
}

/** Void a single open market: refund all positions at cost, mark resolved+voided. */
export async function voidMarket(
  docOrId: QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot | string,
  workspaceId = 'default',
): Promise<{ refunded: number }> {
  const marketDoc = typeof docOrId === 'string'
    ? await wsCol(workspaceId, 'markets').doc(docOrId).get()
    : docOrId;
  if (!marketDoc.exists) return { refunded: 0 };
  const m = marketDoc.data()!;
  if (m.resolved) return { refunded: 0 };

  const posSnap = await wsCol(workspaceId, 'positions').where('marketId', '==', marketDoc.id).get();
  const batch = db().batch();
  let refunded = 0;

  const pool: number = (m.pool as number) ?? 0;
  batch.update(marketDoc.ref, {
    resolved: true, resolvedAt: FieldValue.serverTimestamp(), actualValue: null, voided: true, pool: 0,
  });
  for (const posDoc of posSnap.docs) {
    const pos = posDoc.data();
    if (pos.totalCost <= 0) continue;
    refunded += pos.totalCost;
    // agents is a global collection — not workspace-scoped
    batch.update(db().collection('agents').doc(pos.agentId), {
      balance: FieldValue.increment(toUnits(pos.totalCost)),
      earnedBetting: FieldValue.increment(pos.totalCost),
      spentBetting: FieldValue.increment(-pos.totalCost),
    });
  }

  const lpLeftover = Math.round((pool - refunded) * 100) / 100;
  await distributeLPLeftover(batch, marketDoc.id, lpLeftover, workspaceId);

  await batch.commit();
  emitEvent('market:resolved', { marketId: marketDoc.id, metricName: m.metricName, targetDate: m.targetDate, voided: true }, workspaceId).catch(e => console.error('emitEvent failed:', e));
  return { refunded };
}

/** Void all open markets whose metricId is in the provided set. */
export async function voidOpenMarketsForMetrics(metricIds: Set<string>, workspaceId = 'default'): Promise<void> {
  const openSnap = await wsCol(workspaceId, 'markets').where('resolved', '==', false).get();
  for (const doc of openSnap.docs) {
    if (metricIds.has(doc.data().metricId)) await voidMarket(doc, workspaceId);
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
export async function refreshRelativeDateMarkets(workspaceId = 'default'): Promise<{ created: number; deactivated: number; deduplicated: number }> {
  const lockRef = wsLockDoc(workspaceId, 'marketRefreshLock');
  const acquired = await db().runTransaction(async tx => {
    const lock = await tx.get(lockRef);
    const d = lock.data() ?? {};
    if (lock.exists && d.locked && (d.expiresAt as number) > Date.now()) return false;
    tx.set(lockRef, { locked: true, expiresAt: Date.now() + 120_000 });
    return true;
  });
  if (!acquired) return { created: 0, deactivated: 0, deduplicated: 0 };
  const metricsSnap = await wsCol(workspaceId, 'metrics').get();
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
  const marketSnap = await wsCol(workspaceId, 'markets').where('resolved', '==', false).get();
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

    const createdSecs = (d.createdAt as { seconds?: number })?.seconds;
    if (createdSecs === undefined) {
      console.error(`Market ${doc.id} has no createdAt timestamp — data integrity issue`);
      continue;
    }
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

    // Normalize stale liquidity: untraded markets (shares [0,0]) should use the
    // current default. Markets created under an old AMM_DEFAULTS.liquidity linger
    // with the old value otherwise.
    const shares = d.shares as [number, number] | undefined;
    const isUntraded = shares && shares[0] === 0 && shares[1] === 0;
    if (isUntraded && d.liquidity !== AMM_DEFAULTS.liquidity) {
      batch.update(doc.ref, { liquidity: AMM_DEFAULTS.liquidity });
    }
  }

  // Create missing markets
  let created = 0;
  for (const [key, { metricId, metricName, targetDate }] of desiredRefs) {
    if (openKeys.has(key)) continue;
    const rMax = idToRangeMax.get(metricId) ?? AMM_DEFAULTS.rangeMax;
    const ref = wsCol(workspaceId, 'markets').doc();
    batch.set(ref, {
      id: ref.id, metricId, metricName, targetDate,
      resolved: false, resolvedAt: null, actualValue: null, active: true,
      createdAt: FieldValue.serverTimestamp(),
      rangeMin: AMM_DEFAULTS.rangeMin, rangeMax: rMax,
      shares: [0, 0], liquidity: AMM_DEFAULTS.liquidity,
      pool: initialPool(AMM_DEFAULTS.liquidity),
    });
    const liqRef = wsCol(workspaceId, 'liquidityEvents').doc();
    batch.set(liqRef, { id: liqRef.id, marketId: ref.id, amount: AMM_DEFAULTS.liquidity, totalLiquidity: AMM_DEFAULTS.liquidity, type: 'initial', createdAt: FieldValue.serverTimestamp() });
    created++;
  }

  await batch.commit();

  // Void duplicate markets (sequential to respect Firestore limits)
  for (const doc of toVoid) await voidMarket(doc, workspaceId);
  const deduplicated = toVoid.length;

  await lockRef.set({ locked: false });
  return { created, deactivated, deduplicated };
}
