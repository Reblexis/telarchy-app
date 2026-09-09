import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { metrics as metricsTable, ownerCalls } from '../db/schema';
import { AppError } from '../lib/errors';
import { getParticipantDisplayNames } from '../lib/participants';

/**
 * The owner's own call: what they expect a metric to read at a date,
 * published beside what the market says.
 *
 * Spec: docs/owner-on-the-floor.md, "The owner's own call". It is a record,
 * not a control: it moves no price, settles no market and pays nobody. What
 * it does is put the owner on the same hook as the people they are asking to
 * forecast.
 *
 * Append-only, which is the whole design. A second call on the same metric
 * and date is a second row and the floor prints the newest with how many
 * stand behind it; a forecast that can be quietly rewritten after the fact is
 * not a forecast.
 */

export interface OwnerCall {
  metricId: string;
  targetDate: string;
  value: number;
  at: string;
  /** The handle to print, or the participant id when there is no handle. */
  by: string;
  /** How many earlier calls stand behind this one on the same metric and date. */
  revisions: number;
}

export async function recordOwnerCall(
  workspaceId: string,
  call: { metricId: string; targetDate: string; value: number },
  byAgentId: string,
  now: Date = new Date(),
): Promise<void> {
  const targetDate = (call.targetDate ?? '').trim();
  if (!targetDate) throw new AppError('targetDate is required: a call without a date says nothing', 400);
  if (typeof call.value !== 'number' || !Number.isFinite(call.value)) {
    throw new AppError('value must be a number', 400);
  }
  const [metric] = await db
    .select({ id: metricsTable.id })
    .from(metricsTable)
    .where(and(eq(metricsTable.workspaceId, workspaceId), eq(metricsTable.id, call.metricId)));
  if (!metric) throw new AppError('No such metric on this floor', 404);

  await db.insert(ownerCalls).values({
    id: randomUUID(),
    workspaceId,
    metricId: call.metricId,
    targetDate,
    value: call.value,
    createdBy: byAgentId,
    createdAt: now,
  });
}

/** The newest call per metric and date, with the count of earlier ones. */
export async function latestOwnerCalls(workspaceId: string): Promise<OwnerCall[]> {
  const rows = await db
    .select()
    .from(ownerCalls)
    .where(eq(ownerCalls.workspaceId, workspaceId))
    .orderBy(asc(ownerCalls.createdAt));

  const byKey = new Map<string, { row: (typeof rows)[number]; count: number }>();
  for (const row of rows) {
    const key = `${row.metricId}:${row.targetDate}`;
    const seen = byKey.get(key);
    // Newest wins on the created instant, not on insertion order: a backfilled
    // row must not become the current call.
    if (!seen) byKey.set(key, { row, count: 1 });
    else byKey.set(key, { row: row.createdAt > seen.row.createdAt ? row : seen.row, count: seen.count + 1 });
  }

  const names = await getParticipantDisplayNames([...byKey.values()].map(v => v.row.createdBy));
  return [...byKey.values()].map(({ row, count }) => ({
    metricId: row.metricId,
    targetDate: row.targetDate,
    value: row.value,
    at: row.createdAt.toISOString(),
    by: names.get(row.createdBy) ?? row.createdBy,
    revisions: count - 1,
  }));
}
