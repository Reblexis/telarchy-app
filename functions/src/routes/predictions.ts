import { randomUUID } from 'crypto';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client';
import {
  agents,
  limitOrders,
  liquidityEvents,
  marketMessages,
  markets,
  positions,
  proposals,
  workspaces,
} from '../db/schema';
import { AMM_DEFAULTS, consensus, directionTradeCost, pHigher } from '../lib/amm';
import { isValidDateFormat, periodEndInstant, resolutionInstant } from '../lib/date-utils';
import { AppError } from '../lib/errors';
import { emitPricesChanged } from '../lib/market-events';
import { assertMarketUntraded } from '../lib/market-freeze';
import { extractMetricReferences } from '../lib/metrics-engine';
import {
  getGroupMemberIds,
  getParticipantDisplayNames,
  listParticipantsForWorkspace,
  resolveWorkspaceOwnerAgentId,
} from '../lib/participants';
import { fromUnits, MIN_LIQUIDITY_CONTRIBUTION, sufficientBalance, toUnits, validateContent } from '../lib/validation';
import { wrap } from '../lib/wrap';
import { requireCapability } from '../middleware/roles';
import { applyCredits } from '../services/credits';
import { emitEvent } from '../services/events';
import { applyAgentLiquidityInjectionTx } from '../services/marketLiquidity';
import { refreshRelativeDateMarkets, voidMarket } from '../services/markets';
import { getAllMetrics, getMetricLogs, getUpdates } from '../services/metrics';
import { notifyCommentPosted } from '../services/notifications';
import {
  getMarkets,
  type MarketStatus,
  replayMarketTradePoints,
  resolvePredictions,
  resolveSingleMarket,
} from '../services/predictions';
import { createConditionalMarkets, subsidyContributionsOf } from '../services/proposals';
import {
  capUsage,
  closeLimitOrderInTx,
  executeTradeInTx,
  fillLimitOrdersInTx,
  positionCap,
  type TradeMode,
} from '../services/trading';
import { clearBoardCache } from './leaderboard';

export const predictionsRouter = Router();

type MetricTradePermissionGroup = {
  type: string;
  memberIds: string[] | null;
  permissions: Record<string, { read: boolean; trade: boolean }> | null;
};

async function getTradePermissionGroups(workspaceId: string): Promise<MetricTradePermissionGroup[]> {
  const { permissionGroups } = await import('../db/schema');
  const rows = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, workspaceId));
  return rows.map(row => ({
    type: row.type,
    memberIds: getGroupMemberIds(row),
    permissions: (row.permissions as Record<string, { read: boolean; trade: boolean }>) ?? {},
  }));
}

function canTradeMetric(
  metricId: string,
  groups: MetricTradePermissionGroup[],
  auth: { capabilities: Set<string>; agentId?: string; uid?: string },
): boolean {
  if (auth.capabilities.has('manage')) return true;
  const restrictingGroups = groups.filter(group => group.permissions?.[metricId]?.trade === true);
  if (restrictingGroups.length === 0) return true;
  if (restrictingGroups.some(group => group.type === 'public')) return true;
  return restrictingGroups.some(group => (auth.agentId ? getGroupMemberIds(group).includes(auth.agentId) : false));
}

