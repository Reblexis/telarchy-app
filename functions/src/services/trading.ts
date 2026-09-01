import { randomUUID } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { agents, limitOrders, markets, positions, trades, workspaces } from '../db/schema';
import { betTowardsValue, consensus, directionSellProceeds, pHigher, sharesForBudget } from '../lib/amm';
import { periodEndInstant, resolutionInstant, settlesOn } from '../lib/date-utils';
import { AppError } from '../lib/errors';
import { emitPricesChanged } from '../lib/market-events';
import { restrictedToMembers } from '../lib/public-read';
import { fromUnits, sufficientBalance, toUnits } from '../lib/validation';
import { applyCredits } from './credits';

/**
 * The one place a trade happens.
 *
 * This used to live inline in POST /predictions/trade. It moved here so that
 * limit-order fills execute through the *identical* path as a hand-placed
 * trade: same position rows, same cap accounting, same trades table (which is
 * what `replayMarketTradePoints` reads, so fills appear on the chart like any
 * other step). A second, parallel "fill" implementation would have been the
 * obvious way to drift the two apart. Design: docs/limit-orders.md.
 */

/** The drizzle transaction handle, as handed to `db.transaction(cb)`. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type TradeMode =
  | { type: 'targetValue'; targetValue: number; maxBudget: number }
  | { type: 'sell'; direction: 0 | 1; dirLabel: 'higher' | 'lower'; sellShares: number }
  | { type: 'buy'; direction: 0 | 1; dirLabel: 'higher' | 'lower'; amount: number };

export interface TradeOutcome {
  tradeId: string;
  marketId: string;
  metricName: string;
  direction: 'higher' | 'lower';
  shares: number;
  /** Buys only. */
  cost: number;
  /** Sells only. */
  proceeds: number;
  isSell: boolean;
  /** Credits paid back for matched higher+lower pairs this trade created,
   *  at 1 credit a pair (docs/ui-conventions.md, "A trader holds ONE net
   *  side"). Zero unless the trader held the opposite side. */
  redeemed: number;
  probability: number;
  consensus: number | null;
  /** Consensus before this trade, so callers can see the interval crossed. */
  prevConsensus: number | null;
  /** The trader's balance as it stood, in credits. The dry-run path reports
   *  affordability from it; a real trade has already proven it sufficient. */
  balance: number;
}

/**
 * Execute one trade inside an open transaction. Locks the market and the
 * participant, enforces balance and the per-market position cap, writes the
 * market/agent/position/trade rows, and returns what moved.
 *
 * Throws AppError on every refusal; the caller's transaction rolls back.
 */
/**
 * What a participant with no credits does next, which depends on who is behind
 * it (owner ask, Viktor 2026-08-31: the message should say it made an agent
 * that "just doesn't have any credits to trade with" and describe "how to send
 * it money, depending on whether the human is signed up or not").
 *
 * The branch reads provenance already on the row and documented at its
 * definition site in schema.ts: `authUserId` means this human IS this
 * participant, `ownerUserId` (or `ownerAgentId`) means someone OWNS this bot
 * and can therefore pay it, and neither set means a standalone registration
 * with nobody to bill. Telling a person to go find a sponsor, or telling a
 * key-only bot to top up its own balance, is the wrong half of that.
 */
export function fundingHint(row: {
  id: string;
  authUserId: string | null;
  ownerUserId: string | null;
  ownerAgentId: string | null;
}): string {
  if (row.authUserId) {
    return (
      'This is your own balance to top up: what each free grant is worth is live at GET /api/earn, ' +
      'and any participant can pay you with POST /api/agents/transfer. See ' +
      'https://telarchy.com/api/guides/credits'
    );
  }
  const transfer = `POST /api/agents/transfer {"toAgent":"${row.id}","amount":<credits>}`;
  const owned = row.ownerUserId !== null || row.ownerAgentId !== null;
  const lead = owned
    ? 'Your owner funds you from their own balance with'
    : 'An API registration mints an identity, not a bankroll: whoever runs you funds you from their own balance with';
  return `${lead} ${transfer}, or a workspace admin can grant you credits. See https://telarchy.com/api/guides/credits`;
}

