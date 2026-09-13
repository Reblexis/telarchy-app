import { randomUUID } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { agents, limitOrders, markets, positions, proposals, trades, workspaces } from '../db/schema';
import {
  betTowardsValue,
  consensus,
  directionSellProceeds,
  directionTradeCost,
  pHigher,
  sharesForBudget,
  sharesToBound,
} from '../lib/amm';
import { AppError } from '../lib/errors';
import { emitPricesChanged } from '../lib/market-events';
import { restrictedToMembers } from '../lib/public-read';
import { CREDIT_PRECISION, fromUnits, sufficientBalance, toUnits } from '../lib/validation';
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
  | {
      type: 'targetValue';
      targetValue: number;
      maxBudget: number;
      /** The side the caller named. With it the side never flips and the
       *  target bounds the trade (docs/guides/agent-api.md, "Guard the
       *  price"); without it the side comes from the call at landing. */
      direction?: 0 | 1;
    }
  | { type: 'sell'; direction: 0 | 1; dirLabel: 'higher' | 'lower'; sellShares: number }
  | { type: 'buy'; direction: 0 | 1; dirLabel: 'higher' | 'lower'; amount: number }
  | {
      /** Whole rounds of two opposing limit orders booked at once, at exactly
       *  what the rounds they replace cost (docs/limit-orders.md, "Opposing
       *  orders are matched, not traded back and forth"). No AMM pricing. */
      type: 'priced';
      direction: 0 | 1;
      dirLabel: 'higher' | 'lower';
      isSell: boolean;
      shares: number;
      /** Buy: credits paid. Sell: credits received. */
      credits: number;
    };

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
  /** The trade carried a bound: `limit`, or a targetValue with its direction. */
  guarded: boolean;
  /** A `limit` stopped the fill before the requested amount ran out. */
  limited: boolean;
  /** What was asked for: credits on a buy (amount or maxBudget), shares on a sell. */
  requested: number;
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
    /**
     * The price guard (docs/guides/agent-api.md, "Guard the price"): a call
     * on the book's scale the trade may not carry the book past, on the side
     * `boundSide` names. Evaluated here, after the market row lock, against
     * the book the trade actually meets.
     */
    limit?: number;
    /** The trade row's instant; rows sharing one replay as a single move. */
    at?: Date;
    /** The price the trade row records before and after, when the book this
     *  trade leaves is only a step inside a move that ends elsewhere. */
    recordConsensus?: number | null;
    /** The book whose price splits a redemption across its two rows. */
    splitBook?: [number, number];
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
  // Trading on both branches of a proposal closes at the decision or its
  // deadline (docs/guides/proposals.md, "The deadline, and the close"):
  // buys and sells alike, so the record the owner ruled on is the last
  // price anybody could trade, and nothing is spent on a book after it can
  // no longer change the decision. Positions settle at the date.
  if (market.proposalId) {
    const [owner] = await tx
      .select({ closedAt: proposals.closedAt, decideBy: proposals.decideBy })
      .from(proposals)
      .where(and(eq(proposals.id, market.proposalId), eq(proposals.workspaceId, workspaceId)));
    // The deadline closes the pair by itself, at the instant it passes: the
    // sweep that makes it durable runs on a timer, and a one-minute window
    // cannot wait for a timer (docs/guides/proposals.md).
    const pastDeadline = !!owner?.decideBy && owner.decideBy.getTime() <= Date.now();
    if (owner?.closedAt || pastDeadline) {
      throw new AppError(
        'Trading on this proposal closed with the decision; positions settle at the date',
        400,
        undefined,
        'proposal_closed',
      );
    }
  }
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

  // NO CLOCK GATE. A market past its period keeps trading, because until its
  // reading is filed nobody has the answer: the September market is a live
  // question until September's number exists. The answer's ARRIVAL is what
  // closes the book, by resolving the market, so there is no interval where
  // the answer is known and trading continues (owner decision 2026-09-01,
  // docs/market-integrity.md "A market resolves on its reading, not on a
  // clock"). The resolved and voided refusals above are the whole gate.

  if (!market.active && !(mode.type === 'sell' || (mode.type === 'priced' && mode.isSell))) {
    throw new AppError('Market is closed; only selling existing positions is allowed', 400, undefined, 'market_closed');
  }

  const shares = (market.shares as [number, number]) || [0, 0];
  const b = market.liquidity;
  if (b <= 0)
    throw new AppError(
      'This market has no liquidity yet, so there is nothing to trade against. Someone has to fund it first.',
      400,
      undefined,
      'market_unfunded',
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
    const r = betTowardsValue(
      shares,
      b,
      market.rangeMin,
      market.rangeMax,
      mode.targetValue,
      mode.maxBudget,
      mode.direction,
    );
    direction = r.direction;
    amount = r.amount;
    cost = r.cost;
    dirLabel = direction === 1 ? 'higher' : 'lower';
  } else if (mode.type === 'priced') {
    direction = mode.direction;
    dirLabel = mode.dirLabel;
    amount = mode.shares;
    isSell = mode.isSell;
    if (!isSell) cost = mode.credits;
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

  // The price guard. A trade that can partly fill is never refused: it fills
  // up to its bound and hands back the rest. The one refusal is nothing
  // tradable at all, price_moved, which spends nothing (owner ask 2026-09-12,
  // "dont block the actual trade"; docs/guides/agent-api.md, "Guard the
  // price").
  const guarded = opts.limit !== undefined || (mode.type === 'targetValue' && mode.direction !== undefined);
  const requested =
    mode.type === 'buy'
      ? mode.amount
      : mode.type === 'targetValue'
        ? mode.maxBudget
        : mode.type === 'priced'
          ? mode.isSell
            ? mode.shares
            : mode.credits
          : mode.sellShares;
  let limited = false;
  const priceMoved = (bound: number) =>
    new AppError(
      `The price moved: the call is ${prevConsensus} and this trade may not carry it past ${bound}, so nothing can fill. Nothing was spent.`,
      409,
      { consensus: prevConsensus, limit: bound },
      'price_moved',
    );
  if (guarded) {
    // A named side whose own target is already behind the call.
    if (mode.type === 'targetValue' && amount <= 0) throw priceMoved(opts.limit ?? mode.targetValue);
    if (opts.limit !== undefined) {
      const room = sharesToBound(shares, b, market.rangeMin, market.rangeMax, direction, isSell, opts.limit);
      if (amount > room) {
        // Rounded down, so the fill lands on the bound's side of it.
        const capped = Math.floor(room * CREDIT_PRECISION) / CREDIT_PRECISION;
        if (!(capped > 0)) throw priceMoved(opts.limit);
        amount = capped;
        if (!isSell) {
          cost = directionTradeCost(shares, direction, amount, b);
          if (!(cost > 0)) throw priceMoved(opts.limit);
        }
        limited = true;
      }
    }
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
    proceeds = mode.type === 'priced' ? mode.credits : directionSellProceeds(shares, direction, amount, b);
    if (proceeds <= 0) {
      if (limited && opts.limit !== undefined) throw priceMoved(opts.limit);
      throw new AppError('Trade too small', 400, undefined, 'trade_too_small');
    }
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
    // What the trade found and what it left: the profile's "moved the market
    // a -> b" (docs/ui-conventions.md, "What the platform records at trade
    // time"). Written here, in the same transaction, so it can never drift
    // from the book it describes.
    consensusBefore: opts.recordConsensus !== undefined ? opts.recordConsensus : prevConsensus,
    consensusAfter: opts.recordConsensus !== undefined ? opts.recordConsensus : newConsensus,
    createdAt: opts.at ?? new Date(),
  });

  // A buy can leave the trader holding both sides; those matched pairs are
  // riskless, so they are cashed at par right here rather than left as
  // dead weight (docs/ui-conventions.md, "A trader holds ONE net side").
  // After the trade row above, so the replay reads the buy and then the
  // redemption in the order they happened. Selling never creates a pair.
  const redeemed = isSell
    ? 0
    : await redeemMatchedPairs(tx, { workspaceId, agentId, marketId, book: newShares, b, priceAt: opts.splitBook });
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
    guarded,
    limited,
    requested,
  };
}