predictionsRouter.post(
  '/trade',
  requireCapability('trade'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const agentId = req.auth!.agentId;
    if (!agentId) {
      res.status(403).json({ error: 'A participant identity is required to trade' });
      return;
    }

    // If the body is empty or non-object, the most common cause is a missing
    // `Content-Type: application/json` header. Express body-parser silently
    // returns `{}`, which previously fell through to a generic field-name
    // error and confused integrators.
    const ctype = (req.headers['content-type'] || '').toLowerCase();
    const bodyKeys = req.body && typeof req.body === 'object' ? Object.keys(req.body) : [];
    if (bodyKeys.length === 0) {
      if (!ctype.includes('json')) {
        res
          .status(400)
          .json({ error: 'Request body is empty. Set `Content-Type: application/json` and POST a JSON object.' });
        return;
      }
      res.status(400).json({
        error: 'Request body is empty. Provide marketId (or metricName/metricId + targetDate) and a trade specifier.',
      });
      return;
    }

    let marketId = typeof req.body.marketId === 'string' ? req.body.marketId : undefined;

    // Allow targeting by metricName/metricId + targetDate instead of marketId.
    // proposalId disambiguates between baseline and conditional markets:
    //   - omitted (default): match the baseline market (proposalId IS NULL)
    //   - string: match the conditional market for that proposal
    //   - explicit null: same as default (baseline)
    // branch disambiguates between the two conditional markets under a proposal:
    //   - omitted (default): 'approved' branch (back-compat for pre-dual-branch
    //     clients)
    //   - 'approved' or 'declined': that branch specifically
    //   - ignored if proposalId is omitted
    if (!marketId) {
      const {
        metricName,
        metricId: reqMetricId,
        targetDate: reqTargetDate,
        proposalId: reqProposalId,
        branch: reqBranch,
      } = req.body;
      if (req.body.market_id !== undefined || req.body.marketID !== undefined) {
        res.status(400).json({ error: 'Use `marketId` (camelCase), not `market_id` or `marketID`.' });
        return;
      }
      if (!metricName && !reqMetricId && !reqTargetDate) {
        res
          .status(400)
          .json({ error: 'Missing `marketId`. Alternative: provide `metricName` (or `metricId`) plus `targetDate`.' });
        return;
      }
      if (!metricName && !reqMetricId) {
        res.status(400).json({ error: 'When targeting by `targetDate`, also provide `metricName` or `metricId`.' });
        return;
      }
      if (!reqTargetDate) {
        res.status(400).json({
          error: 'When targeting by metric, also provide `targetDate` (YYYY, YYYY-MM, YYYY-Www, or YYYY-MM-DD).',
        });
        return;
      }
      if (reqProposalId !== undefined && reqProposalId !== null && typeof reqProposalId !== 'string') {
        res.status(400).json({
          error: "`proposalId` must be a string (the conditional-market's proposal) or omitted/null (baseline market).",
        });
        return;
      }
      if (reqBranch !== undefined && reqBranch !== null && reqBranch !== 'approved' && reqBranch !== 'declined') {
        res.status(400).json({ error: '`branch` must be "approved", "declined", or omitted.' });
        return;
      }
      const proposalFilter =
        typeof reqProposalId === 'string' ? eq(markets.proposalId, reqProposalId) : isNull(markets.proposalId);
      const branchValue: 'approved' | 'declined' = reqBranch === 'declined' ? 'declined' : 'approved';
      const branchFilter = typeof reqProposalId === 'string' ? eq(markets.branch, branchValue) : isNull(markets.branch);
      const [found] = await db
        .select({ id: markets.id })
        .from(markets)
        .where(
          and(
            eq(markets.workspaceId, workspaceId),
            eq(markets.resolved, false),
            eq(markets.targetDate, reqTargetDate as string),
            reqMetricId ? eq(markets.metricId, reqMetricId as string) : eq(markets.metricName, metricName as string),
            proposalFilter,
            branchFilter,
          ),
        );
      if (!found) {
        const which =
          typeof reqProposalId === 'string'
            ? `${branchValue} conditional market for proposal ${reqProposalId}`
            : 'baseline market';
        res.status(404).json({
          error: `No open ${which} found for that metric + targetDate. Pass marketId directly, or check that proposalId / branch are correct.`,
        });
        return;
      }
      marketId = found.id;
    }

    let mode: TradeMode;
    const targetValue = req.body.targetValue ?? req.body.value;
    const maxBudget = req.body.maxBudget ?? req.body.amount;
    if (typeof targetValue === 'number' && typeof maxBudget === 'number') {
      // typeof-number admits NaN/Infinity; require finiteness so a bad number
      // fails as a clean 400 here instead of reaching the AMM/balance math and
      // surfacing as a 500 (the bigint balance column is the only backstop).
      if (!Number.isFinite(targetValue)) {
        res.status(400).json({ error: 'targetValue must be a finite number' });
        return;
      }
      if (!Number.isFinite(maxBudget) || maxBudget <= 0) {
        res.status(400).json({ error: 'maxBudget/amount must be a positive, finite number' });
        return;
      }
      mode = { type: 'targetValue', targetValue, maxBudget };
    } else if (typeof req.body.direction === 'string' && typeof req.body.sellShares === 'number') {
      if (req.body.direction !== 'higher' && req.body.direction !== 'lower') {
        res.status(400).json({ error: 'direction must be "higher" or "lower"' });
        return;
      }
      if (!Number.isFinite(req.body.sellShares) || req.body.sellShares <= 0) {
        res.status(400).json({ error: 'sellShares must be a positive, finite number' });
        return;
      }
      const dir = req.body.direction as 'higher' | 'lower';
      mode = { type: 'sell', direction: dir === 'higher' ? 1 : 0, dirLabel: dir, sellShares: req.body.sellShares };
    } else if (typeof req.body.direction === 'string' && typeof req.body.amount === 'number') {
      if (req.body.direction !== 'higher' && req.body.direction !== 'lower') {
        res.status(400).json({ error: 'direction must be "higher" or "lower"' });
        return;
      }
      if (!Number.isFinite(req.body.amount) || req.body.amount <= 0) {
        res.status(400).json({ error: 'amount must be a positive, finite number' });
        return;
      }
      const dir = req.body.direction as 'higher' | 'lower';
      mode = { type: 'buy', direction: dir === 'higher' ? 1 : 0, dirLabel: dir, amount: req.body.amount };
    } else {
      res
        .status(400)
        .json({ error: 'Provide {targetValue, maxBudget}, {direction, amount}, or {direction, sellShares}' });
      return;
    }

    // Permission check before transaction
    {
      const [market] = await db
        .select({ metricId: markets.metricId })
        .from(markets)
        .where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)));
      if (market?.metricId) {
        const groups = await getTradePermissionGroups(workspaceId);
        if (!canTradeMetric(market.metricId, groups, req.auth!)) {
          res.status(403).json({ error: 'Identity not authorized to trade this metric' });
          return;
        }
      }
    }

    let tradeResponse!: Record<string, unknown>;
    let eventPayload!: Record<string, unknown>;
    let fills: Awaited<ReturnType<typeof fillLimitOrdersInTx>> = [];
    const tradeId = randomUUID();

    await db.transaction(async tx => {
      const outcome = await executeTradeInTx(tx, { workspaceId, agentId, marketId: marketId!, mode, tradeId });

      // Every trade that moves the price runs the fill pass for that market, in
      // this same transaction: resting orders the price just crossed execute
      // against the post-trade curve before anyone else can trade. Sells move
      // the price too, so they trigger it as well.
      fills = await fillLimitOrdersInTx(tx, workspaceId, marketId!);

      const settled = fills.length > 0 ? fills[fills.length - 1].consensus : outcome.consensus;
      tradeResponse = outcome.isSell
        ? {
            tradeId,
            marketId,
            direction: outcome.direction,
            shares: outcome.shares,
            proceeds: outcome.proceeds,
            probability: outcome.probability,
            consensus: outcome.consensus,
          }
        : {
            tradeId,
            marketId,
            direction: outcome.direction,
            shares: outcome.shares,
            cost: outcome.cost,
            // Credits handed back for matched higher+lower pairs this buy
            // created, 1 a pair (docs/ui-conventions.md, "A trader holds
            // ONE net side"). Zero unless the caller held the other side.
            redeemed: outcome.redeemed,
            probability: outcome.probability,
            consensus: outcome.consensus,
          };
      if (fills.length > 0) {
        // The caller's own fill numbers are unchanged; this reports that other
        // people's resting orders executed behind them and where the price
        // actually came to rest.
        tradeResponse.limitFills = fills.map(f => ({ direction: f.direction, limitValue: f.limitValue, cost: f.cost }));
        tradeResponse.settledConsensus = settled;
      }
      eventPayload = {
        marketId,
        metricName: outcome.metricName,
        agentId,
        direction: outcome.direction,
        cost: outcome.isSell ? -outcome.proceeds : outcome.cost,
        newConsensus: settled,
      };
    });

    // The board must include this trade on the very next read: the floor rail
    // reloads right after a trade lands, and a cached answer that omits the
    // trade reads as the board being broken (owner report 2026-08-21).
    clearBoardCache();

    res.status(201).json(tradeResponse);
    emitEvent('trade:executed', eventPayload, workspaceId).catch(e => console.error('emitEvent failed:', e));
  }),
);