export async function executeTradeInTx(
  tx: Tx,
  opts: {
    workspaceId: string;
    agentId: string;
    marketId: string;
    mode: TradeMode;
    tradeId?: string;
    /**
     * Quote instead of refuse: skip the balance assertion and report what the
     * caller could not afford, rather than throwing. Only ever set on the
     * dry-run path, which rolls the whole transaction back, so a caller can
     * see how the market answers before anyone has funded it. It changes what
     * is CHECKED, never what is computed.
     */
    quoteOnly?: boolean;
  },
): Promise<TradeOutcome> {
  const { workspaceId, agentId, marketId, mode } = opts;
  const tradeId = opts.tradeId ?? randomUUID();

  // Redemption, not liquidation (owner ask 2026-08-30, after Manifold; see
  // docs/ui-conventions.md "A trader holds ONE net side"). A buy on the
  // side opposite a held position used to SELL that whole position first,
  // so a one-credit contrarian nudge liquidated everything at a spread
  // nobody asked to pay and moved the price by the size of the forced
  // sale. Instead the buy runs against the live book and any matched pair
  // the trader then holds is redeemed below, at the 1 credit it is
  // certainly worth. Nobody ends up holding both sides either way.

  const [market] = await tx
    .select()
    .from(markets)
    .where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)))
    .for('update');
  if (!market) throw new AppError('Market not found', 404, undefined, 'market_not_found');
  if (market.resolved) throw new AppError('Market is resolved', 400, undefined, 'market_resolved');
  if (market.voided) throw new AppError('Market is voided; positions were refunded', 400, undefined, 'market_voided');
  // Trading happens on a PUBLIC floor and nowhere else. A floor that is not
  // public is still being built: metrics, dates, books, invitations. The
  // reason is the prize season, which scores every workspace public AT
  // SETTLEMENT over every market that resolved inside its window, so a floor
  // traded in private and published at the end contributed a month of score
  // at once with nobody having watched any of it (bug hunt 2026-08-31, P1-9;
  // owner decision 2026-09-01). Trading only where everyone can see makes
  // that shape impossible rather than merely against the rules.
  //
  // Here rather than at the route, because this is the one door all three
  // callers share: the trade route, its dry-run quote, and the limit-order
  // sweep. A resting order on a floor that goes private does not fill.
  const [tradingWorkspace] = await tx
    .select({ visibility: workspaces.visibility })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (restrictedToMembers(tradingWorkspace?.visibility)) {
    throw new AppError(
      'This floor is not public yet, so nothing trades on it. Publish it to open trading.',
      400,
      undefined,
      'workspace_not_public',
    );
  }

  // The answer is fixed at the PERIOD END; the market is only due at period
  // end plus the metric's settlementLagMinutes, which can be 90 days. The
  // settling reading is public in between, so trading through that window is
  // buying a result you can already read. Both directions: a holder of a
  // losing position who sells at the last printed price takes out what
  // settlement would not have paid, and the pool covers it (owner decision
  // 2026-09-01, docs/market-integrity.md "Trading stops when the answer is
  // fixed"; bug hunt 2026-08-31, P0-5).
  if (periodEndInstant(market.targetDate).getTime() <= Date.now()) {
    throw new AppError(
      'Market is settling: its resolution date has passed and it pays on the reading for that date',
      400,
      { resolvesOn: resolutionInstant(market.targetDate), settlesOn: settlesOn(market) },
      'market_settling',
    );
  }

  if (!market.active && mode.type !== 'sell') {
    throw new AppError('Market is closed; only selling existing positions is allowed', 400, undefined, 'market_closed');
  }

  const shares = (market.shares as [number, number]) || [0, 0];
  const b = market.liquidity;
  if (b <= 0)
    throw new AppError(
      'This market has no liquidity yet, so there is nothing to trade against. Someone has to fund it first.',
      400,
    );
  const prevConsensus = consensus(shares, b, market.rangeMin, market.rangeMax) ?? null;

  const [agentRow] = await tx.select().from(agents).where(eq(agents.id, agentId)).for('update');
  if (!agentRow) throw new AppError('Agent not found', 404);
  const balanceUnits = agentRow.balance as number;

  let direction: 0 | 1;
  let amount: number;
  let cost = 0;
  let isSell = false;
  let dirLabel: 'higher' | 'lower';

  if (mode.type === 'targetValue') {
    if (mode.targetValue < market.rangeMin || mode.targetValue > market.rangeMax) {
      throw new AppError(`targetValue/value must be between ${market.rangeMin} and ${market.rangeMax}`, 400);
    }
    const r = betTowardsValue(shares, b, market.rangeMin, market.rangeMax, mode.targetValue, mode.maxBudget);
    direction = r.direction;
    amount = r.amount;
    cost = r.cost;
    dirLabel = direction === 1 ? 'higher' : 'lower';
  } else if (mode.type === 'sell') {
    direction = mode.direction;
    dirLabel = mode.dirLabel;
    amount = mode.sellShares;
    isSell = true;
  } else {
    direction = mode.direction;
    dirLabel = mode.dirLabel;
    const r = sharesForBudget(shares, direction, mode.amount, b);
    amount = r.amount;
    cost = r.cost;
  }

  if (amount <= 0) throw new AppError('Trade too small', 400, undefined, 'trade_too_small');

  const resolvedPosId = `${agentId}_${marketId}_${dirLabel}`;
  const [posRow] = await tx
    .select()
    .from(positions)
    .where(and(eq(positions.id, resolvedPosId), eq(positions.workspaceId, workspaceId)));

  let proceeds = 0;
  if (isSell) {
    const posShares = posRow?.shares ?? 0;
    if (posShares < amount)
      throw new AppError('Insufficient shares to sell', 400, { available: posShares }, 'insufficient_shares');
    proceeds = directionSellProceeds(shares, direction, amount, b);
    if (proceeds <= 0) throw new AppError('Trade too small', 400, undefined, 'trade_too_small');
  } else {
    if (cost > 0 && !sufficientBalance(balanceUnits, cost) && !opts.quoteOnly)
      throw new AppError(
        `Insufficient balance: this participant holds ${fromUnits(balanceUnits)} credits and this trade costs ${cost}. ${fundingHint(agentRow)}`,
        400,
        { balance: fromUnits(balanceUnits), cost },
        'insufficient_balance',
      );
  }

  const newShares: [number, number] = [shares[0], shares[1]];
  newShares[direction] += isSell ? -amount : amount;
  const newConsensus = consensus(newShares, b, market.rangeMin, market.rangeMax) ?? null;
  const newProbability = Math.round(pHigher(newShares, b) * 10000) / 10000;

  if (isSell) {
    await tx
      .update(markets)
      .set({
        shares: newShares,
        pool: sql`${markets.pool} - ${proceeds}`,
        tradedVolume: sql`${markets.tradedVolume} + ${proceeds}`,
      })
      .where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)));
    await applyCredits(tx, {
      agentId,
      workspaceId,
      deltaUnits: toUnits(proceeds),
      reason: 'trade',
      refType: 'market',
      refId: marketId,
      also: { earnedBetting: sql`${agents.earnedBetting} + ${proceeds}` },
    });
    await tx
      .update(positions)
      .set({ shares: sql`${positions.shares} - ${amount}` })
      .where(and(eq(positions.id, resolvedPosId), eq(positions.workspaceId, workspaceId)));
  } else {
    await tx
      .update(markets)
      .set({
        shares: newShares,
        pool: sql`${markets.pool} + ${cost}`,
        tradedVolume: sql`${markets.tradedVolume} + ${cost}`,
      })
      .where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)));
    await applyCredits(tx, {
      agentId,
      workspaceId,
      deltaUnits: -toUnits(cost),
      reason: 'trade',
      refType: 'market',
      refId: marketId,
      also: { spentBetting: sql`${agents.spentBetting} + ${cost}` },
    });

    if (posRow) {
      await tx
        .update(positions)
        .set({
          shares: sql`${positions.shares} + ${amount}`,
          totalCost: sql`${positions.totalCost} + ${cost}`,
        })
        .where(and(eq(positions.id, resolvedPosId), eq(positions.workspaceId, workspaceId)));
    } else {
      await tx.insert(positions).values({
        id: resolvedPosId,
        workspaceId,
        agentId,
        marketId,
        direction: dirLabel,
        shares: amount,
        totalCost: cost,
      });
    }

    if (cost > 0) {
      await tx
        .update(workspaces)
        .set({ tradedVolume: sql`${workspaces.tradedVolume} + ${cost}` })
        .where(eq(workspaces.id, workspaceId));
    }
  }

  await tx.insert(trades).values({
    id: tradeId,
    workspaceId,
    agentId,
    marketId,
    direction: dirLabel,
    shares: isSell ? -amount : amount,
    cost: isSell ? -proceeds : cost,
    // Explicit rather than defaulted: the only other writer of this table is
    // the redemption below, and the two must never be told apart by accident.
    kind: 'trade',
    createdAt: new Date(),
  });

  // A buy can leave the trader holding both sides; those matched pairs are
  // riskless, so they are cashed at par right here rather than left as
  // dead weight (docs/ui-conventions.md, "A trader holds ONE net side").
  // After the trade row above, so the replay reads the buy and then the
  // redemption in the order they happened. Selling never creates a pair.
  const redeemed = isSell ? 0 : await redeemMatchedPairs(tx, { workspaceId, agentId, marketId, book: newShares, b });
  // Drop the price caches so the floor and the chart show this trade on the
  // very next fetch. If the enclosing transaction rolls back this cost one
  // spurious cache miss, nothing more.
  emitPricesChanged(workspaceId, marketId);

  return {
    tradeId,
    marketId,
    metricName: market.metricName,
    direction: dirLabel,
    shares: amount,
    cost,
    proceeds,
    isSell,
    redeemed,
    probability: newProbability,
    consensus: newConsensus,
    prevConsensus,
    balance: fromUnits(balanceUnits),
  };
}

