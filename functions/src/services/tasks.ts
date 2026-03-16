import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../lib/db';
import { consensus } from '../lib/amm';
import { recalculateMetrics } from '../lib/metrics-engine';
import { getAllMetrics, buildConsensusMap } from './metrics';
import { voidMarket } from './markets';

type TaskMarketDoc = {
  metricId: string;
  metricName: string;
  targetDate: string;
  rangeMin: number;
  rangeMax: number;
  liquidity: number;
  shares?: [number, number];
};

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function getTradeCountMap(marketIds: string[]): Promise<Map<string, number>> {
  const tradeCountMap = new Map<string, number>();
  for (const ids of chunk(marketIds, 10)) {
    const tradesSnap = await db().collection('trades')
      .where('marketId', 'in', ids)
      .get();
    for (const d of tradesSnap.docs) {
      const marketId = d.data().marketId;
      tradeCountMap.set(marketId, (tradeCountMap.get(marketId) || 0) + 1);
    }
  }
  return tradeCountMap;
}

async function getBaselineConsensusMap(markets: TaskMarketDoc[]): Promise<Map<string, number>> {
  const wantedKeys = new Set(markets.map(m => `${m.metricId}:${m.targetDate}`));
  const metricIds = Array.from(new Set(markets.map(m => m.metricId)));
  const baselineConsensusMap = new Map<string, number>();

  for (const ids of chunk(metricIds, 10)) {
    const snap = await db().collection('markets')
      .where('resolved', '==', false)
      .where('metricId', 'in', ids)
      .get();

    for (const doc of snap.docs) {
      const market = doc.data();
      if (market.taskId || market.active === false) continue;
      const key = `${market.metricId}:${market.targetDate}`;
      if (!wantedKeys.has(key) || baselineConsensusMap.has(key)) continue;
      baselineConsensusMap.set(
        key,
        consensus(market.shares || [0, 0], market.liquidity, market.rangeMin, market.rangeMax),
      );
    }
  }

  return baselineConsensusMap;
}

export async function getTaskUtilitySummary(
  markets: Array<{ metricName: string; targetDate: string; consensus: number | null; tradeCount: number }>,
) {
  const [baselineMetrics, baselineConsensus] = await Promise.all([
    getAllMetrics(),
    buildConsensusMap(),
  ]);
  const baselineUtility = baselineMetrics.find(m => m.name === 'Utility')?.total ?? null;
  if (markets.length === 0) {
    return { expectedCurrentUtility: null, baselineUtility };
  }

  // Start from the baseline map and only overlay conditional values from
  // markets that have actually been traded on. Untouched conditional markets
  // (tradeCount=0) should inherit the baseline consensus, not overwrite it
  // with an artificial value from 0-liquidity defaults.
  const conditionalConsensusMap: Record<string, number> = { ...baselineConsensus };
  for (const market of markets) {
    if (market.consensus === null || market.tradeCount === 0) continue;
    conditionalConsensusMap[`${market.metricName}:${market.targetDate}`] = market.consensus;
  }

  const conditionalMetrics = baselineMetrics.map(metric => ({ ...metric }));
  recalculateMetrics(conditionalMetrics, conditionalConsensusMap);
  const expectedCurrentUtility = conditionalMetrics.find(m => m.name === 'Utility')?.total ?? null;

  return { expectedCurrentUtility, baselineUtility };
}

/**
 * Create conditional markets for a task by cloning all currently open, active
 * leaf markets (TP-driven). Each clone has the same metric/date/range but starts
 * with zero bets and is tagged with taskId.
 *
 * If unresolved conditional markets already exist for this task and their
 * (metricId, targetDate) set matches the current source markets, the existing
 * markets are kept as-is (preserving any trades). Otherwise the stale set is
 * voided and a fresh set is created.
 */
