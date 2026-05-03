import { db } from '../db/client';
import { metrics, markets, metricLogs, updates } from '../db/schema';
import { eq, and, asc, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import type { Metric, MetricLog, UpdateEntry } from '../types';
import { recalculateMetrics, calculateMetricDepths, evaluateFormulaAtTime } from '../lib/metrics-engine';
import { sampleTimePoints, getLeafDescendantNames } from '../lib/time-preference';
import { consensus as ammConsensus, AMM_DEFAULTS } from '../lib/amm';
import { toISOWeekString } from '../lib/date-utils';
import { emitEvent } from './events';
import { insertPendingMarkets, type PendingMarket } from './markets';

function enrichMetrics(rawMetrics: Metric[], consensusMap: Record<string, number> = {}, untradedLeaves: Set<string> = new Set()): Metric[] {
  const nameToFormula: Record<string, string> = {};
  rawMetrics.forEach(m => { nameToFormula[m.name] = m.formula || '0'; });

  if (untradedLeaves.size > 0) {
    rawMetrics.forEach(m => {
      const isLeaf = !m.formula || m.formula.trim() === '0';
      const missing = isLeaf
        ? (untradedLeaves.has(m.name) ? [m.name] : [])
        : getLeafDescendantNames(m.name, nameToFormula).filter(n => untradedLeaves.has(n));
      if (missing.length > 0) m.missingMarkets = missing;
    });
  }

  recalculateMetrics(rawMetrics, consensusMap);
  const depths = calculateMetricDepths(rawMetrics);
  rawMetrics.forEach(m => {
    if (depths[m.id] === undefined) console.error(`enrichMetrics: no depth for metric ${m.id} (${m.name})`);
    m.depth = depths[m.id] ?? 0;
  });

  const nameToTimeSeries: Record<string, Array<{ date: string; value: number }>> = {};
  const nameToInheritedHalfLife: Record<string, number> = {};
  const nameToFormulaLocal: Record<string, string> = {};
  rawMetrics.forEach(m => { nameToFormulaLocal[m.name] = m.formula || '0'; });

  for (const tpMetric of rawMetrics) {
    if (!tpMetric.timePreference?.enabled) continue;
    const halfLife = tpMetric.timePreference.halfLife;
    const timePoints = sampleTimePoints(halfLife, tpMetric.timePreference.density);

    const descendants = new Set<string>();
    const tpIsLeaf = !nameToFormulaLocal[tpMetric.name] || nameToFormulaLocal[tpMetric.name].trim() === '0';
    if (tpIsLeaf) {
      // Leaf with TP: the metric itself needs a time series
      descendants.add(tpMetric.name);
    } else {
      const queue = [tpMetric.name];
      const visited = new Set([tpMetric.name]);
      while (queue.length > 0) {
        const current = queue.shift()!;
        const refs = (nameToFormulaLocal[current] || '').match(/\{([^}]+)\}/g) ?? [];
        for (const ref of refs) {
          const name = ref.slice(1, -1).trim();
          if (!visited.has(name)) { visited.add(name); descendants.add(name); queue.push(name); }
        }
      }
    }

    const memo: Record<string, number> = {};
    for (const name of descendants) {
      if (nameToTimeSeries[name]) continue;
      const formula = nameToFormulaLocal[name] || '0';
      const isLeaf = formula.trim() === '0';
      const series: Array<{ date: string; value: number }> = [];

      for (const { date } of timePoints) {
        if (isLeaf) {
          const val = consensusMap[`${name}:${date}`];
          if (val !== undefined) series.push({ date, value: val });
        } else {
          series.push({ date, value: evaluateFormulaAtTime(formula, nameToFormulaLocal, consensusMap, date, memo) });
        }
      }

      if (series.length > 0) {
        nameToTimeSeries[name] = series;
        // Skip the TP metric itself, its own timePreference already drives the overlay.
        if (name !== tpMetric.name) nameToInheritedHalfLife[name] = halfLife;
      }
    }
  }

  rawMetrics.forEach(m => {
    if (nameToTimeSeries[m.name]) m.timeSeries = nameToTimeSeries[m.name];
    if (nameToInheritedHalfLife[m.name] !== undefined) m.inheritedHalfLife = nameToInheritedHalfLife[m.name];
  });
  rawMetrics.sort((a, b) => a.depth !== b.depth ? a.depth - b.depth : (a.order || 999) - (b.order || 999));
  return rawMetrics;
}

