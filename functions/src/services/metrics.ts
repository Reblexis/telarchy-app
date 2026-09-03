import { randomUUID } from 'crypto';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { db } from '../db/client';
import { markets, metricLogs, metrics, updates } from '../db/schema';
import { AMM_DEFAULTS, consensus as ammConsensus } from '../lib/amm';
import { periodEndInstant, toISOWeekString } from '../lib/date-utils';
import { calculateMetricDepths, evaluateFormulaAtTime, recalculateMetrics } from '../lib/metrics-engine';
import { desiredMarketDates, generatesMarkets, getLeafDescendantNames, sampleTimePoints } from '../lib/time-preference';
import type { Metric, MetricLog, TimePreference, UpdateEntry } from '../types';
import { emitEvent } from './events';
import { insertPendingMarkets, type PendingMarket } from './markets';

export function enrichMetrics(
  rawMetrics: Metric[],
  consensusMap: Record<string, number> = {},
  untradedKeys: Set<string> = new Set(),
): Metric[] {
  const nameToFormula: Record<string, string> = {};
  rawMetrics.forEach(m => {
    nameToFormula[m.name] = m.formula || '0';
  });

  if (untradedKeys.size > 0) {
    // A leaf only counts as "missing markets" when one of its CURVE-desired
    // dates is untraded; the curve is what feeds the weighted outlook. An
    // untraded custom-horizon or manual market must not null the outlook.
    const missingLeaves = new Set<string>();
    for (const tpMetric of rawMetrics) {
      const tp = tpMetric.timePreference;
      if (!tp?.enabled) continue;
      const curveDates = sampleTimePoints(tp.halfLife, tp.density).map(p => p.date);
      const tpIsLeaf = !nameToFormula[tpMetric.name] || nameToFormula[tpMetric.name].trim() === '0';
      const leaves = tpIsLeaf ? [tpMetric.name] : getLeafDescendantNames(tpMetric.name, nameToFormula);
      for (const leaf of leaves) {
        if (curveDates.some(d => untradedKeys.has(`${leaf}:${d}`))) missingLeaves.add(leaf);
      }
    }
    rawMetrics.forEach(m => {
      const isLeaf = !m.formula || m.formula.trim() === '0';
      const missing = isLeaf
        ? missingLeaves.has(m.name)
          ? [m.name]
          : []
        : getLeafDescendantNames(m.name, nameToFormula).filter(n => missingLeaves.has(n));
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
  rawMetrics.forEach(m => {
    nameToFormulaLocal[m.name] = m.formula || '0';
  });

  for (const tpMetric of rawMetrics) {
    if (!generatesMarkets(tpMetric.timePreference)) continue;
    const halfLife = tpMetric.timePreference.halfLife;
    const curveEnabled = tpMetric.timePreference.enabled;
    const timePoints = desiredMarketDates(tpMetric.timePreference);

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
          if (!visited.has(name)) {
            visited.add(name);
            descendants.add(name);
            queue.push(name);
          }
        }
      }
    }

    const memo: Record<string, number> = {};
    for (const name of descendants) {
      // Inheritance is structural: a descendant inherits its ancestor's TP regardless
      // of whether we can build a time series for it yet. Without this, a leaf whose
      // markets exist but haven't been traded would falsely show "enable Time Preference".
      // Skip the TP metric itself, its own timePreference already drives the overlay.
      // The decay overlay only makes sense for the curve, not custom horizons.
      if (name !== tpMetric.name && curveEnabled) nameToInheritedHalfLife[name] = halfLife;

      const formula = nameToFormulaLocal[name] || '0';
      const isLeaf = formula.trim() === '0';
      const series: Array<{ date: string; value: number }> = [];

      for (const date of timePoints) {
        if (isLeaf) {
          const val = consensusMap[`${name}:${date}`];
          if (val !== undefined) series.push({ date, value: val });
        } else {
          series.push({ date, value: evaluateFormulaAtTime(formula, nameToFormulaLocal, consensusMap, date, memo) });
        }
      }

      if (series.length > 0) {
        // Merge per date: a leaf can sit under one TP ancestor's curve while
        // also carrying its own custom horizons. First writer wins per date.
        const existing = nameToTimeSeries[name];
        if (!existing) {
          nameToTimeSeries[name] = series;
        } else {
          const seen = new Set(existing.map(p => p.date));
          for (const p of series) {
            if (!seen.has(p.date)) existing.push(p);
          }
          existing.sort((a, b) => periodEndInstant(a.date).getTime() - periodEndInstant(b.date).getTime());
        }
      }
    }
  }

  rawMetrics.forEach(m => {
    if (nameToTimeSeries[m.name]) m.timeSeries = nameToTimeSeries[m.name];
    if (nameToInheritedHalfLife[m.name] !== undefined) m.inheritedHalfLife = nameToInheritedHalfLife[m.name];
  });
  rawMetrics.sort((a, b) => (a.depth !== b.depth ? a.depth - b.depth : (a.order || 999) - (b.order || 999)));
  return rawMetrics;
}

