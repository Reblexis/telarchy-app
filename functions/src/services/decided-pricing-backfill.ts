/**
 * One-off backfill of proposals.decidedPricing for proposals decided before
 * the record existed (docs/ui-conventions.md, "Top contractors"; owner
 * ruling 2026-09-04). For each such proposal, every branch market's price is
 * replayed to the instant of the decision: the last price at or before
 * resolvedAt, or the opening price when nothing had traded by then.
 *
 * An untraded book has no history to replay, so its "opening" is whatever
 * its shares say NOW; for the books re-anchored by hand on 2026-09-02 that
 * is the re-anchored price, not the one the decision was made on. The
 * caller passes those books' recorded previous state (`overrides`, from
 * notes/reanchor-2026-09-02-before.json) and it is used in place of the
 * live shares for any market that has never traded.
 *
 * Idempotent: a proposal that already carries a record is left alone.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/client';
import { type DecidedPair, markets, proposals } from '../db/schema';
import { consensus } from '../lib/amm';
import { marketPriceSeries, replayMarketTradePoints } from './predictions';

export interface BookOverride {
  shares: [number, number];
  liquidity: number;
}

export interface BackfillResult {
  proposalId: string;
  workspaceId: string;
  status: string;
  pricing: DecidedPair[];
}

/** The price a market carried at `at`: the last replayed point at or before
 *  it, else the opening price, else null when the book had no liquidity. */
export async function priceAt(
  market: typeof markets.$inferSelect,
  at: Date,
  override?: BookOverride,
): Promise<number | null> {
  if (override) {
    const points = await replayMarketTradePoints(market.id, market.workspaceId);
    if (points.length === 0) {
      return consensus(override.shares, override.liquidity, market.rangeMin, market.rangeMax) ?? null;
    }
  }
  const series = await marketPriceSeries(market.id, market.workspaceId);
  let last: number | null = null;
  for (const pt of series) {
    if (pt.at.getTime() > at.getTime()) break;
    last = pt.consensus;
  }
  // Nothing at or before the instant: the book's earliest known price is its
  // opening, which is what it carried until its first trade.
  return last ?? series[0]?.consensus ?? null;
}

export async function backfillDecidedPricing(opts: {
  overrides?: Map<string, BookOverride>;
  apply: boolean;
}): Promise<BackfillResult[]> {
  const rows = await db
    .select()
    .from(proposals)
    .where(and(inArray(proposals.status, ['approved', 'declined']), isNull(proposals.decidedPricing)));
  const out: BackfillResult[] = [];
  for (const p of rows) {
    if (!p.resolvedAt) continue;
    const books = await db
      .select()
      .from(markets)
      .where(and(eq(markets.workspaceId, p.workspaceId), eq(markets.proposalId, p.id)));
    const byKey = new Map<string, DecidedPair>();
    for (const m of books) {
      if (!m.branch) continue;
      const key = `${m.metricId}|${m.targetDate}`;
      const pair = byKey.get(key) ?? {
        metricId: m.metricId,
        targetDate: m.targetDate,
        approvedConsensus: null,
        declinedConsensus: null,
      };
      const c = await priceAt(m, p.resolvedAt, opts.overrides?.get(m.id));
      if (m.branch === 'approved') pair.approvedConsensus = c;
      else if (m.branch === 'declined') pair.declinedConsensus = c;
      byKey.set(key, pair);
    }
    const pricing = [...byKey.values()];
    out.push({ proposalId: p.id, workspaceId: p.workspaceId, status: p.status, pricing });
    if (opts.apply) {
      await db
        .update(proposals)
        .set({ decidedPricing: pricing })
        .where(and(eq(proposals.id, p.id), eq(proposals.workspaceId, p.workspaceId)));
    }
  }
  return out;
}