export async function buildConsensusMap(workspaceId: string): Promise<{ map: Record<string, number>; untradedLeaves: Set<string> }> {
  const openMarkets = await db.select().from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.resolved, false)));

  if (openMarkets.length === 0) return { map: {}, untradedLeaves: new Set() };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const map: Record<string, number> = {};
  const untradedLeaves = new Set<string>();

  for (const m of openMarkets) {
    if (m.proposalId) continue;
    if (!m.active) continue;
    if (!m.shares) continue;
    const shares = m.shares as [number, number];
    const c = ammConsensus(shares, m.liquidity ?? 0, m.rangeMin, m.rangeMax);
    if (c === undefined) {
      untradedLeaves.add(m.metricName);
      continue;
    }
    map[`${m.metricName}:${m.targetDate}`] = c;

    if (/^\d{4}-\d{2}-\d{2}$/.test(m.targetDate)) {
      const target = new Date(m.targetDate);
      const diffDays = (target.getTime() - today.getTime()) / 86400000;
      if (diffDays >= 7 && diffDays < 31) {
        const weekKey = `${m.metricName}:${toISOWeekString(target)}`;
        if (!map[weekKey]) map[weekKey] = c;
      }
    }
    if (/^\d{4}-\d{2}$/.test(m.targetDate)) {
      const [y, mo] = m.targetDate.split('-').map(Number);
      const target = new Date(y, mo - 1, 15);
      const diffYears = (target.getTime() - today.getTime()) / (365.25 * 86400000);
      if (diffYears >= 1 && diffYears < 2) {
        const yearKey = `${m.metricName}:${y}`;
        if (!map[yearKey]) map[yearKey] = c;
      }
    }
  }
  return { map, untradedLeaves };
}

export async function getAllMetrics(workspaceId: string): Promise<Metric[]> {
  const [rows, { map, untradedLeaves }] = await Promise.all([
    db.select().from(metrics).where(eq(metrics.workspaceId, workspaceId)).orderBy(asc(metrics.order), asc(metrics.createdAt)),
    buildConsensusMap(workspaceId),
  ]);
  return enrichMetrics(rows.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description || '',
    value: row.value,
    total: row.value,
    formula: row.formula || '0',
    order: row.order || 999,
    depth: 0,
    updatedAt: row.updatedAt?.toISOString(),
    timePreference: (row.timePreference as { enabled: boolean; halfLife: number } | null)?.enabled
      ? row.timePreference as { enabled: boolean; halfLife: number }
      : undefined,
    marketRangeMax: row.marketRangeMax ?? undefined,
  })), map, untradedLeaves);
}

export async function getMetricById(id: string, workspaceId: string): Promise<Metric | null> {
  const all = await getAllMetrics(workspaceId);
  return all.find(m => m.id === id) ?? null;
}

export async function ensureMarketsForTimePreference(
  tpMetricId: string,
  halfLife: number,
  workspaceId: string,
  density?: number,
): Promise<void> {
  const metricRows = await db.select().from(metrics).where(eq(metrics.workspaceId, workspaceId));
  const nameToFormula: Record<string, string> = {};
  const nameToId = new Map<string, string>();
  const idToName = new Map<string, string>();
  const idToRangeMax = new Map<string, number>();
  let tpMetricName = '';

  for (const row of metricRows) {
    nameToFormula[row.name] = row.formula || '0';
    nameToId.set(row.name, row.id);
    idToName.set(row.id, row.name);
    if (row.marketRangeMax != null) idToRangeMax.set(row.id, row.marketRangeMax);
    if (row.id === tpMetricId) tpMetricName = row.name;
  }

  if (!tpMetricName) return;

  let leafNames = getLeafDescendantNames(tpMetricName, nameToFormula);
  // If the TP metric is itself a leaf, create markets for it directly
  const tpIsLeaf = !nameToFormula[tpMetricName] || nameToFormula[tpMetricName].trim() === '0';
  if (tpIsLeaf) {
    leafNames = [tpMetricName];
  } else if (leafNames.length === 0) {
    return;
  }

  const timePoints = sampleTimePoints(halfLife, density);

  const openMarkets = await db.select({ id: markets.id, metricId: markets.metricId, targetDate: markets.targetDate, active: markets.active })
    .from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.resolved, false)));

  const existingMarkets = new Set(openMarkets.map(m => `${m.metricId}:${m.targetDate}`));

  // Reactivate any inactive markets that should be active
  const inactiveToReactivate = openMarkets.filter(m => m.active === false);
  const desiredKeys = new Set<string>();
  for (const leafName of leafNames) {
    const leafId = nameToId.get(leafName);
    if (!leafId) continue;
    for (const { date } of timePoints) {
      desiredKeys.add(`${leafId}:${date}`);
    }
  }
  for (const m of inactiveToReactivate) {
    if (desiredKeys.has(`${m.metricId}:${m.targetDate}`)) {
      await db.update(markets).set({ active: true })
        .where(and(eq(markets.id, m.id), eq(markets.workspaceId, workspaceId)));
    }
  }

  const pending: PendingMarket[] = [];

  for (const leafName of leafNames) {
    const leafId = nameToId.get(leafName);
    if (!leafId) continue;
    const rangeMax = idToRangeMax.get(leafId) ?? AMM_DEFAULTS.rangeMax;

    for (const { date } of timePoints) {
      const key = `${leafId}:${date}`;
      if (existingMarkets.has(key)) continue;
      existingMarkets.add(key);
      pending.push({ marketId: randomUUID(), metricId: leafId, metricName: leafName, targetDate: date, rangeMax });
    }
  }

  await insertPendingMarkets(pending, workspaceId);
  for (const p of pending) {
    await emitEvent('market:created', { marketId: p.marketId, metricName: p.metricName, targetDate: p.targetDate }, workspaceId);
  }
}