/**
 * What a guarded trade reports beside its fill (docs/guides/agent-api.md,
 * "Guard the price"): whether the limit stopped it, and the split of what was
 * asked for between filled and handed back. Nothing for an unguarded trade,
 * whose response is unchanged.
 */
export function guardFields(outcome: TradeOutcome): Record<string, unknown> {
  if (!outcome.guarded) return {};
  const rest = (used: number) => Math.max(0, Math.round((outcome.requested - used) * 1e9) / 1e9);
  return outcome.isSell
    ? { limited: outcome.limited, sharesSold: outcome.shares, sharesKept: rest(outcome.shares) }
    : { limited: outcome.limited, spent: outcome.cost, unspent: rest(outcome.cost) };
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
    /** The book whose price splits the credits; the trade's own by default. */
    priceAt?: [number, number];
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

  const p = pHigher(args.priceAt ?? book, b);
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
  side: 'buy' | 'sell';
  direction: 'higher' | 'lower';
  limitValue: number;
  /** Buy: credits spent. Sell: 0. */
  cost: number;
  /** Sell: credits received. Buy: 0. */
  proceeds: number;
  /** Shares bought or sold by this fill. */
  shares: number;
  consensus: number | null;
  /** True when the order is done: its budget or shares spent, or nothing left to sell. */
  closed: boolean;
}