/**
 * Limit orders: a standing instruction to buy in one direction while the
 * market sits at or beyond a price, in metric space (dollars), because the
 * page speaks dollars and a trader should never have to convert.
 *
 * The budget is debited here, at placement, so the row holds reserved money
 * rather than an intention. That is the whole point: an order resting for a
 * week against a balance since spent elsewhere would fill into a negative
 * balance, or fail silently at the worst possible moment.
 * Design: docs/limit-orders.md.
 */
predictionsRouter.post(
  '/limit-orders',
  requireCapability('trade'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const agentId = req.auth!.agentId;
    if (!agentId) {
      res.status(403).json({ error: 'A participant identity is required to place limit orders' });
      return;
    }

    const { marketId, direction, limitValue } = req.body ?? {};
    const budgetCredits = req.body?.budgetCredits ?? req.body?.budget ?? req.body?.amount;
    if (typeof marketId !== 'string' || !marketId) {
      res.status(400).json({ error: 'marketId is required' });
      return;
    }
    if (direction !== 'higher' && direction !== 'lower') {
      res.status(400).json({ error: 'direction must be "higher" or "lower"' });
      return;
    }
    if (typeof limitValue !== 'number' || !Number.isFinite(limitValue)) {
      res.status(400).json({ error: "limitValue must be a number, in the metric's own units" });
      return;
    }
    if (typeof budgetCredits !== 'number' || !(budgetCredits > 0)) {
      res.status(400).json({ error: 'budgetCredits must be a positive number of credits' });
      return;
    }

    let expiresAt: Date | null = null;
    if (req.body?.expiresAt !== undefined && req.body?.expiresAt !== null) {
      const parsed = new Date(req.body.expiresAt);
      if (Number.isNaN(parsed.getTime())) {
        res.status(400).json({ error: 'expiresAt must be an ISO date-time, or omitted to rest until cancelled' });
        return;
      }
      if (parsed <= new Date()) {
        res.status(400).json({ error: 'expiresAt is in the past' });
        return;
      }
      expiresAt = parsed;
    }

    {
      const [market] = await db
        .select({ metricId: markets.metricId })
        .from(markets)
        .where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)));
      if (market?.metricId) {
        const groups = await getTradePermissionGroups(workspaceId);
        if (!canTradeMetric(market.metricId, groups, req.auth!)) {
          res.status(403).json({ error: 'Identity not authorized to trade this metric' });
          return;
        }
      }
    }

    const orderId = randomUUID();
    let created!: Record<string, unknown>;

    await db.transaction(async tx => {
      const [market] = await tx
        .select()
        .from(markets)
        .where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)))
        .for('update');
      if (!market) throw new AppError('Market not found', 404);
      if (market.resolved) throw new AppError('Market is resolved', 400);
      if (market.voided) throw new AppError('Market is voided; positions were refunded', 400);
      if (!market.active) throw new AppError('Market is closed', 400);
      if (market.liquidity <= 0)
        throw new AppError(
          'This market has no liquidity yet, so there is nothing to trade against. Someone has to fund it first.',
          400,
        );
      if (limitValue <= market.rangeMin || limitValue >= market.rangeMax) {
        throw new AppError(`limitValue must be strictly between ${market.rangeMin} and ${market.rangeMax}`, 400);
      }

      const current = consensus(
        (market.shares as [number, number]) || [0, 0],
        market.liquidity,
        market.rangeMin,
        market.rangeMax,
      );
      if (current === undefined) throw new AppError('Market has no price yet', 400);
      // An order placed already-crossed is a market order wearing a disguise.
      // Filling it instantly would surprise the trader, so say what it is.
      if (direction === 'higher' && limitValue >= current) {
        throw new AppError(
          `The market is already at ${current}, at or below your limit of ${limitValue}, so this would fill immediately. Place a trade instead, or set a lower limit.`,
          400,
          { consensus: current },
        );
      }
      if (direction === 'lower' && limitValue <= current) {
        throw new AppError(
          `The market is already at ${current}, at or above your limit of ${limitValue}, so this would fill immediately. Place a trade instead, or set a higher limit.`,
          400,
          { consensus: current },
        );
      }

      const [agentRow] = await tx.select().from(agents).where(eq(agents.id, agentId)).for('update');
      if (!agentRow) throw new AppError('Agent not found', 404);
      if (!sufficientBalance(agentRow.balance as number, budgetCredits)) {
        throw new AppError('Insufficient balance', 400, {
          balance: fromUnits(agentRow.balance as number),
          cost: budgetCredits,
        });
      }

      const cap = await positionCap(tx, workspaceId);
      if (cap > 0) {
        const used = await capUsage(tx, workspaceId, marketId, agentId);
        if (used + budgetCredits > cap + 1e-9) {
          throw new AppError(
            `Position cap reached: this workspace limits each participant to ${cap} credits of buys per market, counting credits reserved by open orders (you have used ${Math.round(used * 100) / 100}).`,
            400,
            { cap, spent: used, attempted: budgetCredits },
          );
        }
      }

      await applyCredits(tx, {
        agentId,
        workspaceId,
        deltaUnits: -toUnits(budgetCredits),
        reason: 'limit_order_hold',
        refType: 'market',
        refId: marketId,
      });
      await tx.insert(limitOrders).values({
        id: orderId,
        workspaceId,
        marketId,
        agentId,
        direction,
        limitValue,
        budgetCredits,
        filledCredits: 0,
        status: 'open',
        expiresAt,
      });

      created = {
        id: orderId,
        marketId,
        direction,
        limitValue,
        budgetCredits,
        filledCredits: 0,
        remainingCredits: budgetCredits,
        status: 'open',
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
        consensusAtPlacement: current,
      };
    });

    res.status(201).json(created);
  }),
);

