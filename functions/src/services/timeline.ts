/**
 * "What is planned": the entries the owner of a floor typed by hand, as one
 * list (docs/data-room.md, "What is planned").
 *
 * Nothing here is derived from the tables: not the proposals, not the
 * decisions, not the books. An entry exists because the owner typed it, and
 * the list is the plans table of one floor and nothing else (rule 5 of the
 * doc: "The planned tab holds what the owner typed and nothing derived. A
 * computed bar on it is a divergence, whatever it is computed from"). The
 * order has one home so the room, the cockpit and an agent read the same
 * list: open entries by due ascending with the undated last, then the done
 * entries by doneAt descending.
 */

import { eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { plans } from '../db/schema';

export interface TimelineItem {
  id: string;
  title: string;
  /** The owner's words, markdown, or null. */
  description: string | null;
  /** ISO instant, or null when the entry begins at the left edge of whatever range is shown. */
  start: string | null;
  /** ISO instant, or null when the entry has no date (listed under the axis). */
  due: string | null;
  done: boolean;
  createdAt: string;
  editedAt: string | null;
  doneAt: string | null;
}

/** Any Drizzle Postgres handle: production's node-postgres pool or the test
 *  harness's pglite, which is what lets the list be tested directly. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PgDatabase<any, any, any>;

const iso = (d: Date | string | null | undefined): string | null => {
  if (d == null) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const time = (s: string | null): number => (s == null ? Number.NaN : new Date(s).getTime());

/**
 * Open entries first, by due ascending, the undated after every dated one;
 * then the done entries, most recently finished first. Ties keep the order
 * given (stable), so a caller that feeds rows in a fixed order gets a
 * deterministic list.
 */
export function sortTimelineItems(items: TimelineItem[]): TimelineItem[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      if (a.item.done !== b.item.done) return a.item.done ? 1 : -1;
      if (a.item.done) {
        const da = time(a.item.doneAt);
        const db = time(b.item.doneAt);
        const ka = Number.isNaN(da) ? -Infinity : da;
        const kb = Number.isNaN(db) ? -Infinity : db;
        return kb - ka || a.i - b.i;
      }
      const ea = a.item.due == null ? Infinity : time(a.item.due);
      const eb = b.item.due == null ? Infinity : time(b.item.due);
      return ea - eb || a.i - b.i;
    })
    .map(x => x.item);
}

export async function buildTimeline(db: Db, ws: { id: string; slug: string }, _now: Date): Promise<TimelineItem[]> {
  // The plans table only. Reading anything else here would put a computed
  // entry on a tab whose whole claim is that the owner typed every line.
  const rows = await db.select().from(plans).where(eq(plans.workspaceId, ws.id)).orderBy(plans.createdAt, plans.id);
  return sortTimelineItems(
    rows.map(pl => ({
      id: pl.id,
      title: pl.title,
      description: pl.description ?? null,
      start: iso(pl.start),
      due: iso(pl.due),
      done: pl.doneAt != null,
      createdAt: iso(pl.createdAt) ?? new Date(0).toISOString(),
      editedAt: iso(pl.editedAt),
      doneAt: iso(pl.doneAt),
    })),
  );
}