/**
 * How much of the cap this participant has consumed in this market: credits
 * already spent on positions, plus credits reserved by their open limit
 * orders. Reserved money counts because it is money that will become a
 * position without asking permission again.
 */
/**
 * Cash every matched higher+lower pair a trader holds, at the 1 credit a
 * pair is certainly worth (owner ask 2026-08-30, after Manifold; the rule
 * is docs/ui-conventions.md, "A trader holds ONE net side").
 *
 * A pair pays `p` on the higher share and `1 - p` on the lower one at any
 * settlement value (`resolutionPayouts`), so it is 1 credit of certainty
 * carrying no opinion. Redeeming it:
 *
 *  - moves the PRICE by nothing. An LMSR price is a function of q1 - q0,
 *    and this takes the same amount off each side.
 *  - costs the pool nothing in expectation: it pays 1 credit now and sheds
 *    exactly 1 credit of settlement liability (q0 and q1 each fall by the
 *    same amount, so the liability q0*(1-p) + q1*p falls by that amount).
 *
 * The two rows are marked `kind: 'redeem'`, which is what keeps them out of
 * every list a person reads: a redemption moves no price and has no
 * counterparty, so rendering it as a sell shows the trader an action they
 * never took (docs/ui-conventions.md, "A redemption is not a trade").
 *
 * The two ledger rows are what keeps the price REPLAY honest: it rebuilds
 * the book by walking `trades`, so a change to `markets.shares` that left
 * no rows would make the replay solve for a different opening and could
 * clamp to an empty book (docs/market-integrity.md I4 is the same lesson
 * on the liquidity side). The redeemed credits are split across the two
 * rows at the marginal price, which is what "sold at mid, no spread"
 * means and keeps each side's P&L readable. Volume is deliberately NOT
 * moved: nothing traded against the AMM here.
 */
