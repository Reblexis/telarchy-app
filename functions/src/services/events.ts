import { randomUUID } from 'crypto';
import { and, asc, eq, gt, lt } from 'drizzle-orm';
import { db } from '../db/client';
import { events } from '../db/schema';

export type EventType =
  | 'market:created'
  | 'market:resolved'
  | 'market:closed'
  | 'metric:updated'
  | 'trade:executed'
  | 'proposal:created'
  | 'proposal:status_changed'
  /** A conditional-market respawn skipped a subsidy contributor who could
   *  not pay, so the generation shipped with less liquidity than the
   *  proposal record advertises. Emitted so an unpriceable market is a
   *  visible fact instead of a console line nobody reads. */
  | 'proposal:subsidy_skipped';

export async function emitEvent(type: EventType, data: Record<string, unknown>, workspaceId: string): Promise<void> {
  await db.insert(events).values({ id: randomUUID(), workspaceId, type, data, timestamp: new Date() });
}

export async function getEventsSince(
  since: string,
  workspaceId: string,
): Promise<Array<{ id: string; type: string; data: Record<string, unknown>; timestamp: string }>> {
  const sinceDate = new Date(since);
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.workspaceId, workspaceId), gt(events.timestamp, sinceDate)))
    .orderBy(asc(events.timestamp))
    .limit(500);

  return rows.map(r => ({
    id: r.id,
    type: r.type,
    data: r.data as Record<string, unknown>,
    timestamp: r.timestamp.toISOString(),
  }));
}

export async function cleanupOldEvents(workspaceId: string): Promise<number> {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const deleted = await db
    .delete(events)
    .where(and(eq(events.workspaceId, workspaceId), lt(events.timestamp, cutoff)))
    .returning({ id: events.id });
  return deleted.length;
}
