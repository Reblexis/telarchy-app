/**
 * The floor's time axis: what the owner has committed to and by when, as one
 * list of intervals (docs/owner-on-the-floor.md, "What is planned").
 *
 * Every bar is derived here and nowhere else: the floor page and Otto read
 * GET /api/marketplace/:idOrSlug/timeline and compute nothing on the client,
 * so the four rules for what is on the axis (an approved proposal until its
 * earliest live horizon, a pending proposal until its deadline, an open
 * baseline book until it settles, an open plan item until its due) and the
 * four rules for what has left it (delivered, decided, settled or voided,
 * done) have exactly one home.
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { markets, metrics, plans, proposals } from '../db/schema';
import { periodStartInstant, settlesOn } from '../lib/date-utils';

export type TimelineKind = 'proposal' | 'decision' | 'book' | 'plan';

export interface TimelineItem {
  kind: TimelineKind;
  id: string;
  title: string;
  /** ISO instant, or null when the item can be worked on now. */
  start: string | null;
  /** ISO instant, or null when the item has no date (listed under the axis). */
  end: string | null;
  /** The address of the thing, or null for a plan item (its own words are the target). */
  href: string | null;
  /** Plan items only. Always false here: a done plan has left the axis. */
  done?: boolean;
  /** Plan items only: the owner's words, markdown. */
  description?: string | null;
}

/** Any Drizzle Postgres handle: production's node-postgres pool or the test
 *  harness's pglite, which is what lets the derivation be tested directly. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PgDatabase<any, any, any>;

const iso = (d: Date | string | null | undefined): string | null => {
  if (d == null) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** Soonest end first; items with no end after every dated one, in the order
 *  given (stable). Ties on end keep their order too, so a caller that feeds
 *  kinds in a fixed order gets a deterministic list. */
export function sortTimelineItems(items: TimelineItem[]): TimelineItem[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const ea = a.item.end == null ? Infinity : new Date(a.item.end).getTime();
      const eb = b.item.end == null ? Infinity : new Date(b.item.end).getTime();
      return ea - eb || a.i - b.i;
    })
    .map(x => x.item);
}

type MarketRow = typeof markets.$inferSelect;

/** The earliest settlement among an approved proposal's live approved-branch
 *  books, or null when every horizon has resolved (then there is no bar: the
 *  market has nothing left to say about the promise). */
export function earliestLiveHorizon(books: MarketRow[]): string | null {
  let best: number | null = null;
  for (const m of books) {
    if (m.resolved || !m.active || m.voided) continue;
    const t = new Date(settlesOn(m)).getTime();
    if (Number.isNaN(t)) continue;
    if (best == null || t < best) best = t;
  }
  return best == null ? null : new Date(best).toISOString();
}

export function bookTitle(m: MarketRow, currentMetricName: string | undefined): string {
  return `${currentMetricName ?? m.metricName} · ${m.targetDate}`;
}

export async function buildTimeline(db: Db, ws: { id: string; slug: string }, _now: Date): Promise<TimelineItem[]> {
  const [proposalRows, marketRows, metricRows, planRows] = await Promise.all([
    db
      .select({
        id: proposals.id,
        number: proposals.number,
        title: proposals.title,
        status: proposals.status,
        createdAt: proposals.createdAt,
        resolvedAt: proposals.resolvedAt,
        deliveredAt: proposals.deliveredAt,
        decideBy: proposals.decideBy,
      })
      .from(proposals)
      .where(eq(proposals.workspaceId, ws.id)),
    // Open books of every kind in one read: the proposals' pairs are grouped
    // by proposal below, the rest are baselines.
    db
      .select()
      .from(markets)
      .where(and(eq(markets.workspaceId, ws.id), eq(markets.resolved, false), eq(markets.active, true))),
    db.select({ id: metrics.id, name: metrics.name }).from(metrics).where(eq(metrics.workspaceId, ws.id)),
    db
      .select()
      .from(plans)
      .where(and(eq(plans.workspaceId, ws.id), isNull(plans.doneAt))),
  ]);

  const items: TimelineItem[] = [];
  const href = (p: { number: number | null; id: string }) => `/${ws.slug}/p/${p.number ?? p.id}`;

  const approvedBooksByProposal = new Map<string, MarketRow[]>();
  for (const m of marketRows) {
    if (!m.proposalId || m.branch !== 'approved') continue;
    const list = approvedBooksByProposal.get(m.proposalId) ?? [];
    list.push(m);
    approvedBooksByProposal.set(m.proposalId, list);
  }

  for (const p of proposalRows) {
    if (p.status === 'approved') {
      // Delivered means the interval is over; its history is the actions log.
      if (p.deliveredAt) continue;
      const end = earliestLiveHorizon(approvedBooksByProposal.get(p.id) ?? []);
      if (!end) continue;
      items.push({ kind: 'proposal', id: p.id, title: p.title, start: iso(p.resolvedAt), end, href: href(p) });
    } else if (p.status === 'pending') {
      items.push({
        kind: 'decision',
        id: p.id,
        title: p.title,
        start: iso(p.createdAt),
        end: iso(p.decideBy),
        href: href(p),
      });
    }
    // Declined (including lapsed), spam, withdrawn, removed: decided, off the axis.
  }

  const metricName = new Map(metricRows.map(m => [m.id, m.name]));
  for (const m of marketRows) {
    if (m.proposalId || m.voided) continue;
    items.push({
      kind: 'book',
      id: m.id,
      title: bookTitle(m, metricName.get(m.metricId)),
      start: periodStartInstant(m.targetDate).toISOString(),
      end: new Date(settlesOn(m)).toISOString(),
      href: `/${ws.slug}#market=${m.id}`,
    });
  }

  for (const pl of planRows) {
    items.push({
      kind: 'plan',
      id: pl.id,
      title: pl.title,
      description: pl.description ?? null,
      start: iso(pl.start),
      end: iso(pl.due),
      href: null,
      done: false,
    });
  }

  return sortTimelineItems(items);
}
