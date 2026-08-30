import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { metrics, updates } from '../db/schema';
import { getAffectedMetrics } from '../lib/metrics-engine';
import { emitEvent } from './events';
import { getAllMetrics, logSpecificMetrics } from './metrics';
import { platformStats } from './platform-stats';

/**
 * Telarchy's own reading of the numbers it computes about itself.
 *
 * The platform computes `weeklyActiveVerifiedTraders` and `revenue30dUsd`
 * (services/platform-stats.ts) and its public floor prices both on three
 * horizons, so both need a reading at least as often as the shortest horizon
 * moves. Until 2026-08-30 the push was a GitHub Actions cron that read the
 * numbers back over the public HTTP route and wrote them with an agent key.
 * GitHub's scheduler delivered that job roughly once a day and hours late
 * (a `40 23 * * *` cron fired at 01:36, 04:17, 04:59 and 07:03 UTC on four
 * consecutive days, and an hourly `40 * * * *` produced no run at all in the
 * four hours after it landed), which is how a metric documented as hourly
 * turned out to be daily. It now runs inside the app on the same Cloud
 * Scheduler that resolves markets, with no key, no round trip and no third
 * party between the number and the metric.
 *
 * A reading is written on every run, changed or not. `metric_logs` is the
 * "actual so far" line drawn on the floor and the series settlement fixes on
 * (last row at-or-before the boundary), so a number genuinely re-measured on
 * the hour is a measurement even when it comes back the same; skipping the
 * unchanged ones is what left "Telarchy revenue (USD)" with a single point on
 * its chart for five days and nothing under the cursor. What stays gated on an
 * actual change is the `updates` feed row and the `metric:updated` event, which
 * are notifications: nobody needs telling every hour that revenue is still $0.
 *
 * Configured by `SELF_SYNC_WORKSPACE_ID` (the workspace whose metrics are
 * Telarchy's own). Unset, this is a no-op, which is what a self-hosted
 * instance wants: its floor measures its owner's business, not ours.
 */

/**
 * Matched by name rather than id, and the list is explicit, because a rename
 * in the app must be a deliberate edit here too. `Weekly active traders` and
 * the dated `@1st October` form are historical names of the same number, kept
 * so an instance that still carries one keeps receiving readings.
 */
const TRADER_METRIC_NAMES = [
  'Weekly active traders',
  'Active traders',
  'Active traders @1st October',
  'Weekly active verified traders',
];

/**
 * The bare name plus a `(...)` tail is the whole list on purpose: a looser
 * "Revenue" would also match a workspace's own revenue metric and overwrite it
 * with Telarchy's number.
 */
const REVENUE_METRIC_NAMES = ['Telarchy revenue'];

export interface SelfSyncReading {
  metricId: string;
  metricName: string;
  value: number;
  /** False when the number came back the same; the reading is still recorded. */
  changed: boolean;
  source: 'weeklyActiveVerifiedTraders' | 'revenue30dUsd';
}

export interface SelfSyncResult {
  /** Set when nothing ran, naming why. */
  skipped?: string;
  workspaceId?: string;
  readings: SelfSyncReading[];
}

/** The workspace whose metrics are Telarchy's own numbers, or null. */
export function selfSyncWorkspaceId(): string | null {
  return process.env.SELF_SYNC_WORKSPACE_ID?.trim() || null;
}

/** Metrics whose name is one of `names`, or one of them plus a "(...)" tail. */
function matchMetrics<T extends { name: string }>(list: T[], names: string[]): T[] {
  return list.filter(m => names.includes(m.name) || names.some(base => m.name.startsWith(`${base} (`)));
}

/**
 * Record one measurement: the value, the log row, and - only when the number
 * moved - the feed entry and the event. Deliberately the same three writes the
 * PUT /api/metrics/:id route makes for a leaf value change, minus the
 * definition-edit machinery, which a measurement never touches.
 */
async function record(
  workspaceId: string,
  metric: { id: string; name: string; value: number },
  value: number,
  source: SelfSyncReading['source'],
  takenAt: Date,
): Promise<SelfSyncReading> {
  const changed = metric.value !== value;
  const note = `hourly self-sync ${takenAt.toISOString().slice(0, 16).replace('T', ' ')}Z (${source})`;

  await db.transaction(async tx => {
    await tx
      .update(metrics)
      .set({ value, updatedAt: takenAt })
      .where(and(eq(metrics.id, metric.id), eq(metrics.workspaceId, workspaceId)));

    if (changed) {
      await tx.insert(updates).values({
        id: randomUUID(),
        workspaceId,
        metricName: metric.name,
        oldValue: metric.value,
        newValue: value,
        description: note,
        timestamp: takenAt,
      });
    }
  });

  // Re-read after the write so composites above this metric log their new
  // result, not the one they had a moment ago.
  const allMetrics = await getAllMetrics(workspaceId);
  await logSpecificMetrics(getAffectedMetrics([metric.id], allMetrics), allMetrics, workspaceId);

  if (changed) {
    emitEvent(
      'metric:updated',
      { metricId: metric.id, metricName: metric.name, oldValue: metric.value, newValue: value },
      workspaceId,
    ).catch(e => console.error('emitEvent failed:', e));
  }

  return { metricId: metric.id, metricName: metric.name, value, changed, source };
}

export async function syncSelfMetrics(): Promise<SelfSyncResult> {
  const workspaceId = selfSyncWorkspaceId();
  if (!workspaceId) return { skipped: 'SELF_SYNC_WORKSPACE_ID is not set', readings: [] };

  const stats = await platformStats();
  const allMetrics = await getAllMetrics(workspaceId);
  if (allMetrics.length === 0) return { skipped: `workspace ${workspaceId} has no metrics`, readings: [] };

  const takenAt = new Date();
  const pushes: {
    metric: { id: string; name: string; value: number };
    value: number;
    source: SelfSyncReading['source'];
  }[] = [
    ...matchMetrics(allMetrics, TRADER_METRIC_NAMES).map(metric => ({
      metric,
      value: stats.weeklyActiveVerifiedTraders,
      source: 'weeklyActiveVerifiedTraders' as const,
    })),
    ...matchMetrics(allMetrics, REVENUE_METRIC_NAMES).map(metric => ({
      metric,
      value: stats.revenue30dUsd,
      source: 'revenue30dUsd' as const,
    })),
  ];

  const readings: SelfSyncReading[] = [];
  for (const { metric, value, source } of pushes) {
    if (!Number.isFinite(value)) {
      console.error(`[self-sync] ${source} is not a number, skipping ${metric.name}`);
      continue;
    }
    // One bad metric must not cost the others their reading.
    try {
      readings.push(await record(workspaceId, metric, value, source, takenAt));
    } catch (e) {
      console.error(`[self-sync] ${metric.name} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return { workspaceId, readings };
}