/** Below this many shares a sell order has nothing left to sell. */
const SHARE_EPS = 1e-6;

type OrderRow = typeof limitOrders.$inferSelect;

/**
 * A buy of higher and a sell of lower both wait for the call to come DOWN to
 * their limit; a buy of lower and a sell of higher wait for it to come up.
 */
function waitsBelow(order: { side: string; direction: string }): boolean {
  return (order.side === 'sell') !== (order.direction === 'higher');
}

/** Whether the market price has reached or passed an order's limit. */
function isCrossed(
  order: { side: string; direction: string; limitValue: number },
  current: number,
  eps: number,
): boolean {
  return waitsBelow(order) ? current <= order.limitValue + eps : current >= order.limitValue - eps;
}

/** What an order still has to do: credits on a buy, shares on a sell. */
function leftIn(order: OrderRow): number {
  return order.side === 'sell'
    ? (order.shares ?? 0) - (order.filledShares ?? 0)
    : order.budgetCredits - order.filledCredits;
}

function isSpent(order: OrderRow, left: number): boolean {
  return order.side === 'sell' ? left <= SHARE_EPS : left <= 0.01;
}

interface FillStep {
  cost: number;
  proceeds: number;
  shares: number;
  consensus: number | null;
  closed: boolean;
  /** What the order still has to do after this step. */
  left: number;
}