export async function createConditionalMarkets(taskId: string): Promise<string[]> {
  // Identify leaf metric IDs (no formula or formula === '0')
  const metricsSnap = await db().collection('metrics').get();
  const leafMetricIds = new Set(
    metricsSnap.docs
      .filter(d => { const f = d.data().formula; return !f || f === '0'; })
      .map(d => d.id),
  );

  // All open, non-conditional markets for leaf metrics (active !== false)
  const openSnap = await db().collection('markets')
    .where('resolved', '==', false)
    .get();
  const sourceMarkets = openSnap.docs.filter(d => {
    const dd = d.data();
    return dd.active !== false && !dd.taskId && leafMetricIds.has(dd.metricId);
  });

  const desiredKeys = new Set(sourceMarkets.map(d => {
    const m = d.data();
    return `${m.metricId}:${m.targetDate}`;
  }));

  // Check existing unresolved conditional markets for this task
  const existingSnap = await db().collection('markets')
    .where('taskId', '==', taskId)
    .where('resolved', '==', false)
    .get();

  if (existingSnap.size > 0) {
    const existingKeys = new Set(existingSnap.docs.map(d => {
      const m = d.data();
      return `${m.metricId}:${m.targetDate}`;
    }));
    const setsMatch = desiredKeys.size === existingKeys.size &&
      [...desiredKeys].every(k => existingKeys.has(k));
    if (setsMatch) return existingSnap.docs.map(d => d.id);
  }

  // Stale set — void and recreate
  await voidTaskMarkets(taskId);

  const BATCH_LIMIT = 450;
  const newIds: string[] = [];
  let batch = db().batch();
  let batchCount = 0;

  for (const src of sourceMarkets) {
    const m = src.data();
    const ref = db().collection('markets').doc();
    batch.set(ref, {
      id: ref.id,
      metricId: m.metricId,
      metricName: m.metricName,
      targetDate: m.targetDate,
      resolved: false,
      resolvedAt: null,
      actualValue: null,
      active: true,
      taskId,
      createdAt: FieldValue.serverTimestamp(),
      rangeMin: m.rangeMin,
      rangeMax: m.rangeMax,
      shares: [0, 0],
      liquidity: m.liquidity,
    });
    newIds.push(ref.id);
    batchCount++;
    if (batchCount >= BATCH_LIMIT) {
      await batch.commit();
      batch = db().batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) await batch.commit();
  return newIds;
}

/** Void all open conditional markets tied to a task. */
export async function voidTaskMarkets(taskId: string): Promise<void> {
  const marketsSnap = await db().collection('markets')
    .where('taskId', '==', taskId)
    .where('resolved', '==', false)
    .get();
  for (const doc of marketsSnap.docs) {
    await voidMarket(doc);
  }
}

/** Gift price credits to the proposing agent and mark the task approved. */
export async function approveTask(taskId: string): Promise<void> {
  const taskRef = db().collection('tasks').doc(taskId);
  const taskDoc = await taskRef.get();
  if (!taskDoc.exists) throw new Error('Task not found');
  const task = taskDoc.data()!;
  if (task.status !== 'pending') throw new Error('Task is not pending');

  const agentRef = db().collection('agents').doc(task.proposedBy);
  const agentDoc = await agentRef.get();
  if (!agentDoc.exists) throw new Error('Proposing agent not found');

  const batch = db().batch();
  batch.update(taskRef, { status: 'approved' });
  batch.update(agentRef, {
    balance: FieldValue.increment(task.price),
    earnedTasks: FieldValue.increment(task.price),
  });
  await batch.commit();
}

/** Return enriched market summaries for the given market IDs. */
export async function getTaskMarketSummaries(marketIds: string[]) {
  if (marketIds.length === 0) return [];
  const docs = await Promise.all(marketIds.map(id => db().collection('markets').doc(id).get()));
  return buildTaskMarketSummariesFromDocs(docs);
}

export async function getTaskMarketSummariesForTask(taskId: string) {
  const snap = await db().collection('markets')
    .where('taskId', '==', taskId)
    .where('resolved', '==', false)
    .orderBy('targetDate', 'asc')
    .get();
  return buildTaskMarketSummariesFromDocs(snap.docs);
}

async function buildTaskMarketSummariesFromDocs(
  docs: Array<FirebaseFirestore.DocumentSnapshot | FirebaseFirestore.QueryDocumentSnapshot>,
) {
  const existingDocs = docs.filter(d => d.exists);
  const taskMarkets = existingDocs.map(d => d.data() as TaskMarketDoc);
  const [tradeCountMap, baselineConsensusMap] = await Promise.all([
    getTradeCountMap(existingDocs.map(d => d.id)),
    getBaselineConsensusMap(taskMarkets),
  ]);

  return existingDocs
    .map(d => {
      const m = d.data()!;
      const shares: [number, number] = m.shares || [0, 0];
      const key = `${m.metricId}:${m.targetDate}`;
      return {
        marketId: d.id,
        metricId: m.metricId,
        metricName: m.metricName,
        targetDate: m.targetDate,
        consensus: consensus(shares, m.liquidity, m.rangeMin, m.rangeMax),
        baselineConsensus: baselineConsensusMap.get(key) ?? null,
        rangeMin: m.rangeMin,
        rangeMax: m.rangeMax,
        liquidity: m.liquidity,
        tradeCount: tradeCountMap.get(d.id) || 0,
        resolved: m.resolved,
        actualValue: m.actualValue ?? null,
      };
    });
}