/** The caller's own orders; admins may inspect another participant's. */
predictionsRouter.get(
  '/limit-orders',
  requireCapability('read'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const agentId =
      req.auth!.capabilities.has('manage') && typeof req.query.agentId === 'string'
        ? req.query.agentId
        : req.auth!.agentId;
    if (!agentId) {
      res.status(403).json({ error: 'A participant identity is required to list limit orders' });
      return;
    }

    // Expiry is swept lazily, here and in the fill pass, rather than by a cron:
    // an expired order that still shows as open is a lie about reserved money.
    await db.transaction(async tx => {
      const stale = await tx
        .select()
        .from(limitOrders)
        .where(
          and(
            eq(limitOrders.workspaceId, workspaceId),
            eq(limitOrders.agentId, agentId),
            eq(limitOrders.status, 'open'),
          ),
        )
        .for('update');
      const now = new Date();
      for (const order of stale) {
        if (order.expiresAt && order.expiresAt <= now) await closeLimitOrderInTx(tx, order, 'expired');
      }
    });

    const conditions = [eq(limitOrders.workspaceId, workspaceId), eq(limitOrders.agentId, agentId)];
    if (typeof req.query.marketId === 'string') conditions.push(eq(limitOrders.marketId, req.query.marketId));
    const status = typeof req.query.status === 'string' ? req.query.status : 'open';
    if (status !== 'all') conditions.push(eq(limitOrders.status, status));

    const rows = await db
      .select()
      .from(limitOrders)
      .where(and(...conditions))
      .orderBy(desc(limitOrders.createdAt));
    res.json(
      rows.map(o => ({
        id: o.id,
        marketId: o.marketId,
        agentId: o.agentId,
        direction: o.direction,
        limitValue: o.limitValue,
        budgetCredits: o.budgetCredits,
        filledCredits: o.filledCredits,
        remainingCredits: Math.max(0, o.budgetCredits - o.filledCredits),
        status: o.status,
        expiresAt: o.expiresAt ? o.expiresAt.toISOString() : null,
        createdAt: o.createdAt.toISOString(),
      })),
    );
  }),
);

/** Cancel, refunding the unfilled remainder. Owner or admin only. */
predictionsRouter.delete(
  '/limit-orders/:id',
  requireCapability('trade'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const isAdmin = req.auth!.capabilities.has('manage');
    const orderId = String(req.params.id);
    let refunded = 0;

    await db.transaction(async tx => {
      const [order] = await tx
        .select()
        .from(limitOrders)
        .where(and(eq(limitOrders.id, orderId), eq(limitOrders.workspaceId, workspaceId)))
        .for('update');
      if (!order) throw new AppError('Limit order not found', 404);
      if (!isAdmin && order.agentId !== req.auth!.agentId) throw new AppError('Not your limit order', 403);
      if (order.status !== 'open') throw new AppError(`Limit order is already ${order.status}`, 400);
      refunded = await closeLimitOrderInTx(tx, order, 'cancelled');
    });

    res.json({ id: orderId, status: 'cancelled', refundedCredits: refunded });
  }),
);

predictionsRouter.get(
  '/positions',
  requireCapability('read'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const agentId =
      req.auth!.capabilities.has('manage') && typeof req.query.agentId === 'string'
        ? req.query.agentId
        : req.auth!.agentId;
    if (!agentId) {
      res.status(403).json({ error: 'A participant identity is required to list positions' });
      return;
    }

    let rows = await db
      .select()
      .from(positions)
      .where(and(eq(positions.workspaceId, workspaceId), eq(positions.agentId, agentId)));
    if (req.query.marketId) {
      rows = rows.filter(p => p.marketId === req.query.marketId);
    }
    res.json(rows.filter(p => p.shares > 0));
  }),
);

predictionsRouter.get(
  '/markets',
  requireCapability('read'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const proposalId = typeof req.query.proposalId === 'string' ? req.query.proposalId : undefined;

    if (proposalId) {
      const [proposal] = await db
        .select()
        .from(proposals)
        .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
      if (proposal && proposal.status === 'pending') {
        // Re-spawn lazily when the proposal has no LIVE conditional markets, not
        // merely when its id list is empty. Relative-date rollover can void every
        // conditional market while conditionalMarketIds still references the dead
        // rows; gating on an empty list left such proposals permanently without
        // markets. Restricted to pending proposals: approved/declined ones void a
        // branch on purpose, so a zero-live-market state there is not a bug to heal.
        const [{ live } = { live: 0 }] = await db
          .select({ live: sql<number>`count(*)::int` })
          .from(markets)
          .where(
            and(eq(markets.workspaceId, workspaceId), eq(markets.proposalId, proposalId), eq(markets.resolved, false)),
          );
        if (live === 0) {
          const marketIds = await createConditionalMarkets(proposalId, workspaceId, {
            contributions: subsidyContributionsOf(proposal),
          });
          await db
            .update(proposals)
            .set({ conditionalMarketIds: marketIds })
            .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
        }
      }
    } else {
      await refreshRelativeDateMarkets(workspaceId);
    }

    const active = req.query.active === 'true' ? true : req.query.active === 'false' ? false : undefined;
    const includeResolved = req.query.includeResolved === 'true';
    const includeVoided = req.query.includeVoided === 'true';
    const minLiquidity = typeof req.query.minLiquidity === 'string' ? parseFloat(req.query.minLiquidity) : undefined;
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
    const rawKind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
    const kind: 'baseline' | 'conditional' | 'all' | undefined =
      rawKind === 'baseline' || rawKind === 'conditional' || rawKind === 'all' ? rawKind : undefined;
    const rawStatus = typeof req.query.status === 'string' ? req.query.status : undefined;
    const status: MarketStatus | undefined =
      rawStatus === 'open' ||
      rawStatus === 'closed' ||
      rawStatus === 'resolved' ||
      rawStatus === 'voided' ||
      rawStatus === 'all'
        ? rawStatus
        : undefined;
    const marketRows = await getMarkets(
      { proposalId, status, active, includeResolved, includeVoided, minLiquidity, limit, kind },
      undefined,
      workspaceId,
    );
    res.json(marketRows);
  }),
);

predictionsRouter.get(
  '/markets/:id/trades',
  requireCapability('read'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const last = typeof req.query.last === 'string' ? parseInt(req.query.last, 10) : undefined;
    const marketId = req.params.id as string;

    const [market] = await db
      .select({ id: markets.id })
      .from(markets)
      .where(and(eq(markets.workspaceId, workspaceId), eq(markets.id, marketId)));
    if (!market) {
      res.status(404).json({ error: 'Market not found' });
      return;
    }

    // Consensus-after-each-trade reconstruction lives in the service (shared
    // with the public trading floor's chart); see replayMarketTradePoints.
    const tradePoints = await replayMarketTradePoints(marketId, workspaceId);
    res.json(last !== undefined ? tradePoints.slice(-last) : tradePoints);
  }),
);

