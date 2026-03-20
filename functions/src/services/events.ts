import { FieldValue } from 'firebase-admin/firestore';
import { wsCol } from '../lib/workspace';

export type EventType = 'market:created' | 'market:resolved' | 'metric:updated' | 'trade:executed';

export async function emitEvent(
  type: EventType,
  data: Record<string, unknown>,
  workspaceId = 'default',
): Promise<void> {
  await wsCol(workspaceId, 'events').add({
    type,
    data,
    timestamp: FieldValue.serverTimestamp(),
  });
}

export async function getEventsSince(
  since: string,
  workspaceId = 'default',
): Promise<Array<{ id: string; type: string; data: Record<string, unknown>; timestamp: string }>> {
  const sinceDate = new Date(since);
  const snapshot = await wsCol(workspaceId, 'events')
    .where('timestamp', '>', sinceDate)
    .orderBy('timestamp', 'asc')
    .limit(500)
    .get();

  return snapshot.docs.map(doc => {
    const d = doc.data();
    return {
      id: doc.id,
      type: d.type,
      data: d.data,
      timestamp: (() => {
        const ts = d.timestamp?.toDate?.()?.toISOString();
        if (!ts) console.error(`Event ${doc.id} has no valid timestamp`);
        return ts ?? new Date().toISOString();
      })(),
    };
  });
}

export async function cleanupOldEvents(workspaceId = 'default'): Promise<number> {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const snapshot = await wsCol(workspaceId, 'events')
    .where('timestamp', '<', cutoff)
    .limit(200)
    .get();

  if (snapshot.empty) return 0;

  const batch = wsCol(workspaceId, 'events').firestore.batch();
  snapshot.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
  return snapshot.size;
}