export async function respawnMarketsForTimePreference(
  tpMetricId: string,
  halfLife: number,
  workspaceId: string,
  density?: number,
): Promise<void> {
  await ensureMarketsForTimePreference(tpMetricId, halfLife, workspaceId, density);
}

export async function deleteMetric(id: string, workspaceId: string): Promise<void> {
  await db.delete(metrics).where(and(eq(metrics.id, id), eq(metrics.workspaceId, workspaceId)));
}

export async function getMetricLogs(metricId: string, workspaceId: string): Promise<MetricLog[]> {
  const rows = await db.select().from(metricLogs)
    .where(and(eq(metricLogs.workspaceId, workspaceId), eq(metricLogs.metricId, metricId)))
    .orderBy(asc(metricLogs.timestamp));
  return rows.map(r => ({
    metricId: r.metricId,
    metricName: r.metricName,
    value: r.value,
    outlook: r.outlook,
    timestamp: r.timestamp,
  }));
}

export async function getUpdates(limit: number | undefined, workspaceId: string): Promise<UpdateEntry[]> {
  const query = db.select().from(updates)
    .where(eq(updates.workspaceId, workspaceId))
    .orderBy(desc(updates.timestamp));
  const rows = limit ? await query.limit(limit) : await query;
  return rows.map(r => ({
    metricName: r.metricName,
    oldValue: r.oldValue,
    newValue: r.newValue,
    description: r.description,
    timestamp: r.timestamp,
  }));
}

export async function logSpecificMetrics(metricIds: string[], allMetrics: Metric[], workspaceId: string): Promise<void> {
  // We log two numbers per row: `value` (what the user types into the "Now:"
  // editor for leaves; 0 for composites, since the PUT route zeroes value on
  // non-leaf rows) and `outlook` (m.total, the computed formula result or the
  // value/future-consensus blend for leaves with Time Preference). They
  // coincide for leaves without TP and for fully-leaf composites with value=0;
  // they diverge meaningfully for leaves with TP enabled, where the Graph
  // modal renders both as two lines. When `total` is null (e.g. a TP-enabled
  // leaf whose markets have not spawned yet), fall back to `value` — the
  // history row should still exist; the chart can show the gap visually.
  const toInsert = metricIds
    .map(id => allMetrics.find(m => m.id === id))
    .filter((m): m is Metric => m !== undefined)
    .map(m => ({
      id: randomUUID(), workspaceId, metricId: m.id, metricName: m.name,
      value: m.value, outlook: m.total ?? m.value, timestamp: new Date(),
    }));

  if (toInsert.length > 0) {
    await db.insert(metricLogs).values(toInsert);
  }
}

export function getStatus(allMetrics: Metric[]) {
  return {
    // `formula` lets clients distinguish leaves (formula='0' or empty, value is
    // the user-authored "today" reading) from composites (formula references
    // other metrics, total is the formula result). Strategies that mean "today"
    // should use value for leaves and total for composites — using total on a
    // TP-enabled leaf reads the time-blended outlook, which already includes
    // the market's own forecast and creates a circular reference.
    metrics: allMetrics.map(m => ({
      id: m.id,
      name: m.name,
      value: m.value,
      total: m.total,
      formula: m.formula,
    })),
  };
}

/** Fetch all metric logs for a workspace in one query, grouped by metricId. */
export async function getAllMetricLogsGrouped(workspaceId: string): Promise<Record<string, Array<{ value: number; outlook: number | null; timestamp: Date }>>> {
  const rows = await db.select().from(metricLogs)
    .where(eq(metricLogs.workspaceId, workspaceId))
    .orderBy(asc(metricLogs.timestamp));
  const grouped: Record<string, Array<{ value: number; outlook: number | null; timestamp: Date }>> = {};
  for (const r of rows) {
    if (!grouped[r.metricId]) grouped[r.metricId] = [];
    grouped[r.metricId].push({ value: r.value, outlook: r.outlook, timestamp: r.timestamp });
  }
  return grouped;
}