predictionsRouter.get(
  '/markets/:id/messages',
  requireCapability('read'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const marketId = req.params.id as string;
    const [market] = await db
      .select({ id: markets.id })
      .from(markets)
      .where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)));
    if (!market) {
      res.status(404).json({ error: 'Market not found' });
      return;
    }

    const messages = await db
      .select()
      .from(marketMessages)
      .where(and(eq(marketMessages.workspaceId, workspaceId), eq(marketMessages.marketId, marketId)))
      .orderBy(asc(marketMessages.createdAt));

    const names = await getParticipantDisplayNames(messages.map(m => m.from));
    res.json(messages.map(m => ({ ...m, fromName: names.get(m.from) ?? null })));
  }),
);

predictionsRouter.post(
  '/markets/:id/messages',
  requireCapability('trade'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const marketId = req.params.id as string;
    const { content } = req.body;
    if (!content || typeof content !== 'string') {
      res.status(400).json({ error: 'content is required' });
      return;
    }
    const contentError = validateContent(content, 'content', 5_000);
    if (contentError) {
      res.status(400).json({ error: contentError });
      return;
    }

    const [market] = await db
      .select({ id: markets.id })
      .from(markets)
      .where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)));
    if (!market) {
      res.status(404).json({ error: 'Market not found' });
      return;
    }

    const agentId = req.auth!.agentId;
    const from = agentId || 'admin';
    const id = randomUUID();
    const createdAt = new Date();
    await db.insert(marketMessages).values({ id, workspaceId, marketId, from, content, createdAt });

    // Everyone already in this market's thread hears about the reply
    // (docs/vision.md, "Participant email notifications"). Fire-and-forget.
    void notifyCommentPosted({ workspaceId, from, content, marketId });

    const names = await getParticipantDisplayNames([from]);
    res.status(201).json({ id, marketId, from, fromName: names.get(from) ?? null, content, createdAt });
  }),
);

predictionsRouter.get(
  '/markets/:id',
  requireCapability('read'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const [market] = await db
      .select()
      .from(markets)
      .where(and(eq(markets.id, req.params.id as string), eq(markets.workspaceId, workspaceId)));
    if (!market) {
      res.status(404).json({ error: 'Market not found' });
      return;
    }
    const shares = (market.shares as [number, number]) || [0, 0];
    const prob = pHigher(shares, market.liquidity);
    res.json({
      id: market.id,
      metricId: market.metricId,
      metricName: market.metricName,
      targetDate: market.targetDate,
      resolvesOn: resolutionInstant(market.targetDate),
      resolved: market.resolved,
      resolvedAt: market.resolvedAt ?? null,
      actualValue: market.actualValue ?? null,
      rangeMin: market.rangeMin,
      rangeMax: market.rangeMax,
      liquidity: market.liquidity,
      tradedVolume: market.tradedVolume ?? 0,
      probability: Math.round(prob * 10000) / 10000,
      consensus: consensus(shares, market.liquidity, market.rangeMin, market.rangeMax) ?? null,
      costToMoveUp1pct: directionTradeCost(shares, 1, market.liquidity * 0.01, market.liquidity),
    });
  }),
);

predictionsRouter.get(
  '/markets/:id/positions',
  requireCapability('read'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const marketId = req.params.id as string;
    const rows = await db
      .select()
      .from(positions)
      .where(and(eq(positions.workspaceId, workspaceId), eq(positions.marketId, marketId)));
    res.json(
      rows
        .filter(p => p.shares > 0)
        .map(p => ({
          agentId: p.agentId,
          direction: p.direction,
          shares: p.shares,
          totalCost: p.totalCost,
        })),
    );
  }),
);

predictionsRouter.get(
  '/markets/:id/context',
  requireCapability('read'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const [market] = await db
      .select()
      .from(markets)
      .where(and(eq(markets.id, req.params.id as string), eq(markets.workspaceId, workspaceId)));
    if (!market) {
      res.status(404).json({ error: 'Market not found' });
      return;
    }

    const historyLimit =
      typeof req.query.historyLimit === 'string' ? Math.min(parseInt(req.query.historyLimit, 10), 90) : 20;
    const updatesLimit =
      typeof req.query.updatesLimit === 'string' ? Math.min(parseInt(req.query.updatesLimit, 10), 30) : 10;

    const allMetrics = await getAllMetrics(workspaceId);
    const metric = allMetrics.find(m => m.id === market.metricId);
    const deps = metric ? extractMetricReferences(metric.formula || '0') : [];
    const depValues = deps.map(name => {
      const d = allMetrics.find(m => m.name === name);
      return { name, value: d?.value ?? null };
    });

    const [logs, allUpdates, relatedMarkets] = await Promise.all([
      metric ? getMetricLogs(metric.id, workspaceId) : Promise.resolve([]),
      getUpdates(200, workspaceId),
      db
        .select()
        .from(markets)
        .where(
          and(eq(markets.workspaceId, workspaceId), eq(markets.metricId, market.metricId), eq(markets.resolved, false)),
        ),
    ]);

    const metricUpdates = metric ? allUpdates.filter(u => u.metricName === metric.name) : [];
    const shares = (market.shares as [number, number]) || [0, 0];

    res.json({
      market: {
        id: market.id,
        metricName: market.metricName,
        targetDate: market.targetDate,
        resolvesOn: resolutionInstant(market.targetDate),
        rangeMin: market.rangeMin,
        rangeMax: market.rangeMax,
        probability: Math.round(pHigher(shares, market.liquidity) * 10000) / 10000,
        consensus: consensus(shares, market.liquidity, market.rangeMin, market.rangeMax) ?? null,
      },
      metric: metric
        ? {
            name: metric.name,
            description: metric.description || undefined,
            formula: metric.formula,
            currentValue: metric.value,
            currentTotal: metric.total,
            dependencies: depValues,
          }
        : null,
      history: logs.slice(-historyLimit).map(l => ({ value: l.outlook ?? l.value, timestamp: l.timestamp })),
      recentUpdates: metricUpdates.slice(0, updatesLimit).map(u => ({
        oldValue: u.oldValue,
        newValue: u.newValue,
        description: u.description,
        timestamp: u.timestamp,
      })),
      relatedMarkets: relatedMarkets
        .filter(m => m.id !== market.id)
        .map(m => {
          const s = (m.shares as [number, number]) || [0, 0];
          return {
            id: m.id,
            targetDate: m.targetDate,
            resolvesOn: resolutionInstant(m.targetDate),
            consensus: consensus(s, m.liquidity, m.rangeMin, m.rangeMax) ?? null,
            probability: Math.round(pHigher(s, m.liquidity) * 10000) / 10000,
          };
        }),
    });
  }),
);