/** One buy fill: spend the reservation toward the limit, re-reserve what it did not use. */
async function fillBuyInTx(
  sp: Tx,
  workspaceId: string,
  marketId: string,
  order: OrderRow,
  budget: number,
): Promise<FillStep> {
  // Release the reservation so the shared trade path can debit it like
  // any other spend, then re-reserve whatever the fill did not use.
  await applyCredits(sp, {
    agentId: order.agentId,
    workspaceId,
    deltaUnits: toUnits(budget),
    reason: 'limit_order_release',
    refType: 'market',
    refId: marketId,
  });

  const outcome = await executeTradeInTx(sp, {
    workspaceId,
    agentId: order.agentId,
    marketId,
    mode: { type: 'targetValue', targetValue: order.limitValue, maxBudget: budget },
  });

  if (outcome.direction !== order.direction) {
    // Buying toward the limit would move the price the wrong way for
    // this order. Crossed implies the direction matches, so this is a
    // bug in the crossing test rather than a state to absorb silently.
    throw new AppError(`limit fill direction mismatch on order ${order.id}`, 500);
  }

  const unused = budget - outcome.cost;
  if (unused > 0) {
    await applyCredits(sp, {
      agentId: order.agentId,
      workspaceId,
      deltaUnits: -toUnits(unused),
      reason: 'limit_order_hold',
      refType: 'market',
      refId: marketId,
    });
  }

  const left = budget - outcome.cost;
  const closed = left <= 0.01;
  await sp
    .update(limitOrders)
    .set({
      filledCredits: sql`${limitOrders.filledCredits} + ${outcome.cost}`,
      status: closed ? 'filled' : 'open',
      updatedAt: new Date(),
    })
    .where(eq(limitOrders.id, order.id));

  return { cost: outcome.cost, proceeds: 0, shares: outcome.shares, consensus: outcome.consensus, closed, left };
}

/**
 * One sell fill: sell toward the limit through the trade's own price bound,
 * never more than the order has left and never more than the position holds
 * right now (docs/limit-orders.md, "A sell reserves nothing, and never sells
 * more than is held"). A sell order with nothing left to sell closes as
 * cancelled, whether the position went before the price arrived or with it.
 */
async function fillSellInTx(
  sp: Tx,
  workspaceId: string,
  marketId: string,
  order: OrderRow,
  left: number,
): Promise<FillStep> {
  const [pos] = await sp
    .select({ shares: positions.shares })
    .from(positions)
    .where(
      and(eq(positions.id, `${order.agentId}_${marketId}_${order.direction}`), eq(positions.workspaceId, workspaceId)),
    );
  const held = (pos?.shares as number | undefined) ?? 0;
  const toSell = Math.floor(Math.min(left, held) * CREDIT_PRECISION) / CREDIT_PRECISION;

  if (!(toSell > SHARE_EPS)) {
    await sp
      .update(limitOrders)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(limitOrders.id, order.id));
    return { cost: 0, proceeds: 0, shares: 0, consensus: null, closed: true, left };
  }

  const outcome = await executeTradeInTx(sp, {
    workspaceId,
    agentId: order.agentId,
    marketId,
    mode: {
      type: 'sell',
      direction: order.direction === 'higher' ? 1 : 0,
      dirLabel: order.direction as 'higher' | 'lower',
      sellShares: toSell,
    },
    limit: order.limitValue,
  });

  const leftAfter = left - outcome.shares;
  const done = leftAfter <= SHARE_EPS;
  const gone = !done && held - outcome.shares <= SHARE_EPS;
  await sp
    .update(limitOrders)
    .set({
      filledShares: sql`coalesce(${limitOrders.filledShares}, 0) + ${outcome.shares}`,
      filledCredits: sql`${limitOrders.filledCredits} + ${outcome.proceeds}`,
      status: done ? 'filled' : gone ? 'cancelled' : 'open',
      updatedAt: new Date(),
    })
    .where(eq(limitOrders.id, order.id));

  return {
    cost: 0,
    proceeds: outcome.proceeds,
    shares: outcome.shares,
    consensus: outcome.consensus,
    closed: done || gone,
    left: leftAfter,
  };
}

/**
 * Run the fill pass for one market, inside the transaction of the trade that
 * just moved its price.
 *
 * Each fill trades toward the order's own limit and no further, which is what
 * separates a limit order from a delayed market order: filling an order can
 * uncross it, and then the loop stops. An order that cannot fill right now
 * is left resting rather than cancelled, and never aborts the trade that
 * triggered the pass: a stranger's order must not be able to fail your trade.
 */
