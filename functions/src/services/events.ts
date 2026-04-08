import { db } from '../db/client';
import { events } from '../db/schema';
import { eq, gt, lt, and, asc } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export type EventType = 'market:created' | 'market:resolved' | 'metric:updated' | 'trade:executed';

export async function emitEvent(
  type: EventType,
  data: Record<string, unknown>,
  workspaceId: string,
): Promise<void> {
  await db.insert(events).values({ id: randomUUID(), workspaceId, type, data, timestamp: new Date() });
}

export async function getEventsSince(
  since: string,
  workspaceId: string,
): Promise<Array<{ id: string; type: string; data: Record<string, unknown>; timestamp: string }>> {
  const sinceDate = new Date(since);
  const rows = await db.select().from(events)
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
  const deleted = await db.delete(events)
    .where(and(eq(events.workspaceId, workspaceId), lt(events.timestamp, cutoff)))
    .returning({ id: events.id });
  return deleted.length;
}
