/**
 * A floor's history as the tree of worlds it is (docs/ui-conventions.md, "A
 * floor's history"; the /api/help entry for GET
 * /api/marketplace/:idOrSlug/history is the contract).
 *
 * Every decision is a FORK: one option per world the market priced, the
 * world the owner picked marked taken, every price the pair recorded at the
 * decision. Every settled or voided baseline book is a SETTLE on the trunk:
 * the market's call when it settled, against the value it settled on. The
 * page draws what this hands it and computes nothing itself, so which world
 * was taken, which numbers are shown and what counts as one fork have
 * exactly one home.
 */

import { and, count, desc, eq, inArray, isNotNull, isNull, lt, min } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { type DecidedPair, markets, metrics, proposals } from '../db/schema';
import { consensus } from '../lib/amm';
import { resolutionInstant } from '../lib/date-utils';
import { getParticipantDisplayNames } from '../lib/participants';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PgDatabase<any, any, any>;

export type ForkVerdict = 'approved' | 'declined' | 'lapsed' | 'withdrawn' | 'chosen' | 'none' | 'open';

export interface HistoryOption {
  label: string;
  proposalId: string;
  taken: boolean;
  price: number | null;
}

export interface HistoryProposal {
  id: string;
  number: number | null;
  title: string;
  askUsd: number | null;
  proposedBy: string;
  status: string;
  declineReason: string | null;
  deliveredAt: string | null;
  decideBy: string | null;
  href: string | null;
}

export interface HistoryFork {
  kind: 'fork';
  at: string;
  verdict: ForkVerdict;
  title: string;
  proposals: HistoryProposal[];
  metric: { id: string; name: string; targetDate: string } | null;
  options: HistoryOption[];
}

export interface HistoryBook {
  marketId: string;
  metricId: string;
  metricName: string;
  targetDate: string;
  voided: boolean;
  value: number | null;
  call: number | null;
}

export interface HistorySettle {
  kind: 'settle';
  at: string;
  books: HistoryBook[];
}

export type HistoryEvent = HistoryFork | HistorySettle;

export interface FloorHistory {
  workspace: { slug: string; name: string };
  now: string;
  counts: { decided: number; settled: number; voided: number };
  since: string | null;
  open: HistoryFork[];
  events: HistoryEvent[];
  next: string | null;
}

/** Everything that left pending by a ruling, a lapse or a withdrawal. The
 *  deadline sweep writes 'lapsed' (services/proposals.ts); older rows carry
 *  'declined' with lapsedAt. Removed proposals are an admin taking a row off the board, not a
 *  decision, and are nowhere in the history. */
export const DECIDED_STATUSES = ['approved', 'declined', 'declined_spam', 'lapsed', 'withdrawn'] as const;

/** Proposals one proposer posted within this long of each other, with the
 *  same deadline, are one question with several answers. */
export const POSTED_TOGETHER_MS = 10_000;

export const DEFAULT_LIMIT = 60;
export const MAX_LIMIT = 200;

type ProposalRow = typeof proposals.$inferSelect;
type MarketRow = typeof markets.$inferSelect;