export async function fillLimitOrdersInTx(tx: Tx, workspaceId: string, marketId: string): Promise<FillOutcome[]> {
  const [market] = await tx
    .select()
    .from(markets)
    .where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)))
    // The market before its orders, the order every other path takes: the
    // sweep locking orders first deadlocked against a decision voiding the
    // same book (docs/limit-orders.md, "The market is locked before its orders").
    .for('update');
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
  const live: OrderRow[] = [];
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
  // What each order still has to do, tracked in memory so the loop sees its own fills.
  const remaining = new Map(live.map(o => [o.id, leftIn(o)]));
  const blocked = new Set<string>();
  // The fills since the last break in the pattern, for spotting a repeated round.
  const history: RoundEntry[] = [];

  // One iteration per fill. The bound is a backstop against a pathological
  // rounding loop, not an expected limit; each pass either uncrosses an order
  // or exhausts it.
  for (let step = 0; step < 50; step++) {
    const [fresh] = await tx.select().from(markets).where(eq(markets.id, marketId));
    const book = (fresh!.shares as [number, number]) || [0, 0];
    const current = consensus(book, fresh!.liquidity, fresh!.rangeMin, fresh!.rangeMax);
    if (current === undefined) break;

    // The order the price passed furthest is the one it reached first.
    let next: OrderRow | null = null;
    let bestDepth = 0;
    for (const order of live) {
      if (blocked.has(order.id)) continue;
      if (isSpent(order, remaining.get(order.id) ?? 0)) continue;
      if (!isCrossed(order, current, eps)) continue;
      const depth = Math.abs(current - order.limitValue);
      if (!next || depth > bestDepth) {
        next = order;
        bestDepth = depth;
      }
    }
    if (!next) break;
    const order: OrderRow = next;
    const left = remaining.get(order.id) ?? 0;

    // A sell sitting on its own limit has no room to sell into. That is not a
    // failure, so it is passed over quietly rather than logged as one.
    if (
      order.side === 'sell' &&
      !(
        sharesToBound(
          book,
          fresh!.liquidity,
          fresh!.rangeMin,
          fresh!.rangeMax,
          order.direction === 'higher' ? 1 : 0,
          true,
          order.limitValue,
        ) > SHARE_EPS
      )
    ) {
      blocked.add(order.id);
      continue;
    }

    // The whole fill runs in a savepoint. If anything in it fails, only the
    // fill unwinds: the trade that triggered this pass, and every fill before
    // it, still stand. Someone else's resting order must never be able to
    // fail your trade.
    let result: FillStep | null = null;
    try {
      await tx.transaction(async sp => {
        result =
          order.side === 'sell'
            ? await fillSellInTx(sp, workspaceId, marketId, order, left)
            : await fillBuyInTx(sp, workspaceId, marketId, order, left);
      });
    } catch (e) {
      // Nothing to undo: the savepoint took the reservation release with it.
      console.error('limit order fill skipped', { orderId: order.id, marketId, error: (e as Error).message });
      blocked.add(order.id);
      continue;
    }
    const done = result as FillStep | null;
    if (!done) {
      blocked.add(order.id);
      continue;
    }

    remaining.set(order.id, done.left);
    if (done.closed) blocked.add(order.id);
    if (done.shares > 0) {
      fills.push({
        orderId: order.id,
        agentId: order.agentId,
        side: order.side === 'sell' ? 'sell' : 'buy',
        direction: order.direction as 'higher' | 'lower',
        limitValue: order.limitValue,
        cost: done.cost,
        proceeds: done.proceeds,
        shares: done.shares,
        consensus: done.consensus,
        closed: done.closed,
      });
      const [after] = await tx.select({ shares: markets.shares }).from(markets).where(eq(markets.id, marketId));
      const afterBook = (after!.shares as [number, number]) || [0, 0];
      history.push({
        orderId: order.id,
        shares: done.shares,
        credits: order.side === 'sell' ? done.proceeds : done.cost,
        diffAfter: afterBook[1] - afterBook[0],
      });
    } else {
      history.length = 0;
    }

    // Two opposing orders that have just repeated an identical round will
    // repeat it until one runs out: book those rounds at once instead of
    // walking them (docs/limit-orders.md, "Opposing orders are matched, not
    // traded back and forth").
    const round = repeatedRound(history, fresh!.liquidity);
    if (round) {
      history.length = 0;
      const first = live.find(o => o.id === round[0].orderId)!;
      const second = live.find(o => o.id === round[1].orderId)!;
      const rounds = await affordableRounds(tx, workspaceId, marketId, [first, second], round, remaining);
      if (rounds >= 1) {
        const [now] = await tx.select().from(markets).where(eq(markets.id, marketId));
        const bookNow = (now!.shares as [number, number]) || [0, 0];
        const priceNow = consensus(bookNow, now!.liquidity, now!.rangeMin, now!.rangeMax) ?? null;
        const at = new Date();
        // Buys before sells, so a sell never meets a position its partner has not yet bought into.
        const pairs = [
          [first, round[0]],
          [second, round[1]],
        ] as const;
        const ordered = [...pairs].sort((a, b) => (a[0].side === 'sell' ? 1 : 0) - (b[0].side === 'sell' ? 1 : 0));
        const booked: Array<[OrderRow, FillStep]> = [];
        try {
          await tx.transaction(async sp => {
            for (const [o, entry] of ordered) {
              booked.push([
                o,
                await fillRoundsInTx(
                  sp,
                  workspaceId,
                  marketId,
                  o,
                  entry,
                  rounds,
                  at,
                  priceNow,
                  bookNow,
                  remaining.get(o.id) ?? 0,
                ),
              ]);
            }
          });
        } catch (e) {
          booked.length = 0;
          console.error('limit order rounds skipped', { marketId, error: (e as Error).message });
        }
        for (const [o, step] of booked) {
          remaining.set(o.id, step.left);
          fills.push({
            orderId: o.id,
            agentId: o.agentId,
            side: o.side === 'sell' ? 'sell' : 'buy',
            direction: o.direction as 'higher' | 'lower',
            limitValue: o.limitValue,
            cost: step.cost,
            proceeds: step.proceeds,
            shares: step.shares,
            consensus: step.consensus,
            closed: false,
          });
        }
      }
    }
  }

  return fills;
}

