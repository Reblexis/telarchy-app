import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { metricLogs, metrics as metricsTable } from '../db/schema';

/**
 * The base rates: every weekly reading of every number the platform records
 * about itself.
 *
 * Spec: docs/data-room.md, "The base rates are every weekly reading". A
 * forecaster's first question is how far a number usually moves in the time
 * they are pricing, and the page answered it only as a shape on a chart. This
 * publishes the readings.
 *
 * A week with no reading is null, never the week before carried forward: a
 * week the sync did not run and a week the number did not move are different
 * facts, and telling them apart is the whole point of a base rate.
 */

const WEEKS = 8;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface BaseRates {
  /** The day each week ends, oldest first. */
  weeks: string[];
  metrics: Array<{ name: string; readings: Array<number | null> }>;
}

export async function buildBaseRates(now = new Date()): Promise<BaseRates> {
  // Week i covers (end - WEEK_MS, end]; the last one ends now.
  const ends = Array.from({ length: WEEKS }, (_, i) => new Date(now.getTime() - (WEEKS - 1 - i) * WEEK_MS));
  const weeks = ends.map(d => d.toISOString().slice(0, 10));
  const from = new Date(ends[0].getTime() - WEEK_MS);

  const workspaceId = process.env.SELF_SYNC_WORKSPACE_ID;
  if (!workspaceId) return { weeks, metrics: [] };

  const defined = await db
    .select({ id: metricsTable.id, name: metricsTable.name })
    .from(metricsTable)
    .where(eq(metricsTable.workspaceId, workspaceId))
    .orderBy(asc(metricsTable.order));
  if (defined.length === 0) return { weeks, metrics: [] };

  const logs = await db
    .select({ metricId: metricLogs.metricId, value: metricLogs.value, at: metricLogs.timestamp })
    .from(metricLogs)
    .where(
      and(
        eq(metricLogs.workspaceId, workspaceId),
        gt(metricLogs.timestamp, from),
        inArray(
          metricLogs.metricId,
          defined.map(m => m.id),
        ),
      ),
    )
    .orderBy(asc(metricLogs.timestamp));

  const rows: BaseRates['metrics'] = [];
  for (const m of defined) {
    // The metric's CURRENT name, never the one frozen into the log row: a
    // renamed metric is the same series.
    const own = logs.filter(l => l.metricId === m.id);
    if (own.length === 0) continue;
    const readings = ends.map(end => {
      const start = new Date(end.getTime() - WEEK_MS);
      const inWeek = own.filter(l => l.at > start && l.at <= end);
      return inWeek.length ? Number(inWeek[inWeek.length - 1].value) : null;
    });
    if (readings.every(v => v === null)) continue;
    rows.push({ name: m.name, readings });
  }
  return { weeks, metrics: rows };
}