async function redeemMatchedPairs(
  tx: Tx,
  args: {
    workspaceId: string;
    agentId: string;
    marketId: string;
    /** The book as this trade left it. */
    book: [number, number];
    b: number;
  },
): Promise<number> {
  const { workspaceId, agentId, marketId, book, b } = args;
  const rows = await tx
    .select()
    .from(positions)
    .where(
      and(eq(positions.workspaceId, workspaceId), eq(positions.marketId, marketId), eq(positions.agentId, agentId)),
    )
    .for('update');
  const higher = rows.find(r => r.direction === 'higher');
  const lower = rows.find(r => r.direction === 'lower');
  const pairs = Math.min((higher?.shares as number) ?? 0, (lower?.shares as number) ?? 0);
  if (!(pairs > 1e-9) || !higher || !lower) return 0;

  const p = pHigher(book, b);
  // The two rows sum to exactly `pairs`, whatever the rounding does to the
  // split: the trader is paid for pairs, not for two independent sells.
  const higherPart = Math.round(pairs * p * 1e6) / 1e6;
  const lowerPart = Math.round((pairs - higherPart) * 1e6) / 1e6;

  await tx
    .update(markets)
    .set({
      shares: [book[0] - pairs, book[1] - pairs] as [number, number],
      pool: sql`${markets.pool} - ${pairs}`,
    })
    .where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)));

  for (const row of [higher, lower]) {
    await tx
      .update(positions)
      .set({ shares: sql`${positions.shares} - ${pairs}` })
      .where(and(eq(positions.id, row.id), eq(positions.workspaceId, workspaceId)));
  }

  await applyCredits(tx, {
    agentId,
    workspaceId,
    deltaUnits: toUnits(pairs),
    reason: 'redeem',
    refType: 'market',
    refId: marketId,
    also: { earnedBetting: sql`${agents.earnedBetting} + ${pairs}` },
  });

  // ONE instant for both rows: the replay prices rows written at the same
  // instant as a single move, which is what stops the pair drawing a dip
  // the market never printed.
  const at = new Date();
  await tx.insert(trades).values([
    {
      id: randomUUID(),
      workspaceId,
      agentId,
      marketId,
      direction: 'higher',
      shares: -pairs,
      cost: -higherPart,
      kind: 'redeem',
      createdAt: at,
    },
    {
      id: randomUUID(),
      workspaceId,
      agentId,
      marketId,
      direction: 'lower',
      shares: -pairs,
      cost: -lowerPart,
      kind: 'redeem',
      createdAt: at,
    },
  ]);
  return pairs;
}