/** One fill the pass made: which order, how much, and where the book stood after it. */
interface RoundEntry {
  orderId: string;
  shares: number;
  /** Buy: credits paid. Sell: credits received. */
  credits: number;
  /** q_higher - q_lower after the fill: the price, in the book's own terms. */
  diffAfter: number;
}

/**
 * The last two fills, when they repeat the two before them exactly: the same
 * two orders, the same shares and credits, and the price back where it stood.
 * The pass picks deterministically from that state, so every further round is
 * the same round until an order can no longer afford one.
 */
function repeatedRound(history: RoundEntry[], b: number): [RoundEntry, RoundEntry] | null {
  if (history.length < 4) return null;
  const [a1, b1, a2, b2] = history.slice(-4);
  const same = (x: number, y: number) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x));
  if (a1.orderId !== a2.orderId || b1.orderId !== b2.orderId || a2.orderId === b2.orderId) return null;
  if (!same(a1.shares, a2.shares) || !same(b1.shares, b2.shares)) return null;
  if (!same(a1.credits, a2.credits) || !same(b1.credits, b2.credits)) return null;
  if (Math.abs(b1.diffAfter - b2.diffAfter) > 1e-9 * Math.max(1, b)) return null;
  return [a2, b2];
}

/**
 * How many more whole rounds both orders can make, one fewer than the most,
 * so the rounds the pass then walks are the last ones, and a boundary decided
 * by rounding is walked rather than booked.
 */
