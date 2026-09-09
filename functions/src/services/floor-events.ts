import { and, desc, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../db/client';
import { announcements, proposals } from '../db/schema';

/** Dated context for the data room (docs/data-room.md, "What moved it").
 * Announcements, decisions and any historical deliveries are events. Their
 * proximity to a metric reading does not establish causation. */

export type FloorEventKind = 'announcement' | 'approved' | 'declined' | 'delivered';

export interface FloorEvent {
  /** ISO instant. */
  at: string;
  kind: FloorEventKind;
  /** One line: the announcement's opening line, or the proposal's title. */
  label: string;
}

/** How many marks a chart can carry before they stop being readable. */
const MAX_EVENTS = 12;
/** The announcement's opening line, which is what the floor prints. */
const LABEL_MAX = 200;

function firstLine(body: string): string {
  const line = (body ?? '')
    .split('\n')
    .map(l => l.trim())
    .find(l => l.length > 0);
  return (line ?? '').slice(0, LABEL_MAX);
}

export async function buildFloorEvents(workspaceId: string, since?: Date): Promise<FloorEvent[]> {
  const [notes, decided] = await Promise.all([
    db
      .select({ body: announcements.body, at: announcements.publishedAt })
      .from(announcements)
      .where(
        since
          ? and(eq(announcements.workspaceId, workspaceId), gt(announcements.publishedAt, since))
          : eq(announcements.workspaceId, workspaceId),
      )
      .orderBy(desc(announcements.publishedAt))
      .limit(MAX_EVENTS),
    db
      .select({
        title: proposals.title,
        status: proposals.status,
        resolvedAt: proposals.resolvedAt,
        deliveryState: proposals.deliveryState,
        deliveredAt: proposals.deliveredAt,
      })
      .from(proposals)
      .where(
        and(
          eq(proposals.workspaceId, workspaceId),
          inArray(proposals.status, ['approved', 'declined']),
          isNotNull(proposals.resolvedAt),
        ),
      )
      .orderBy(desc(proposals.resolvedAt))
      .limit(MAX_EVENTS * 2),
  ]);

  const events: FloorEvent[] = [
    ...notes.map(n => ({ at: n.at.toISOString(), kind: 'announcement' as const, label: firstLine(n.body) })),
  ];
  for (const p of decided) {
    events.push({
      at: (p.resolvedAt as Date).toISOString(),
      kind: p.status === 'approved' ? 'approved' : 'declined',
      label: p.title,
    });
    // A delivery is its own dated event: the work landing is not the decision
    // to pay for it, and they are often weeks apart.
    if (p.deliveryState === 'delivered' && p.deliveredAt) {
      events.push({ at: p.deliveredAt.toISOString(), kind: 'delivered', label: p.title });
    }
  }

  return events
    .filter(e => !since || new Date(e.at) > since)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MAX_EVENTS);
}