export interface FillOutcome {
  orderId: string;
  agentId: string;
  direction: 'higher' | 'lower';
  limitValue: number;
  cost: number;
  shares: number;
  consensus: number | null;
  /** True when the order's whole budget is now spent. */
  closed: boolean;
}

/** Whether the market price has reached or passed an order's limit. */
function isCrossed(direction: string, limitValue: number, current: number, eps: number): boolean {
  return direction === 'higher' ? current <= limitValue + eps : current >= limitValue - eps;
}

/**
 * Run the fill pass for one market, inside the transaction of the trade that
 * just moved its price.
 *
 * Each fill buys toward the order's own limit and no further, which is what
 * separates a limit order from a delayed market order: filling an order can
 * uncross it, and then the loop stops. An order that cannot fill right now
 * (no cap headroom left) is left resting rather than cancelled, and never
 * aborts the trade that triggered the pass: a stranger's order must not be
 * able to fail your trade.
 */
export async function fillLimitOrdersInTx(tx: Tx, workspaceId: string, marketId: string): Promise<FillOutcome[]> {
  const [market] = await tx
    .select()
    .from(markets)
    .where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)));
  if (!market || market.resolved || market.voided || !market.active || market.liquidity <= 0) return [];

  const open = await tx
    .select()
    .from(limitOrders)
    .where(
      and(eq(limitOrders.workspaceId, workspaceId), eq(limitOrders.marketId, marketId), eq(limitOrders.status, 'open')),
    )
    .for('update');
  if (open.length === 0) return [];

  const now = new Date();
  const live: typeof open = [];
  for (const order of open) {
    if (order.expiresAt && order.expiresAt <= now) {
      await closeLimitOrderInTx(tx, order, 'expired');
      continue;
    }
    live.push(order);
  }
  if (live.length === 0) return [];

  const eps = Math.max((market.rangeMax - market.rangeMin) * 1e-6, 1e-9);
  const fills: FillOutcome[] = [];
  // Money left in each order, tracked in memory so the loop sees its own fills.
  const remaining = new Map(live.map(o => [o.id, o.budgetCredits - o.filledCredits]));
  const blocked = new Set<string>();

  // One iteration per fill. The bound is a backstop against a pathological
  // rounding loop, not an expected limit; each pass either uncrosses an order
  // or exhausts its budget.
  for (let step = 0; step < 50; step++) {
    const [fresh] = await tx.select().from(markets).where(eq(markets.id, marketId));
    const current = consensus(
      (fresh!.shares as [number, number]) || [0, 0],
      fresh!.liquidity,
      fresh!.rangeMin,
      fresh!.rangeMax,
    );
    if (current === undefined) break;

    // The order the price passed furthest is the one it reached first.
    let next: (typeof live)[number] | null = null;
    let bestDepth = 0;
    for (const order of live) {
      if (blocked.has(order.id)) continue;
      if ((remaining.get(order.id) ?? 0) <= 0.01) continue;
      if (!isCrossed(order.direction, order.limitValue, current, eps)) continue;
      const depth = Math.abs(current - order.limitValue);
      if (!next || depth > bestDepth) {
        next = order;
        bestDepth = depth;
      }
    }
    if (!next) break;

    const budget = remaining.get(next.id) ?? 0;
    if (budget <= 0.01) {
      blocked.add(next.id);
      continue;
    }

    // The whole fill runs in a savepoint. If anything in it fails, only the
    // fill unwinds: the trade that triggered this pass, and every fill before
    // it, still stand. Someone else's resting order must never be able to
    // fail your trade.
    let filled: { cost: number; shares: number; consensus: number | null; closed: boolean } | null = null;
    try {
      await tx.transaction(async sp => {
        // Release the reservation so the shared trade path can debit it like
        // any other spend, then re-reserve whatever the fill did not use.
        await applyCredits(sp, {
          agentId: next!.agentId,
          workspaceId,
          deltaUnits: toUnits(budget),
          reason: 'limit_order_release',
          refType: 'market',
          refId: marketId,
        });

        const outcome = await executeTradeInTx(sp, {
          workspaceId,
          agentId: next!.agentId,
          marketId,
          mode: { type: 'targetValue', targetValue: next!.limitValue, maxBudget: budget },
        });

        if (outcome.direction !== next!.direction) {
          // Buying toward the limit would move the price the wrong way for
          // this order. Crossed implies the direction matches, so this is a
          // bug in the crossing test rather than a state to absorb silently.
          throw new AppError(`limit fill direction mismatch on order ${next!.id}`, 500);
        }

        const unused = budget - outcome.cost;
        if (unused > 0) {
          await applyCredits(sp, {
            agentId: next!.agentId,
            workspaceId,
            deltaUnits: -toUnits(unused),
            reason: 'limit_order_hold',
            refType: 'market',
            refId: marketId,
          });
        }

        const left = (remaining.get(next!.id) ?? 0) - outcome.cost;
        const closed = left <= 0.01;
        await sp
          .update(limitOrders)
          .set({
            filledCredits: sql`${limitOrders.filledCredits} + ${outcome.cost}`,
            status: closed ? 'filled' : 'open',
            updatedAt: new Date(),
          })
          .where(eq(limitOrders.id, next!.id));

        filled = { cost: outcome.cost, shares: outcome.shares, consensus: outcome.consensus, closed };
      });
    } catch (e) {
      // Nothing to undo: the savepoint took the reservation release with it.
      console.error('limit order fill skipped', { orderId: next.id, marketId, error: (e as Error).message });
      blocked.add(next.id);
      continue;
    }
    if (!filled) {
      blocked.add(next.id);
      continue;
    }
    const done = filled as { cost: number; shares: number; consensus: number | null; closed: boolean };

    remaining.set(next.id, (remaining.get(next.id) ?? 0) - done.cost);
    fills.push({
      orderId: next.id,
      agentId: next.agentId,
      direction: next.direction as 'higher' | 'lower',
      limitValue: next.limitValue,
      cost: done.cost,
      shares: done.shares,
      consensus: done.consensus,
      closed: done.closed,
    });
  }

  return fills;
}