async function affordableRounds(
  tx: Tx,
  workspaceId: string,
  marketId: string,
  orders: [OrderRow, OrderRow],
  round: [RoundEntry, RoundEntry],
  remaining: Map<string, number>,
): Promise<number> {
  let most = Number.POSITIVE_INFINITY;
  for (const i of [0, 1] as const) {
    const o = orders[i];
    const entry = round[i];
    const partner = orders[1 - i];
    const left = remaining.get(o.id) ?? 0;
    if (!(entry.shares > 0)) return 0;
    if (o.side === 'sell') {
      most = Math.min(most, Math.floor((left - SHARE_EPS) / entry.shares));
      // What the position loses per round: this sell, less what the same
      // participant's partner buy puts back on the same side.
      const refill =
        partner.side === 'buy' && partner.agentId === o.agentId && partner.direction === o.direction
          ? round[1 - i].shares
          : 0;
      const drain = entry.shares - refill;
      if (drain > 1e-12) {
        const [pos] = await tx
          .select({ shares: positions.shares })
          .from(positions)
          .where(
            and(eq(positions.id, `${o.agentId}_${marketId}_${o.direction}`), eq(positions.workspaceId, workspaceId)),
          );
        const held = (pos?.shares as number | undefined) ?? 0;
        most = Math.min(most, Math.floor((held - SHARE_EPS) / drain));
      }
    } else {
      if (!(entry.credits > 0)) return 0;
      most = Math.min(most, Math.floor((left - 0.01) / entry.credits));
    }
  }
  return Number.isFinite(most) ? Math.max(0, most - 1) : 0;
}

/** Book `rounds` rounds of one order's part at once, at exactly what those rounds cost. */
async function fillRoundsInTx(
  sp: Tx,
  workspaceId: string,
  marketId: string,
  order: OrderRow,
  entry: RoundEntry,
  rounds: number,
  at: Date,
  priceNow: number | null,
  bookNow: [number, number],
  left: number,
): Promise<FillStep> {
  const shares = entry.shares * rounds;
  const credits = entry.credits * rounds;
  const isSell = order.side === 'sell';
  if (!isSell) {
    await applyCredits(sp, {
      agentId: order.agentId,
      workspaceId,
      deltaUnits: toUnits(credits),
      reason: 'limit_order_release',
      refType: 'market',
      refId: marketId,
    });
  }
  await executeTradeInTx(sp, {
    workspaceId,
    agentId: order.agentId,
    marketId,
    mode: {
      type: 'priced',
      direction: order.direction === 'higher' ? 1 : 0,
      dirLabel: order.direction as 'higher' | 'lower',
      isSell,
      shares,
      credits,
    },
    at,
    recordConsensus: priceNow,
    splitBook: bookNow,
  });
  await sp
    .update(limitOrders)
    .set(
      isSell
        ? {
            filledShares: sql`coalesce(${limitOrders.filledShares}, 0) + ${shares}`,
            filledCredits: sql`${limitOrders.filledCredits} + ${credits}`,
            updatedAt: new Date(),
          }
        : { filledCredits: sql`${limitOrders.filledCredits} + ${credits}`, updatedAt: new Date() },
    )
    .where(eq(limitOrders.id, order.id));
  return {
    cost: isSell ? 0 : credits,
    proceeds: isSell ? credits : 0,
    shares,
    consensus: priceNow,
    closed: false,
    left: left - (isSell ? shares : credits),
  };
}

/**
 * Close an order and refund its unfilled remainder. Used by cancel, expiry,
 * and by market resolution/voiding, where a resting order must not strand
 * credits in a market that can no longer trade. A sell reserved nothing, so
 * closing one refunds nothing.
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
    side?: string;
    budgetCredits: number;
    filledCredits: number;
  },
  status: 'cancelled' | 'expired' | 'voided',
): Promise<number> {
  const refund = order.side === 'sell' ? 0 : Math.max(0, order.budgetCredits - order.filledCredits);
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
  // The market before its orders (docs/limit-orders.md), so closing a book
  // never waits on a fill that holds the market while it wants the orders.
  await tx.select({ id: markets.id }).from(markets).where(eq(markets.id, marketId)).for('update');
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
