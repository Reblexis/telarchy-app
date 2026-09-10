import { sql } from 'drizzle-orm';
import { CONTENT_UPDATED_AT, DATA_ROOM_SECTIONS } from '../content/data-room';
import { db } from '../db/client';
import { pageVisits, trafficDaily } from '../db/schema';
import { ttlCache } from '../lib/ttl-cache';
import { humanVisitFilter } from '../lib/visit-log';
import { type ActionsPage, buildActions, renderActionsText } from './actions';

/**
 * The data room as a document: the prose and the first page of the public
 * actions log, in one payload (spec: docs/data-room.md).
 *
 * Two callers share it, which is why it is a service rather than a route
 * body: `GET /api/data-room`, which the page renders, and the platform's own
 * floor brief, which hands an outside agent the latest page as a document.
 * Filtered reads go through services/actions.ts directly.
 */

/** How long one computed feed is served to everybody. The unfiltered first
 *  page is read by strangers arriving in bursts; half a minute of staleness
 *  on a log is invisible and a burst of computations is not. */
const CACHE_MS = 30_000;

export interface DataRoomFeed {
  schema: 2;
  generatedAt: string;
  doc: {
    updatedAt: string;
    sections: Array<{ id: string; title: string; markdown: string }>;
  };
  actions: ActionsPage;
}

/**
 * Roll yesterday and the days still in the visit log into `traffic_daily`.
 *
 * The visit log is purged at thirty days by the privacy policy, so without
 * this the published history would be a sliding window forever. The rollup
 * carries two counts and a date, nothing else, which is what makes keeping it
 * indefinitely compatible with deleting the rows it came from.
 *
 * It runs on read rather than on a schedule: a cron that stops is a history
 * with a hole in it, and this is cheap and idempotent.
 */
export async function rollUpTraffic(): Promise<void> {
  const rows = await db
    .select({
      day: sql<string>`to_char(${pageVisits.ts}, 'YYYY-MM-DD')`,
      visits: sql<number>`count(*)::int`,
      uniques: sql<number>`count(distinct ${pageVisits.ip})::int`,
    })
    .from(pageVisits)
    .where(humanVisitFilter())
    .groupBy(sql`1`);

  for (const r of rows) {
    await db
      .insert(trafficDaily)
      .values({ day: r.day, visits: Number(r.visits), uniques: Number(r.uniques) })
      // A day already rolled up can only grow while it is still in the log,
      // and once the rows are purged the stored count is the record.
      .onConflictDoUpdate({
        target: trafficDaily.day,
        set: {
          visits: sql`greatest(${trafficDaily.visits}, excluded.visits)`,
          uniques: sql`greatest(${trafficDaily.uniques}, excluded.uniques)`,
        },
      });
  }
}

const feedCache = ttlCache({
  ttlMs: CACHE_MS,
  keyOf: () => 'feed',
  load: () => computeDataRoomFeed(),
});

/** Drop the cached feed. Tests call it; nothing in production does. */
export function clearDataRoomCache(): void {
  feedCache.clear();
}

/** The room as a document, cached briefly. */
export function buildDataRoomFeed(): Promise<DataRoomFeed> {
  return feedCache.get();
}

async function computeDataRoomFeed(): Promise<DataRoomFeed> {
  // The rollup rides on this read as it always has: the visit log is purged
  // at thirty days, and the daily counts it leaves behind are the traffic
  // history whatever the room carries next.
  await rollUpTraffic();
  const actions = await buildActions({});
  return {
    schema: 2,
    generatedAt: actions.generatedAt,
    doc: {
      updatedAt: CONTENT_UPDATED_AT,
      sections: DATA_ROOM_SECTIONS.map(s => ({ id: s.id, title: s.title, markdown: s.markdown })),
    },
    actions,
  };
}

/** The document an outside agent gets in the platform's own floor brief:
 *  the prose, then the latest page of the log as lines. */
export function renderDataRoomDocument(feed: DataRoomFeed): string {
  return [
    `Telarchy's data room, telarchy.com/data-room. Words updated ${feed.doc.updatedAt}; rows generated ${feed.generatedAt}.`,
    ...feed.doc.sections.map(s => `## ${s.title}\n\n${s.markdown}`),
    renderActionsText(feed.actions),
  ].join('\n\n');
}