predictionsRouter.post(
  '/markets',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const { metricId, targetDate, rangeMin, rangeMax, liquidity, skipAutoLiquidity } = req.body;
    if (!metricId || typeof metricId !== 'string') {
      res.status(400).json({ error: 'metricId is required' });
      return;
    }
    if (!targetDate || !isValidDateFormat(targetDate)) {
      res
        .status(400)
        .json({ error: 'targetDate must be YYYY, YYYY-MM, YYYY-Www, YYYY-MM-DD, or YYYY-MM-DDTHH (UTC hour)' });
      return;
    }

    if (periodEndInstant(targetDate) <= new Date()) {
      res.status(400).json({ error: 'targetDate period must not be over yet' });
      return;
    }

    const allMetrics = await getAllMetrics(workspaceId);
    const metric = allMetrics.find(m => m.id === metricId);
    if (!metric) {
      res.status(404).json({ error: 'Metric not found' });
      return;
    }

    // A VOIDED market does not occupy its slot. Cancelling a market and opening
    // a fresh one on the same (metric, targetDate) is the documented way to
    // change a book that nobody has traded yet, and the refresh cron does
    // exactly that for the markets it maintains. Counting the dead row here
    // made that flow 409 for manual markets, which left a floor with no market
    // at all until someone noticed (2026-08-19, resizing the hero market's
    // liquidity before Season 0).
    const [existing] = await db
      .select({ id: markets.id })
      .from(markets)
      .where(
        and(
          eq(markets.workspaceId, workspaceId),
          eq(markets.metricId, metricId),
          eq(markets.targetDate, targetDate),
          eq(markets.voided, false),
        ),
      );
    if (existing) {
      res.status(409).json({ error: 'Market already exists' });
      return;
    }

    const rMin = typeof rangeMin === 'number' ? rangeMin : AMM_DEFAULTS.rangeMin;
    const rMax = typeof rangeMax === 'number' ? rangeMax : (metric.marketRangeMax ?? AMM_DEFAULTS.rangeMax);
    if (rMax <= rMin) {
      res.status(400).json({ error: 'rangeMax must be greater than rangeMin' });
      return;
    }

    const [wsRow] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    const credits = wsRow?.newMarketLiquidityCredits ?? 0;
    const useAutoFund = Boolean(wsRow?.autoFundNewMarkets) && credits > 0 && skipAutoLiquidity !== true;

    const marketId = randomUUID();

    if (useAutoFund) {
      const ownerAgentId = await resolveWorkspaceOwnerAgentId(workspaceId);
      if (!ownerAgentId) {
        res.status(500).json({ error: 'Workspace owner has no agent record' });
        return;
      }
      try {
        await db.transaction(async tx => {
          await tx.insert(markets).values({
            id: marketId,
            workspaceId,
            metricId,
            metricName: metric.name,
            targetDate,
            resolved: false,
            resolvedAt: null,
            actualValue: null,
            active: true,
            rangeMin: rMin,
            rangeMax: rMax,
            shares: [0, 0] as [number, number],
            liquidity: 0,
            pool: 0,
            createdAt: new Date(),
          });
          await applyAgentLiquidityInjectionTx(tx, {
            workspaceId,
            marketId,
            agentId: ownerAgentId,
            poolContribution: credits,
          });
        });
      } catch (e) {
        if (e instanceof AppError) {
          res.status(e.status).json({ error: e.message });
          return;
        }
        throw e;
      }
    } else {
      // `liquidity` in the request = credits (pool capital). b = pool / ln(2).
      const pool = typeof liquidity === 'number' ? liquidity : AMM_DEFAULTS.liquidity;
      const liq = pool > 0 ? pool / Math.LN2 : 0; // b parameter
      const liqEventId = randomUUID();
      await db.transaction(async tx => {
        await tx.insert(markets).values({
          id: marketId,
          workspaceId,
          metricId,
          metricName: metric.name,
          targetDate,
          resolved: false,
          resolvedAt: null,
          actualValue: null,
          active: true,
          rangeMin: rMin,
          rangeMax: rMax,
          shares: [0, 0] as [number, number],
          liquidity: liq,
          pool,
          createdAt: new Date(),
        });
        await tx.insert(liquidityEvents).values({
          id: liqEventId,
          workspaceId,
          marketId,
          amount: pool,
          totalLiquidity: liq,
          type: 'initial',
          createdAt: new Date(),
        });
      });
      emitPricesChanged(workspaceId, marketId);
    }

    res.status(201).json({ id: marketId, metricId, metricName: metric.name, targetDate });
    emitEvent('market:created', { marketId, metricName: metric.name, targetDate }, workspaceId).catch(e =>
      console.error('emitEvent failed:', e),
    );
  }),
);

predictionsRouter.get(
  '/markets/:id/liquidity-events',
  requireCapability('read'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const rows = await db
      .select()
      .from(liquidityEvents)
      .where(and(eq(liquidityEvents.workspaceId, workspaceId), eq(liquidityEvents.marketId, req.params.id as string)));
    res.json(
      rows.map(r => ({
        id: r.id,
        amount: r.amount,
        totalLiquidity: r.totalLiquidity,
        type: r.type,
        createdAt: r.createdAt,
      })),
    );
  }),
);

