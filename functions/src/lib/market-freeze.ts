/**
 * What an owner is not allowed to destroy.
 *
 * Two rules, matched to what each path actually takes from people (owner
 * decision 2026-08-18; governing doc docs/market-integrity.md):
 *
 *   voiding a market, deleting a metric
 *     Refused whenever the market has been traded, season or not. Voiding
 *     takes money off participants who chose to put it there, and no
 *     capability makes that acceptable by accident.
 *
 *   deleting a workspace
 *     Refused only while the workspace sits inside a running prize season.
 *     Outside one it is allowed, because DELETE /workspaces/:id already voids
 *     and refunds every open position on the way out: nothing is taken, the
 *     venue just closes.
 *
 * These guards belong at the route layer and NOT inside `voidMarket`. Six of
 * that function's nine callers are the engine's own lifecycle (stale
 * conditional cleanup, a proposal being decided or removed, an unapproved
 * conditional reaching its settle instant), and freezing those would stop the
 * clock rather than protect anyone.
 */

import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { markets, prizeSeasons, trades } from '../db/schema';
import { AppError } from './errors';

/**
 * Refuse if anyone has traded this market.
 *
 * Counts trades rather than positions: a participant who bought and sold out
 * still has money that passed through, and the count is what the error
 * message needs anyway ("3 participants hold positions here" is a sentence an
 * operator can act on, "forbidden" is not).
 */
export async function assertMarketUntraded(marketId: string, workspaceId: string): Promise<void> {
  const [row] = await db
    .select({
      traders: sql<number>`count(distinct ${trades.agentId})::int`,
    })
    .from(trades)
    .where(and(eq(trades.workspaceId, workspaceId), eq(trades.marketId, marketId)));

  const traders = Number(row?.traders ?? 0);
  if (traders > 0) {
    throw new AppError(
      `This market has been traded by ${traders} participant${traders === 1 ? '' : 's'} and cannot be destroyed. ` +
        'Their positions settle when it resolves.',
      409,
      { marketId, traders },
    );
  }
}

/** The same rule across every open market on one metric (metric deletion). */
export async function assertMetricMarketsUntraded(metricId: string, workspaceId: string): Promise<void> {
  const open = await db
    .select({ id: markets.id })
    .from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.metricId, metricId), eq(markets.resolved, false)));
  for (const m of open) await assertMarketUntraded(m.id, workspaceId);
}

/**
 * Refuse while a prize season that scores this workspace is running.
 *
 * Reads `prize_seasons.workspaceIds`, which the season pins at start rather
 * than deriving from visibility, so flipping a workspace private mid-season
 * cannot slip it out of the freeze.
 */
export async function assertNotInRunningSeason(workspaceId: string): Promise<void> {
  const running = await db
    .select({ id: prizeSeasons.id, name: prizeSeasons.name, workspaceIds: prizeSeasons.workspaceIds })
    .from(prizeSeasons)
    .where(eq(prizeSeasons.status, 'running'));

  for (const season of running) {
    const ids = Array.isArray(season.workspaceIds) ? (season.workspaceIds as string[]) : [];
    if (ids.includes(workspaceId)) {
      throw new AppError(
        `"${season.name}" is running and scores this workspace, so it cannot be deleted until the season settles.`,
        409,
        { seasonId: season.id, seasonName: season.name },
      );
    }
  }
}