/**
 * Close an order and refund its unfilled remainder. Used by cancel, expiry,
 * and by market resolution/voiding, where a resting order must not strand
 * credits in a market that can no longer trade.
 */
export async function closeLimitOrderInTx(
  tx: Tx,
  // workspaceId and marketId come off the order row rather than the caller,
  // so the ledger entry names the market whose reservation is being released
  // however the close was reached (cancel, expiry, resolution, void).
  order: {
    id: string;
    agentId: string;
    workspaceId: string;
    marketId: string;
    budgetCredits: number;
    filledCredits: number;
  },
  status: 'cancelled' | 'expired' | 'voided',
): Promise<number> {
  const refund = Math.max(0, order.budgetCredits - order.filledCredits);
  if (refund > 0) {
    await applyCredits(tx, {
      agentId: order.agentId,
      workspaceId: order.workspaceId,
      deltaUnits: toUnits(refund),
      reason: 'limit_order_release',
      refType: 'market',
      refId: order.marketId,
    });
  }
  await tx.update(limitOrders).set({ status, updatedAt: new Date() }).where(eq(limitOrders.id, order.id));
  return refund;
}

/** Refund and close every open order on a market (resolution, voiding). */
export async function releaseLimitOrdersForMarket(
  tx: Tx,
  marketId: string,
  status: 'cancelled' | 'voided' = 'voided',
): Promise<number> {
  const open = await tx
    .select()
    .from(limitOrders)
    .where(and(eq(limitOrders.marketId, marketId), eq(limitOrders.status, 'open')))
    .for('update');
  let total = 0;
  for (const order of open) total += await closeLimitOrderInTx(tx, order, status);
  return total;
}

/**
 * Fill any crossed resting limit orders across active markets (owner
 * report 2026-08-11: limit orders did not apply in real time). Orders
 * fill inside a triggering trade's transaction, but a price can also sit
 * past a limit with no fresh trade to sweep it, so this runs on a timer.
 * One transaction per market that has open orders; a failure on one
 * market never blocks the others. Returns the number of markets touched.
 */
export async function sweepLimitOrders(): Promise<{ marketsSwept: number; fills: number }> {
  const marketsWithOrders = await db
    .selectDistinct({ marketId: limitOrders.marketId, workspaceId: limitOrders.workspaceId })
    .from(limitOrders)
    .where(eq(limitOrders.status, 'open'));

  let fills = 0;
  let marketsSwept = 0;
  for (const { marketId, workspaceId } of marketsWithOrders) {
    try {
      const outcome = await db.transaction(async tx => fillLimitOrdersInTx(tx, workspaceId, marketId));
      if (outcome.length > 0) {
        fills += outcome.length;
        marketsSwept += 1;
      }
    } catch (e) {
      console.error(`sweepLimitOrders: market ${marketId} failed:`, e);
    }
  }
  return { marketsSwept, fills };
}