export async function buildConsensusMap(
  workspaceId: string,
): Promise<{ map: Record<string, number>; untradedKeys: Set<string> }> {
  const openMarkets = await db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.resolved, false)));

  if (openMarkets.length === 0) return { map: {}, untradedKeys: new Set() };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const map: Record<string, number> = {};
  // "metricName:targetDate" keys of active markets with no trades yet. Keyed by
  // date so callers can scope "missing markets" to the dates that actually feed
  // the outlook, instead of flagging the whole metric.
  const untradedKeys = new Set<string>();

  for (const m of openMarkets) {
    if (m.proposalId) continue;
    if (!m.active) continue;
    if (!m.shares) continue;
    const shares = m.shares as [number, number];
    const c = ammConsensus(shares, m.liquidity ?? 0, m.rangeMin, m.rangeMax);
    if (c === undefined) {
      untradedKeys.add(`${m.metricName}:${m.targetDate}`);
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
  return { map, untradedKeys };
}

export async function getAllMetrics(workspaceId: string): Promise<Metric[]> {
  const [rows, { map, untradedKeys }] = await Promise.all([
    db
      .select()
      .from(metrics)
      .where(eq(metrics.workspaceId, workspaceId))
      .orderBy(asc(metrics.order), asc(metrics.createdAt)),
    buildConsensusMap(workspaceId),
  ]);
  return enrichMetrics(
    rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description || '',
      value: row.value,
      total: row.value,
      formula: row.formula || '0',
      order: row.order || 999,
      depth: 0,
      updatedAt: row.updatedAt?.toISOString(),
      timePreference: generatesMarkets(row.timePreference as TimePreference | null)
        ? (row.timePreference as TimePreference)
        : undefined,
      marketRangeMax: row.marketRangeMax ?? undefined,
      resolvesNaUntilMeasured: row.resolvesNaUntilMeasured ?? false,
      settlementLagMinutes: row.settlementLagMinutes ?? 0,
      liquidityCredits: row.liquidityCredits ?? null,
    })),
    map,
    untradedKeys,
  );
}

export async function getMetricById(id: string, workspaceId: string): Promise<Metric | null> {
  const all = await getAllMetrics(workspaceId);
  return all.find(m => m.id === id) ?? null;
}

