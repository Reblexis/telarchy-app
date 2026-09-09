import { and, desc, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../db/client';
import { announcements, proposals } from '../db/schema';

/**
 * What moved it: the dated things the owner did, for the floor to draw
 * against the line they moved.
 *
 * Spec: docs/ui-conventions.md, "The price and the chart". The chart drew a
 * metric's history with nothing to explain it. A jump on a particular day had
 * a cause, the cause was already in the database with a date on it, and the
 * page said nothing, so every reader had to reconstruct it by memory or not
 * at all.
 *
 * An event is something the owner DID that a forecaster could not otherwise
 * see happen on a date: an announcement, a decision, a delivery. Posting a
 * proposal is not one - anyone can post one and it moves nothing until it is
 * decided.
 *
 * No number is attached to an event. What the metric did afterwards is on the
 * chart the marks sit on, and printing it beside the label would be the same
 * fact stated twice, the second time rounded.
 */

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