const iso = (d: Date | string | null | undefined): string | null => {
  if (d == null) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const ms = (d: Date | string | null | undefined): number => (d == null ? Number.NaN : new Date(d).getTime());

/** The instant the proposal left pending. resolvedAt is set on every exit;
 *  the others are a fallback for a row written before it was. */
function decidedAt(p: ProposalRow): number {
  for (const d of [p.resolvedAt, p.lapsedAt, p.closedAt, p.createdAt]) {
    const t = ms(d);
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

function verdictOf(p: ProposalRow): ForkVerdict {
  if (p.status === 'approved') return 'approved';
  if (p.status === 'withdrawn') return 'withdrawn';
  if (p.status === 'lapsed' || p.lapsedAt) return 'lapsed';
  return 'declined';
}

/**
 * Proposals posted together: same proposer, same deadline to the
 * millisecond, each posted within POSTED_TOGETHER_MS of the group's first,
 * and titles that share the question before the answer. Anything else is a
 * question of its own.
 */
export function groupPostedTogether(rows: ProposalRow[]): ProposalRow[][] {
  const sorted = [...rows].sort(
    (a, b) =>
      a.proposedBy.localeCompare(b.proposedBy) ||
      ms(a.decideBy) - ms(b.decideBy) ||
      ms(a.createdAt) - ms(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
  const groups: ProposalRow[][] = [];
  for (const p of sorted) {
    const g = groups[groups.length - 1];
    const first = g?.[0];
    const together =
      first &&
      first.proposedBy === p.proposedBy &&
      first.decideBy != null &&
      p.decideBy != null &&
      ms(first.decideBy) === ms(p.decideBy) &&
      ms(p.createdAt) - ms(first.createdAt) <= POSTED_TOGETHER_MS;
    if (together) g.push(p);
    else groups.push([p]);
  }
  // Posted together is not enough: the titles must share the question before
  // the answer, or an owner batch-posting unrelated proposals would read as
  // one question with several answers.
  return groups.flatMap(g => (g.length > 1 && !splitTitles(g.map(p => p.title)).shared ? g.map(p => [p]) : [g]));
}

/** The part of the titles every proposal in a group shares, cut back to the
 *  last separator inside it so the remainder of each is a whole answer
 *  ("Game 1, move 6: Turn left" and "...: Turn right" share
 *  "Game 1, move 6", not "Game 1, move 6: Turn"). */
export function splitTitles(titles: string[]): { title: string; labels: string[]; shared: boolean } {
  if (titles.length === 0) return { title: '', labels: [], shared: false };
  let prefix = titles[0];
  for (const t of titles.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < t.length && prefix[i] === t[i]) i++;
    prefix = prefix.slice(0, i);
  }
  let cut = -1;
  for (const sep of [':', ' - ', ' · ', ',']) cut = Math.max(cut, prefix.lastIndexOf(sep));
  if (cut < 0) cut = prefix.lastIndexOf(' ');
  if (cut <= 0) return { title: titles[0], labels: titles, shared: false };
  const shared = prefix.slice(0, cut);
  const title = shared.replace(/[\s:,·-]+$/, '');
  const labels = titles.map(t => t.slice(shared.length).replace(/^[\s:,·-]+/, '') || t);
  return title ? { title, labels, shared: true } : { title: titles[0], labels: titles, shared: false };
}

const settleOrder = (targetDate: string): number => {
  const t = ms(resolutionInstant(targetDate));
  return Number.isNaN(t) ? 0 : t;
};

/** A single proposal's pair: largest impact, ties to the date that settles
 *  last. Only pairs with both sides priced qualify. */
export function pickPair(pairs: DecidedPair[] | null | undefined): DecidedPair | null {
  let best: DecidedPair | null = null;
  for (const p of pairs ?? []) {
    if (p.approvedConsensus == null || p.declinedConsensus == null) continue;
    if (!best) {
      best = p;
      continue;
    }
    const dp = Math.abs(p.approvedConsensus - p.declinedConsensus);
    const db = Math.abs((best.approvedConsensus as number) - (best.declinedConsensus as number));
    if (dp > db || (dp === db && settleOrder(p.targetDate) > settleOrder(best.targetDate))) best = p;
  }
  return best;
}

/** A group's key: a (metric, date) every member priced its approved world
 *  on, the one where the answers differ most, ties to the date that settles
 *  last. */
export function pickGroupKey(
  members: Array<DecidedPair[] | null | undefined>,
): { metricId: string; targetDate: string; prices: number[] } | null {
  const maps = members.map(pairs => {
    const m = new Map<string, DecidedPair>();
    for (const p of pairs ?? []) if (p.approvedConsensus != null) m.set(`${p.metricId}|${p.targetDate}`, p);
    return m;
  });
  if (maps.length === 0) return null;
  let best: { metricId: string; targetDate: string; prices: number[]; spread: number } | null = null;
  for (const [key, first] of maps[0]) {
    if (!maps.every(m => m.has(key))) continue;
    const prices = maps.map(m => m.get(key)?.approvedConsensus as number);
    const spread = Math.max(...prices) - Math.min(...prices);
    if (
      !best ||
      spread > best.spread ||
      (spread === best.spread && settleOrder(first.targetDate) > settleOrder(best.targetDate))
    ) {
      best = { metricId: first.metricId, targetDate: first.targetDate, prices, spread };
    }
  }
  return best ? { metricId: best.metricId, targetDate: best.targetDate, prices: best.prices } : null;
}

interface ForkContext {
  slug: string;
  names: Map<string, string>;
  metricNames: Map<string, string>;
  /** Per proposal id, the pairs its numbers come from: the recorded pairs
   *  for a decided proposal, the books now for an open one. */
  pricing: Map<string, DecidedPair[] | null>;
}

const metricName = (ctx: ForkContext, id: string) => ctx.metricNames.get(id) ?? 'a metric since removed';

function proposalOf(ctx: ForkContext, p: ProposalRow): HistoryProposal {
  return {
    id: p.id,
    number: p.number ?? null,
    title: p.title,
    askUsd: p.askUsd ?? null,
    proposedBy: ctx.names.get(p.proposedBy) ?? p.proposedBy,
    status: p.status,
    declineReason: p.declineReason ?? null,
    deliveredAt: iso(p.deliveredAt),
    decideBy: iso(p.decideBy),
    href: p.number != null ? `/${ctx.slug}/p/${p.number}` : null,
  };
}

export function forkOf(ctx: ForkContext, group: ProposalRow[], open: boolean): HistoryFork {
  if (group.length === 1) {
    const [p] = group;
    const chosen = pickPair(ctx.pricing.get(p.id));
    const approvedTaken = !open && p.status === 'approved';
    return {
      kind: 'fork',
      at: new Date(open ? ms(p.decideBy ?? p.createdAt) : decidedAt(p)).toISOString(),
      verdict: open ? 'open' : verdictOf(p),
      title: p.title,
      proposals: [proposalOf(ctx, p)],
      metric: chosen
        ? { id: chosen.metricId, name: metricName(ctx, chosen.metricId), targetDate: chosen.targetDate }
        : null,
      options: [
        { label: 'if approved', proposalId: p.id, taken: approvedTaken, price: chosen?.approvedConsensus ?? null },
        {
          label: 'if declined',
          proposalId: p.id,
          taken: !open && !approvedTaken,
          price: chosen?.declinedConsensus ?? null,
        },
      ],
    };
  }
  const byNumber = [...group].sort((a, b) => (a.number ?? 0) - (b.number ?? 0) || a.id.localeCompare(b.id));
  const { title, labels } = splitTitles(byNumber.map(p => p.title));
  const key = pickGroupKey(byNumber.map(p => ctx.pricing.get(p.id)));
  const options = byNumber.map((p, i) => ({
    label: labels[i],
    proposalId: p.id,
    taken: !open && p.status === 'approved',
    price: key ? key.prices[i] : null,
  }));
  options.sort((a, b) => Number(b.taken) - Number(a.taken) || a.label.localeCompare(b.label));
  const at = open
    ? Math.max(...byNumber.map(p => ms(p.decideBy ?? p.createdAt)))
    : Math.max(...byNumber.map(decidedAt));
  return {
    kind: 'fork',
    at: new Date(at).toISOString(),
    verdict: open ? 'open' : options.some(o => o.taken) ? 'chosen' : 'none',
    title,
    proposals: byNumber.map(p => proposalOf(ctx, p)),
    metric: key ? { id: key.metricId, name: metricName(ctx, key.metricId), targetDate: key.targetDate } : null,
    options,
  };
}

const priceOf = (m: MarketRow): number | null =>
  consensus((m.shares as [number, number]) || [0, 0], m.liquidity, m.rangeMin, m.rangeMax) ?? null;

/** Live pairs for open proposals, from their open branch books, in one read. */
async function livePricing(db: Db, workspaceId: string, ids: string[]): Promise<Map<string, DecidedPair[]>> {
  const out = new Map<string, DecidedPair[]>();
  if (ids.length === 0) return out;
  const rows = await db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), inArray(markets.proposalId, ids), eq(markets.resolved, false)));
  const byKey = new Map<string, DecidedPair & { proposalId: string }>();
  for (const m of rows) {
    if (!m.branch || !m.proposalId) continue;
    const key = `${m.proposalId}|${m.metricId}|${m.targetDate}`;
    const pair = byKey.get(key) ?? {
      proposalId: m.proposalId,
      metricId: m.metricId,
      targetDate: m.targetDate,
      approvedConsensus: null,
      declinedConsensus: null,
    };
    if (m.branch === 'approved') pair.approvedConsensus = priceOf(m);
    else if (m.branch === 'declined') pair.declinedConsensus = priceOf(m);
    byKey.set(key, pair);
  }
  for (const { proposalId, ...pair } of byKey.values()) {
    out.set(proposalId, [...(out.get(proposalId) ?? []), pair]);
  }
  return out;
}

/** An event with the span of the raw instants behind it, for paging. */
interface Spanned {
  event: HistoryEvent;
  minAt: number;
  maxAt: number;
}

export async function buildFloorHistory(
  db: Db,
  ws: { id: string; slug: string; name: string },
  opts: { before?: Date | null; limit?: number; now?: Date } = {},
): Promise<FloorHistory> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const before = opts.before ?? null;

  const metricRows = await db
    .select({ id: metrics.id, name: metrics.name })
    .from(metrics)
    .where(eq(metrics.workspaceId, ws.id));
  const metricNames = new Map(metricRows.map(m => [m.id, m.name]));

  const decidedWhere = (extra?: ReturnType<typeof lt>) =>
    and(
      eq(proposals.workspaceId, ws.id),
      inArray(proposals.status, [...DECIDED_STATUSES]),
      isNotNull(proposals.resolvedAt),
      ...(extra ? [extra] : []),
    );
  const settledWhere = (extra?: ReturnType<typeof lt>) =>
    and(
      eq(markets.workspaceId, ws.id),
      isNull(markets.proposalId),
      eq(markets.resolved, true),
      isNotNull(markets.resolvedAt),
      ...(extra ? [extra] : []),
    );

  // Rows are fetched with headroom and the page is cut at a cluster boundary
  // strictly newer than the oldest row either read might have cut short, so
  // a fork or a square is never delivered in part. A floor whose newest
  // cluster alone outgrows the headroom reads again with more.
  let fetch = limit * 4 + 10;
  let clusters: Spanned[][] = [];
  let eligible: Spanned[][] = [];
  let truncated = false;
  let pRows: ProposalRow[] = [];
  let mRows: MarketRow[] = [];
  for (;;) {
    pRows = (await db
      .select()
      .from(proposals)
      .where(decidedWhere(before ? lt(proposals.resolvedAt, before) : undefined))
      .orderBy(desc(proposals.resolvedAt))
      .limit(fetch)) as ProposalRow[];
    mRows = (await db
      .select()
      .from(markets)
      .where(settledWhere(before ? lt(markets.resolvedAt, before) : undefined))
      .orderBy(desc(markets.resolvedAt))
      .limit(fetch)) as MarketRow[];
    const pCut = pRows.length === fetch ? decidedAt(pRows[pRows.length - 1]) : -Infinity;
    const mCut = mRows.length === fetch ? ms(mRows[mRows.length - 1].resolvedAt) : -Infinity;
    const cutoff = Math.max(pCut, mCut);
    truncated = cutoff > -Infinity;

    const names = await getParticipantDisplayNames(pRows.map(p => p.proposedBy));
    const ctx: ForkContext = {
      slug: ws.slug,
      names,
      metricNames,
      pricing: new Map(pRows.map(p => [p.id, (p.decidedPricing as DecidedPair[] | null) ?? null])),
    };
    const spanned: Spanned[] = [];
    for (const g of groupPostedTogether(pRows)) {
      const times = g.map(decidedAt);
      spanned.push({ event: forkOf(ctx, g, false), minAt: Math.min(...times), maxAt: Math.max(...times) });
    }
    const byMinute = new Map<number, MarketRow[]>();
    for (const m of mRows) {
      const minute = Math.floor(ms(m.resolvedAt) / 60_000) * 60_000;
      byMinute.set(minute, [...(byMinute.get(minute) ?? []), m]);
    }
    for (const [minute, rows] of byMinute) {
      const times = rows.map(r => ms(r.resolvedAt));
      spanned.push({
        event: {
          kind: 'settle',
          at: new Date(minute).toISOString(),
          books: rows
            .sort((a, b) => ms(b.resolvedAt) - ms(a.resolvedAt) || a.id.localeCompare(b.id))
            .map(r => ({
              marketId: r.id,
              metricId: r.metricId,
              metricName: metricNames.get(r.metricId) ?? r.metricName,
              targetDate: r.targetDate,
              voided: r.voided,
              value: r.voided ? null : (r.actualValue ?? null),
              call: priceOf(r),
            })),
        },
        minAt: Math.min(...times),
        maxAt: Math.max(...times),
      });
    }

    // Clusters: events whose instants overlap travel together, so the
    // cursor (the oldest instant on the page) can never fall inside one.
    spanned.sort((a, b) => b.maxAt - a.maxAt || b.minAt - a.minAt);
    clusters = [];
    let lo = Infinity;
    for (const s of spanned) {
      if (clusters.length > 0 && s.maxAt >= lo) {
        clusters[clusters.length - 1].push(s);
        lo = Math.min(lo, s.minAt);
      } else {
        clusters.push([s]);
        lo = s.minAt;
      }
    }
    eligible = clusters.filter(c => Math.min(...c.map(s => s.minAt)) > cutoff);
    if (eligible.length > 0 || !truncated || fetch >= 100_000) break;
    fetch *= 4;
  }

  const page: Spanned[] = [];
  let taken = 0;
  for (const c of eligible) {
    if (page.length >= limit) break;
    page.push(...c);
    taken++;
  }
  const more = truncated || taken < clusters.length;
  const oldest = page.length > 0 ? Math.min(...page.map(s => s.minAt)) : null;
  const next = more && oldest != null ? new Date(oldest).toISOString() : null;

  // The tip: what is being decided now, on the first page only.
  let open: HistoryFork[] = [];
  if (!before) {
    const pending = (await db
      .select()
      .from(proposals)
      .where(and(eq(proposals.workspaceId, ws.id), eq(proposals.status, 'pending')))) as ProposalRow[];
    if (pending.length > 0) {
      const live = await livePricing(
        db,
        ws.id,
        pending.map(p => p.id),
      );
      const ctx: ForkContext = {
        slug: ws.slug,
        names: await getParticipantDisplayNames(pending.map(p => p.proposedBy)),
        metricNames,
        pricing: new Map(pending.map(p => [p.id, live.get(p.id) ?? null])),
      };
      open = groupPostedTogether(pending)
        .map(g => forkOf(ctx, g, true))
        .sort((a, b) => ms(b.at) - ms(a.at));
    }
  }

  const [{ decided }] = await db.select({ decided: count() }).from(proposals).where(decidedWhere());
  const [{ settled }] = await db
    .select({ settled: count() })
    .from(markets)
    .where(and(settledWhere(), eq(markets.voided, false)));
  const [{ voided }] = await db
    .select({ voided: count() })
    .from(markets)
    .where(and(settledWhere(), eq(markets.voided, true)));
  const [{ firstDecision }] = await db
    .select({ firstDecision: min(proposals.resolvedAt) })
    .from(proposals)
    .where(decidedWhere());
  const [{ firstSettle }] = await db
    .select({ firstSettle: min(markets.resolvedAt) })
    .from(markets)
    .where(settledWhere());
  const firsts = [ms(firstDecision), ms(firstSettle)].filter(t => !Number.isNaN(t));

  return {
    workspace: { slug: ws.slug, name: ws.name },
    now: now.toISOString(),
    counts: { decided: Number(decided), settled: Number(settled), voided: Number(voided) },
    since: firsts.length > 0 ? new Date(Math.min(...firsts)).toISOString() : null,
    open,
    events: page.sort((a, b) => b.maxAt - a.maxAt || b.minAt - a.minAt).map(s => s.event),
    next,
  };
}