export async function ensureMarketsForTimePreference(
  tpMetricId: string,
  tp: TimePreference,
  workspaceId: string,
): Promise<void> {
  const metricRows = await db.select().from(metrics).where(eq(metrics.workspaceId, workspaceId));
  const nameToFormula: Record<string, string> = {};
  const nameToId = new Map<string, string>();
  const idToName = new Map<string, string>();
  const idToRangeMax = new Map<string, number>();
  // The metric's reporting lag, stamped onto every market this path opens.
  // Without it a market opened through the Dates dialog settled at the bare
  // period end while the refresh cron's markets on the same metric settled a
  // lag later, so the dialog's markets fixed on the reading BEFORE the period
  // they were pricing (bug hunt 2026-08-31).
  const idToLag = new Map<string, number>();
  let tpMetricName = '';

  for (const row of metricRows) {
    nameToFormula[row.name] = row.formula || '0';
    nameToId.set(row.name, row.id);
    idToName.set(row.id, row.name);
    if (row.marketRangeMax != null) idToRangeMax.set(row.id, row.marketRangeMax);
    idToLag.set(row.id, row.settlementLagMinutes ?? 0);
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

  const targetDates = desiredMarketDates(tp);

  const openMarkets = await db
    .select({ id: markets.id, metricId: markets.metricId, targetDate: markets.targetDate, active: markets.active })
    .from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.resolved, false)));

  const existingMarkets = new Set(openMarkets.map(m => `${m.metricId}:${m.targetDate}`));

  // Reactivate any inactive markets that should be active
  const inactiveToReactivate = openMarkets.filter(m => m.active === false);
  const desiredKeys = new Set<string>();
  for (const leafName of leafNames) {
    const leafId = nameToId.get(leafName);
    if (!leafId) continue;
    for (const date of targetDates) {
      desiredKeys.add(`${leafId}:${date}`);
    }
  }
  for (const m of inactiveToReactivate) {
    if (desiredKeys.has(`${m.metricId}:${m.targetDate}`)) {
      await db
        .update(markets)
        .set({ active: true })
        .where(and(eq(markets.id, m.id), eq(markets.workspaceId, workspaceId)));
    }
  }

  const pending: PendingMarket[] = [];

  for (const leafName of leafNames) {
    const leafId = nameToId.get(leafName);
    if (!leafId) continue;
    const rangeMax = idToRangeMax.get(leafId) ?? AMM_DEFAULTS.rangeMax;

    for (const date of targetDates) {
      const key = `${leafId}:${date}`;
      if (existingMarkets.has(key)) continue;
      existingMarkets.add(key);
      pending.push({
        marketId: randomUUID(),
        metricId: leafId,
        metricName: leafName,
        targetDate: date,
        rangeMax,
        settlementLagMinutes: idToLag.get(leafId) ?? 0,
      });
    }
  }

  await insertPendingMarkets(pending, workspaceId);
  for (const p of pending) {
    await emitEvent(
      'market:created',
      { marketId: p.marketId, metricName: p.metricName, targetDate: p.targetDate },
      workspaceId,
    );
  }
}

export async function respawnMarketsForTimePreference(
  tpMetricId: string,
  tp: TimePreference,
  workspaceId: string,
): Promise<void> {
  await ensureMarketsForTimePreference(tpMetricId, tp, workspaceId);
}

export async function deleteMetric(id: string, workspaceId: string): Promise<void> {
  await db.delete(metrics).where(and(eq(metrics.id, id), eq(metrics.workspaceId, workspaceId)));
}

/**
 * The metric's value as of a given instant: the last logged update at-or-before
 * `instant` (outlook when present, i.e. the historical m.total; raw value for
 * pre-0018 rows). This is the settlement fixing for market resolution: a
 * market's actualValue is the metric reading at exactly resolvesOn, so the
 * resolve cron picks the same value whether it runs 12 seconds or 80 minutes
 * after the boundary. Updates that land after the boundary count toward the
 * NEXT fixing, never retroactively.
 *
 * Returns null when no log exists at-or-before the instant (metric predates
 * value logging, or was created after the boundary); callers fall back to the
 * live value and log the gap.
 */
/**
 * The reading a market settles on, WITH its timestamp: the last one at or
 * before the instant. `metricValueAsOf` is this minus the timestamp, kept
 * because most callers only want the number.
 *
 * The timestamp is what lets a settlement say how old the reading was
 * (docs/guides/sources.md, "Stale at the boundary is said out loud"), which a
 * trader would otherwise have to reconstruct from two logs.
 */
/**
 * The latest reading dated INSIDE [start, end], or null.
 *
 * This is the one a market settles on. `metricReadingAsOf` bounds only above,
 * so on a period with no reading of its own it returns the PREVIOUS period's
 * number, and settling on that is the shape the reading-triggered design
 * exists to remove (docs/market-integrity.md, "A market resolves on its
 * reading, not on a clock").
 */