predictionsRouter.post(
  '/markets/liquidity/bulk',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const { workspaceId, agentId: callerAgentId } = req.auth!;
    const { amount, agentId: bodyAgentId, proposalId } = req.body;
    if (typeof amount !== 'number' || amount <= 0) {
      res.status(400).json({ error: 'amount must be a positive number' });
      return;
    }
    const agentId = typeof bodyAgentId === 'string' && bodyAgentId ? bodyAgentId : callerAgentId;
    if (!agentId) {
      res.status(400).json({ error: 'agentId is required' });
      return;
    }

    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    // Funding your own balance is already authorized by requireCapability('manage')
    // above; only recheck workspace membership when an admin targets some *other*
    // agent's balance via bodyAgentId. listParticipantsForWorkspace intentionally
    // omits platform admins, so without this self-exemption a platform admin (incl.
    // a workspace owner flagged platformAdmin) could never fund from their own
    // balance and would hit a spurious "Agent is not in your workspace".
    if (agentId !== callerAgentId) {
      const wsMembers = await listParticipantsForWorkspace(workspaceId);
      if (!wsMembers.some(m => m.id === agentId)) {
        res.status(403).json({ error: 'Agent is not in your workspace' });
        return;
      }
    }

    // Proposal top-ups are recorded on the proposal row so rollover re-spawns
    // re-seed them (otherwise the injection would be refunded and lost when
    // the conditional markets roll to new target dates).
    let proposalRow: typeof proposals.$inferSelect | null = null;
    if (proposalId) {
      if (amount < MIN_LIQUIDITY_CONTRIBUTION) {
        res.status(400).json({
          error: `amount must be at least ${MIN_LIQUIDITY_CONTRIBUTION} credits per market for proposal subsidies (LMSR b below this is butterfly-sensitive)`,
        });
        return;
      }
      const [row] = await db
        .select()
        .from(proposals)
        .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
      if (!row) {
        res.status(404).json({ error: 'Proposal not found' });
        return;
      }
      proposalRow = row;
    }

    let marketRows = await db
      .select()
      .from(markets)
      .where(and(eq(markets.workspaceId, workspaceId), eq(markets.active, true), eq(markets.resolved, false)));
    if (proposalId) marketRows = marketRows.filter(m => m.proposalId === proposalId);
    else marketRows = marketRows.filter(m => !m.proposalId);
    if (marketRows.length === 0) {
      res.status(400).json({ error: 'No active markets' });
      return;
    }

    const balanceUnits = agent.balance as number;
    // `amount` = credits the agent spends per market (pool contribution).
    // The LMSR b parameter (liquidity) is derived from the pool: b = pool / ln(2).
    const marketUpdates = marketRows.map(m => {
      const oldShares = (m.shares as [number, number]) || [0, 0];
      const hasLiquidity = m.liquidity > 0;
      const oldPool = hasLiquidity ? (m.pool ?? 0) : 0;
      const newPool = oldPool + amount;
      // b parameter derived from pool so that pool = b * ln(2) always holds.
      const newLiquidity = newPool / Math.LN2; // newPool / ln(2) = newPool * log2(e)
      const bRatio = hasLiquidity ? newLiquidity / m.liquidity : 1;
      const newShares: [number, number] = hasLiquidity ? [oldShares[0] * bRatio, oldShares[1] * bRatio] : [0, 0];
      return { market: m, newLiquidity, newShares, newPool, poolContribution: amount };
    });

    const totalCost = Math.round(amount * marketUpdates.length * 1e6) / 1e6;
    if (!sufficientBalance(balanceUnits, totalCost)) {
      res.status(400).json({ error: `Insufficient balance: need ${totalCost}, have ${fromUnits(balanceUnits)}` });
      return;
    }

    await db.transaction(async tx => {
      await applyCredits(tx, {
        agentId,
        workspaceId,
        deltaUnits: -toUnits(totalCost),
        reason: 'liquidity',
        refType: 'market',
        refId: marketUpdates.map(u => u.market.id).join(','),
        also: { spentBetting: sql`${agents.spentBetting} + ${totalCost}` },
      });

      for (const { market, newLiquidity, newShares, newPool, poolContribution } of marketUpdates) {
        await tx
          .update(markets)
          .set({ liquidity: newLiquidity, shares: newShares, pool: newPool })
          .where(and(eq(markets.id, market.id), eq(markets.workspaceId, workspaceId)));
        await tx.insert(liquidityEvents).values({
          id: randomUUID(),
          workspaceId,
          marketId: market.id,
          agentId,
          amount,
          poolContribution,
          totalLiquidity: newLiquidity,
          type: 'injection',
          createdAt: new Date(),
        });
        emitPricesChanged(workspaceId, market.id);
      }

      // Persist the per-market top-up on a pending proposal so the subsidy
      // survives market rollovers and the proposal header reflects it. Only
      // pending proposals re-spawn markets; post-decision injections stay a
      // one-off boost to the surviving branch.
      if (proposalRow && proposalRow.status === 'pending') {
        const contributionsMap = { ...(proposalRow.subsidyContributions ?? {}) };
        contributionsMap[agentId] = Math.round(((contributionsMap[agentId] ?? 0) + amount) * 1e6) / 1e6;
        const newSubsidy = Math.round(((proposalRow.liquiditySubsidy ?? 0) + amount) * 1e6) / 1e6;
        await tx
          .update(proposals)
          .set({ subsidyContributions: contributionsMap, liquiditySubsidy: newSubsidy })
          .where(and(eq(proposals.id, proposalRow.id), eq(proposals.workspaceId, workspaceId)));
      }
    });

    res.json({ markets: marketRows.length, totalCost, amountPerMarket: amount });
  }),
);

predictionsRouter.post(
  '/markets/:id/liquidity',
  requireCapability('trade'),
  wrap(async (req, res) => {
    const { workspaceId, agentId: callerAgentId } = req.auth!;
    const { amount, agentId: bodyAgentId } = req.body;
    if (typeof amount !== 'number' || amount <= 0) {
      res.status(400).json({ error: 'amount must be a positive number' });
      return;
    }
    const agentId = typeof bodyAgentId === 'string' && bodyAgentId ? bodyAgentId : callerAgentId;
    if (!agentId) {
      res.status(400).json({ error: 'agentId is required' });
      return;
    }

    const [preMarket] = await db
      .select()
      .from(markets)
      .where(and(eq(markets.id, req.params.id as string), eq(markets.workspaceId, workspaceId)));
    if (!preMarket) {
      res.status(404).json({ error: 'Market not found' });
      return;
    }

    const [preAgent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!preAgent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    // Injecting from your own balance only needs `trade` (any participant can
    // provide liquidity to a market they can trade in). Funding *another*
    // participant's balance spends someone else's money, so it stays an admin
    // action: require `manage` and confirm the target is a workspace member.
    if (agentId !== callerAgentId) {
      if (!req.auth!.capabilities.has('manage')) {
        res.status(403).json({
          error:
            'Funding another participant\'s balance requires the "manage" capability; omit agentId to inject from your own balance.',
        });
        return;
      }
      const wsMembers = await listParticipantsForWorkspace(workspaceId);
      if (!wsMembers.some(m => m.id === agentId)) {
        res.status(403).json({ error: 'Agent is not in your workspace' });
        return;
      }
    }

    try {
      await db.transaction(async tx => {
        await applyAgentLiquidityInjectionTx(tx, {
          workspaceId,
          marketId: preMarket.id,
          agentId,
          poolContribution: amount,
        });
      });
      const [updated] = await db
        .select()
        .from(markets)
        .where(and(eq(markets.id, preMarket.id), eq(markets.workspaceId, workspaceId)));
      const newLiq = updated?.liquidity ?? 0;
      res.json({ liquidity: newLiq, poolContribution: amount });
    } catch (e) {
      if (e instanceof AppError) {
        res.status(e.status).json({ error: e.message });
        return;
      }
      throw e;
    }
  }),
);

// Void an open market: refunds all positions at cost, returns LP pool
// remainder to liquidity providers proportionally, and marks the market as
// voided=true (preserves history). The next market-refresh
// cycle will recreate the market at the same (metricId, targetDate) if the
// time-preference curve still wants one there.
predictionsRouter.post(
  '/markets/:id/void',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const marketId = req.params.id as string;
    const [market] = await db
      .select()
      .from(markets)
      .where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)));
    if (!market) {
      res.status(404).json({ error: 'Market not found' });
      return;
    }
    if (market.resolved) {
      res.status(409).json({ error: 'Market is already resolved or voided' });
      return;
    }
    // Voiding takes money off whoever put it in, so it is refused outright once
    // anyone has traded (docs/market-integrity.md). The engine's own voids
    // (stale conditionals, decided proposals) do not pass through here.
    //
    // The escape is deliberate rather than absent, on the model of
    // allowLedgerAdmin: a guard with no sanctioned way through gets routed
    // around with a hand-written UPDATE, and then the destruction happens with
    // no record at all. So: acknowledge the holders by name-count, and say why.
    // The reason is published to the workspace's event log, because the season
    // rules promise that a void during a season is announced rather than done
    // quietly, and a promise nothing records is not a promise.
    const acknowledged = req.body?.acknowledgeTraded === true;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!acknowledged) {
      await assertMarketUntraded(marketId, workspaceId);
    } else if (reason.length < 10) {
      res.status(400).json({
        error: 'Voiding a traded market needs a reason of at least 10 characters. It is published with the void.',
        reason: 'reasonRequired',
      });
      return;
    }

    const result = await voidMarket(market, workspaceId, reason || undefined);
    res.json({ voided: true, refundedPositions: result.refunded, reason: reason || null });
  }),
);

predictionsRouter.post(
  '/resolve',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    res.json(await resolvePredictions(req.body?.targetDate, workspaceId));
  }),
);

/**
 * POST /api/predictions/markets/:id/resolve
 * Admin-only force-resolve for a single market, regardless of targetDate.
 * Use to settle a market early (e.g. to test payouts in CI without waiting
 * for the daily cron). Resolves at the metric's current `total`.
 * Returns 404 if the market doesn't exist, 409 if already resolved.
 */
predictionsRouter.post(
  '/markets/:id/resolve',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const marketId = req.params.id as string;
    const [market] = await db
      .select()
      .from(markets)
      .where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)));
    if (!market) {
      res.status(404).json({ error: 'Market not found' });
      return;
    }
    if (market.resolved) {
      res.status(409).json({ error: 'Market is already resolved' });
      return;
    }
    const result = await resolveSingleMarket(marketId, workspaceId);
    if (result.skipped) {
      res.status(409).json({ error: 'Could not resolve (metric value missing/negative or already resolved)' });
      return;
    }
    res.json({ resolved: true, totalPayout: result.totalPayout });
  }),
);

predictionsRouter.post(
  '/markets/refresh',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const proposalId = typeof req.body?.proposalId === 'string' ? req.body.proposalId : undefined;
    if (proposalId) {
      const [proposal] = await db
        .select()
        .from(proposals)
        .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
      if (!proposal) {
        res.status(404).json({ error: 'Proposal not found' });
        return;
      }
      const existingIds = (proposal.conditionalMarketIds as string[]) ?? [];
      const marketIds = await createConditionalMarkets(proposalId, workspaceId, {
        contributions: subsidyContributionsOf(proposal),
      });
      await db
        .update(proposals)
        .set({ conditionalMarketIds: marketIds })
        .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
      const reused =
        existingIds.length > 0 &&
        existingIds.length === marketIds.length &&
        existingIds.every(id => marketIds.includes(id));
      res.json({ created: reused ? 0 : marketIds.length, deactivated: 0, deduplicated: 0 });
      return;
    }
    const force = req.body?.force === true;
    res.json(await refreshRelativeDateMarkets(workspaceId, { force }));
  }),
);

predictionsRouter.post(
  '/markets/notify',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const { metricId, metricName } = req.body || {};
    if (!metricId && !metricName) {
      res.status(400).json({ error: 'metricId or metricName is required' });
      return;
    }
    let targetMetricId = metricId ?? null;
    if (!targetMetricId && metricName) {
      const allMetrics = await getAllMetrics(workspaceId);
      const m = allMetrics.find(x => x.name === metricName);
      if (!m) {
        res.status(404).json({ error: 'Metric not found' });
        return;
      }
      targetMetricId = m.id;
    }
    const openMarkets = await db
      .select()
      .from(markets)
      .where(
        and(eq(markets.workspaceId, workspaceId), eq(markets.metricId, targetMetricId), eq(markets.resolved, false)),
      );
    for (const m of openMarkets) {
      await emitEvent(
        'market:created',
        { marketId: m.id, metricName: m.metricName, targetDate: m.targetDate },
        workspaceId,
      );
    }
    res.json({ emitted: openMarkets.length });
  }),
);