export async function metricReadingInPeriod(
  metricId: string,
  start: Date,
  end: Date,
  workspaceId: string,
): Promise<{ value: number; at: Date; na: boolean } | null> {
  const [row] = await db
    .select()
    .from(metricLogs)
    .where(
      and(
        eq(metricLogs.workspaceId, workspaceId),
        eq(metricLogs.metricId, metricId),
        gte(metricLogs.timestamp, start),
        lte(metricLogs.timestamp, end),
      ),
    )
    .orderBy(desc(metricLogs.timestamp))
    .limit(1);
  if (!row) return null;
  // Same shape as metricReadingAsOf: outlook wins, because a computed
  // metric's `value` is forced to 0 and the real number rides on `outlook`,
  // and `na` is the owner saying the number does not exist for this period.
  return { value: row.outlook ?? row.value, at: row.timestamp as Date, na: row.na === true };
}

export async function metricReadingAsOf(
  metricId: string,
  instant: Date,
  workspaceId: string,
): Promise<{ value: number; at: Date; na: boolean } | null> {
  const [row] = await db
    .select()
    .from(metricLogs)
    .where(
      and(
        eq(metricLogs.workspaceId, workspaceId),
        eq(metricLogs.metricId, metricId),
        lte(metricLogs.timestamp, instant),
      ),
    )
    .orderBy(desc(metricLogs.timestamp))
    .limit(1);
  if (!row) return null;
  return { value: row.outlook ?? row.value, at: row.timestamp as Date, na: row.na === true };
}

export async function metricValueAsOf(metricId: string, instant: Date, workspaceId: string): Promise<number | null> {
  const [row] = await db
    .select()
    .from(metricLogs)
    .where(
      and(
        eq(metricLogs.workspaceId, workspaceId),
        eq(metricLogs.metricId, metricId),
        lte(metricLogs.timestamp, instant),
      ),
    )
    .orderBy(desc(metricLogs.timestamp))
    .limit(1);
  if (!row) return null;
  return row.outlook ?? row.value;
}

export async function getMetricLogs(metricId: string, workspaceId: string): Promise<MetricLog[]> {
  const rows = await db
    .select()
    .from(metricLogs)
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
  const query = db.select().from(updates).where(eq(updates.workspaceId, workspaceId)).orderBy(desc(updates.timestamp));
  const rows = limit ? await query.limit(limit) : await query;
  return rows.map(r => ({
    metricName: r.metricName,
    oldValue: r.oldValue,
    newValue: r.newValue,
    description: r.description,
    timestamp: r.timestamp,
  }));
}

export async function logSpecificMetrics(
  metricIds: string[],
  allMetrics: Metric[],
  workspaceId: string,
  /**
   * The moment the reading DESCRIBES, when it is not now. A September total
   * is typed on 3 October and belongs to September; without this the reading
   * lands in October and the September market settles on nothing
   * (owner ask 2026-08-31: "when a metric value is updated a past date should
   * be fillable"). Never in the future: the route refuses that.
   */
  asOf?: Date,
  /** True writes a reading that says the number does not exist for that
   *  moment. Its markets void as N/A rather than settling on a zero nobody
   *  measured (owner ask 2026-09-01). */
  na = false,
): Promise<void> {
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
      id: randomUUID(),
      workspaceId,
      metricId: m.id,
      metricName: m.name,
      value: m.value,
      outlook: m.total ?? m.value,
      na,
      timestamp: asOf ?? new Date(),
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
      // description lets clients show the metric's specified meaning without a
      // second fetch (e.g. the Markets tab tooltips the metric name with it).
      description: m.description,
      value: m.value,
      total: m.total,
      formula: m.formula,
    })),
  };
}

/** Fetch all metric logs for a workspace in one query, grouped by metricId. */
export async function getAllMetricLogsGrouped(
  workspaceId: string,
): Promise<Record<string, Array<{ value: number; outlook: number | null; timestamp: Date }>>> {
  const rows = await db
    .select()
    .from(metricLogs)
    .where(eq(metricLogs.workspaceId, workspaceId))
    .orderBy(asc(metricLogs.timestamp));
  const grouped: Record<string, Array<{ value: number; outlook: number | null; timestamp: Date }>> = {};
  for (const r of rows) {
    if (!grouped[r.metricId]) grouped[r.metricId] = [];
    grouped[r.metricId].push({ value: r.value, outlook: r.outlook, timestamp: r.timestamp });
  }
  return grouped;
}
