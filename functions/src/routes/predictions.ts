import { Router } from 'express';
import { db } from '../db/client';
import { agents, markets, marketMessages, positions, trades, liquidityEvents, workspaces, proposals } from '../db/schema';
import { eq, and, asc, desc, sql, inArray, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { wrap } from '../lib/wrap';
import { AppError } from '../lib/errors';
import { authMiddleware } from '../middleware/auth';
import { requireCapability } from '../middleware/roles';
import { getAllMetrics, getMetricLogs, getUpdates } from '../services/metrics';
import { resolvePredictions, resolveSingleMarket, getMarkets, type MarketStatus } from '../services/predictions';
import { refreshRelativeDateMarkets, voidMarket } from '../services/markets';
import { createConditionalMarkets } from '../services/proposals';
import { isValidDateFormat, endOfPeriod } from '../lib/date-utils';
import { extractMetricReferences } from '../lib/metrics-engine';
import { consensus, pHigher, directionTradeCost, sharesForBudget, betTowardsValue, directionSellProceeds, lmsrCost, initialPool, AMM_DEFAULTS } from '../lib/amm';
import { emitEvent } from '../services/events';
import { applyAgentLiquidityInjectionTx } from '../services/marketLiquidity';
import { sufficientBalance, toUnits, fromUnits, validateContent } from '../lib/validation';
import { getGroupMemberIds, resolveWorkspaceOwnerAgentId, listParticipantsForWorkspace, getParticipantDisplayNames } from '../lib/participants';

export const predictionsRouter = Router();

predictionsRouter.use(authMiddleware);

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
  return restrictingGroups.some(group =>
    auth.agentId ? getGroupMemberIds(group).includes(auth.agentId) : false,
  );
}

predictionsRouter.post('/trade', requireCapability('trade'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const agentId = req.auth!.agentId;
  if (!agentId) { res.status(403).json({ error: 'A participant identity is required to trade' }); return; }

  // If the body is empty or non-object, the most common cause is a missing
  // `Content-Type: application/json` header. Express body-parser silently
  // returns `{}`, which previously fell through to a generic field-name
  // error and confused integrators.
  const ctype = (req.headers['content-type'] || '').toLowerCase();
  const bodyKeys = req.body && typeof req.body === 'object' ? Object.keys(req.body) : [];
  if (bodyKeys.length === 0) {
    if (!ctype.includes('json')) {
      res.status(400).json({ error: 'Request body is empty. Set `Content-Type: application/json` and POST a JSON object.' });
      return;
    }
    res.status(400).json({ error: 'Request body is empty. Provide marketId (or metricName/metricId + targetDate) and a trade specifier.' });
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
      res.status(400).json({ error: 'Missing `marketId`. Alternative: provide `metricName` (or `metricId`) plus `targetDate`.' });
      return;
    }
    if (!metricName && !reqMetricId) {
      res.status(400).json({ error: 'When targeting by `targetDate`, also provide `metricName` or `metricId`.' });
      return;
    }
    if (!reqTargetDate) {
      res.status(400).json({ error: 'When targeting by metric, also provide `targetDate` (YYYY, YYYY-MM, YYYY-Www, or YYYY-MM-DD).' });
      return;
    }
    if (reqProposalId !== undefined && reqProposalId !== null && typeof reqProposalId !== 'string') {
      res.status(400).json({ error: '`proposalId` must be a string (the conditional-market\'s proposal) or omitted/null (baseline market).' });
      return;
    }
    if (reqBranch !== undefined && reqBranch !== null && reqBranch !== 'approved' && reqBranch !== 'declined') {
      res.status(400).json({ error: '`branch` must be "approved", "declined", or omitted.' });
      return;
    }
    const proposalFilter = typeof reqProposalId === 'string'
      ? eq(markets.proposalId, reqProposalId)
      : isNull(markets.proposalId);
    const branchValue: 'approved' | 'declined' = (reqBranch === 'declined') ? 'declined' : 'approved';
    const branchFilter = typeof reqProposalId === 'string'
      ? eq(markets.branch, branchValue)
      : isNull(markets.branch);
    const [found] = await db.select({ id: markets.id }).from(markets).where(and(
      eq(markets.workspaceId, workspaceId),
      eq(markets.resolved, false),
      eq(markets.targetDate, reqTargetDate as string),
      reqMetricId ? eq(markets.metricId, reqMetricId as string) : eq(markets.metricName, metricName as string),
      proposalFilter,
      branchFilter,
    ));
    if (!found) {
      const which = typeof reqProposalId === 'string'
        ? `${branchValue} conditional market for proposal ${reqProposalId}`
        : 'baseline market';
      res.status(404).json({ error: `No open ${which} found for that metric + targetDate. Pass marketId directly, or check that proposalId / branch are correct.` });
      return;
    }
    marketId = found.id;
  }

  type TradeMode =
    | { type: 'targetValue'; targetValue: number; maxBudget: number }
    | { type: 'sell'; direction: 0 | 1; dirLabel: 'higher' | 'lower'; sellShares: number }
    | { type: 'buy'; direction: 0 | 1; dirLabel: 'higher' | 'lower'; amount: number };

  let mode: TradeMode;
  const targetValue = req.body.targetValue ?? req.body.value;
  const maxBudget = req.body.maxBudget ?? req.body.amount;
  if (typeof targetValue === 'number' && typeof maxBudget === 'number') {
    if (maxBudget <= 0) { res.status(400).json({ error: 'maxBudget/amount must be positive' }); return; }
    mode = { type: 'targetValue', targetValue, maxBudget };
  } else if (typeof req.body.direction === 'string' && typeof req.body.sellShares === 'number') {
    if (req.body.direction !== 'higher' && req.body.direction !== 'lower') {
      res.status(400).json({ error: 'direction must be "higher" or "lower"' }); return;
    }
    if (req.body.sellShares <= 0) { res.status(400).json({ error: 'sellShares must be positive' }); return; }
    const dir = req.body.direction as 'higher' | 'lower';
    mode = { type: 'sell', direction: dir === 'higher' ? 1 : 0, dirLabel: dir, sellShares: req.body.sellShares };
  } else if (typeof req.body.direction === 'string' && typeof req.body.amount === 'number') {
    if (req.body.direction !== 'higher' && req.body.direction !== 'lower') {
      res.status(400).json({ error: 'direction must be "higher" or "lower"' }); return;
    }
    if (req.body.amount <= 0) { res.status(400).json({ error: 'amount must be positive' }); return; }
    const dir = req.body.direction as 'higher' | 'lower';
    mode = { type: 'buy', direction: dir === 'higher' ? 1 : 0, dirLabel: dir, amount: req.body.amount };
  } else {
    res.status(400).json({ error: 'Provide {targetValue, maxBudget}, {direction, amount}, or {direction, sellShares}' }); return;
  }

  // Permission check before transaction
  {
    const [market] = await db.select({ metricId: markets.metricId })
      .from(markets).where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)));
    if (market?.metricId) {
      const groups = await getTradePermissionGroups(workspaceId);
      if (!canTradeMetric(market.metricId, groups, req.auth!)) {
        res.status(403).json({ error: 'Identity not authorized to trade this metric' }); return;
      }
    }
  }

  let tradeResponse!: Record<string, unknown>;
  let eventPayload!: Record<string, unknown>;
  const tradeId = randomUUID();

  await db.transaction(async tx => {
    const [market] = await tx.select().from(markets)
      .where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)))
      .for('update');
    if (!market) throw new AppError('Market not found', 404);
    if (market.resolved) throw new AppError('Market is resolved', 400);
    if (market.voided) throw new AppError('Market is voided; positions were refunded', 400);
    if (!market.active && mode.type !== 'sell') {
      throw new AppError('Market is closed; only selling existing positions is allowed', 400);
    }

    const shares = (market.shares as [number, number]) || [0, 0];
    const b = market.liquidity;
    if (b <= 0) throw new AppError('Market has no liquidity. Admin must inject liquidity before trading.', 400);

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
      direction = r.direction; amount = r.amount; cost = r.cost;
      dirLabel = direction === 1 ? 'higher' : 'lower';
    } else if (mode.type === 'sell') {
      direction = mode.direction; dirLabel = mode.dirLabel;
      amount = mode.sellShares; isSell = true;
    } else {
      direction = mode.direction; dirLabel = mode.dirLabel;
      const r = sharesForBudget(shares, direction, mode.amount, b);
      amount = r.amount; cost = r.cost;
    }

    if (amount <= 0) throw new AppError('Trade too small', 400);

    const resolvedPosId = `${agentId}_${marketId}_${dirLabel}`;
    const [posRow] = await tx.select().from(positions)
      .where(and(eq(positions.id, resolvedPosId), eq(positions.workspaceId, workspaceId)));

    let proceeds = 0;
    if (isSell) {
      const posShares = posRow?.shares ?? 0;
      if (posShares < amount) throw new AppError('Insufficient shares to sell', 400, { available: posShares });
      proceeds = directionSellProceeds(shares, direction, amount, b);
      if (proceeds <= 0) throw new AppError('Trade too small', 400);
    } else {
      if (cost > 0 && !sufficientBalance(balanceUnits, cost)) throw new AppError('Insufficient balance', 400, { balance: fromUnits(balanceUnits), cost });
    }

    const newShares: [number, number] = [shares[0], shares[1]];
    newShares[direction] += isSell ? -amount : amount;
    const newConsensus = consensus(newShares, b, market.rangeMin, market.rangeMax) ?? null;
    const newProbability = Math.round(pHigher(newShares, b) * 10000) / 10000;

    if (isSell) {
      await tx.update(markets).set({
        shares: newShares,
        pool: sql`${markets.pool} - ${proceeds}`,
        tradedVolume: sql`${markets.tradedVolume} + ${proceeds}`,
      }).where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)));
      await tx.update(agents).set({
        balance: sql`${agents.balance} + ${toUnits(proceeds)}`,
        earnedBetting: sql`${agents.earnedBetting} + ${proceeds}`,
      }).where(eq(agents.id, agentId));
      await tx.update(positions).set({ shares: sql`${positions.shares} - ${amount}` })
        .where(and(eq(positions.id, resolvedPosId), eq(positions.workspaceId, workspaceId)));
    } else {
      await tx.update(markets).set({
        shares: newShares,
        pool: sql`${markets.pool} + ${cost}`,
        tradedVolume: sql`${markets.tradedVolume} + ${cost}`,
      }).where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)));
      await tx.update(agents).set({
        balance: sql`${agents.balance} - ${toUnits(cost)}`,
        spentBetting: sql`${agents.spentBetting} + ${cost}`,
      }).where(eq(agents.id, agentId));

      if (posRow) {
        await tx.update(positions).set({
          shares: sql`${positions.shares} + ${amount}`,
          totalCost: sql`${positions.totalCost} + ${cost}`,
        }).where(and(eq(positions.id, resolvedPosId), eq(positions.workspaceId, workspaceId)));
      } else {
        await tx.insert(positions).values({
          id: resolvedPosId, workspaceId, agentId, marketId,
          direction: dirLabel, shares: amount, totalCost: cost,
        });
      }

      if (cost > 0) {
        await tx.update(workspaces).set({ tradedVolume: sql`${workspaces.tradedVolume} + ${cost}` })
          .where(eq(workspaces.id, workspaceId));
      }
    }

    await tx.insert(trades).values({
      id: tradeId, workspaceId, agentId, marketId, direction: dirLabel,
      shares: isSell ? -amount : amount,
      cost: isSell ? -proceeds : cost,
      createdAt: new Date(),
    });

    tradeResponse = isSell
      ? { tradeId, marketId, direction: dirLabel, shares: amount, proceeds, probability: newProbability, consensus: newConsensus }
      : { tradeId, marketId, direction: dirLabel, shares: amount, cost, probability: newProbability, consensus: newConsensus };
    eventPayload = { marketId, metricName: market.metricName, agentId, direction: dirLabel, cost: isSell ? -proceeds : cost, newConsensus };
  });

  res.status(201).json(tradeResponse);
  emitEvent('trade:executed', eventPayload, workspaceId).catch(e => console.error('emitEvent failed:', e));
}));

predictionsRouter.get('/positions', requireCapability('read'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const agentId = req.auth!.capabilities.has('manage') && typeof req.query.agentId === 'string'
    ? req.query.agentId
    : req.auth!.agentId;
  if (!agentId) { res.status(403).json({ error: 'A participant identity is required to list positions' }); return; }

  let rows = await db.select().from(positions)
    .where(and(eq(positions.workspaceId, workspaceId), eq(positions.agentId, agentId)));
  if (req.query.marketId) {
    rows = rows.filter(p => p.marketId === req.query.marketId);
  }
  res.json(rows.filter(p => p.shares > 0));
}));

predictionsRouter.get('/markets', requireCapability('read'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const proposalId = typeof req.query.proposalId === 'string' ? req.query.proposalId : undefined;

  if (proposalId) {
    const [proposal] = await db.select().from(proposals)
      .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
    if (proposal) {
      const currentIds = (proposal.conditionalMarketIds as string[]) ?? [];
      if (!currentIds.length) {
        const subsidy = proposal.liquiditySubsidy ?? 0;
        const marketIds = await createConditionalMarkets(proposalId, workspaceId, {
          subsidyPerMarket: subsidy,
          proposerAgentId: subsidy > 0 ? proposal.proposedBy : null,
        });
        await db.update(proposals).set({ conditionalMarketIds: marketIds })
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
    rawStatus === 'open' || rawStatus === 'closed' || rawStatus === 'resolved' || rawStatus === 'voided' || rawStatus === 'all'
      ? rawStatus : undefined;
  const marketRows = await getMarkets(
    { proposalId, status, active, includeResolved, includeVoided, minLiquidity, limit, kind },
    undefined, workspaceId,
  );
  res.json(marketRows);
}));

predictionsRouter.get('/markets/:id/trades', requireCapability('read'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const last = typeof req.query.last === 'string' ? parseInt(req.query.last, 10) : undefined;
  const marketId = req.params.id as string;

  const [market] = await db.select().from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.id, marketId)));
  if (!market) { res.status(404).json({ error: 'Market not found' }); return; }

  let rows = await db.select().from(trades)
    .where(and(eq(trades.workspaceId, workspaceId), eq(trades.marketId, marketId)))
    .orderBy(asc(trades.createdAt));

  let runningShares: [number, number] = [0, 0];
  const tradePoints = rows.map(t => {
    const directionIndex = t.direction === 'higher' ? 1 : 0;
    runningShares = [...runningShares] as [number, number];
    runningShares[directionIndex] += t.shares;
    return {
      agentId: t.agentId,
      direction: t.direction,
      shares: Math.abs(t.shares),
      cost: t.cost,
      consensus: consensus(runningShares, market.liquidity, market.rangeMin, market.rangeMax) ?? null,
      createdAt: t.createdAt,
    };
  });

  if (last !== undefined) {
    rows = rows.slice(-last);
    res.json(tradePoints.slice(-last));
    return;
  }
  res.json(tradePoints);
}));

predictionsRouter.get('/markets/:id/messages', requireCapability('read'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const marketId = req.params.id as string;
  const [market] = await db.select({ id: markets.id }).from(markets)
    .where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)));
  if (!market) { res.status(404).json({ error: 'Market not found' }); return; }

  const messages = await db.select().from(marketMessages)
    .where(and(eq(marketMessages.workspaceId, workspaceId), eq(marketMessages.marketId, marketId)))
    .orderBy(asc(marketMessages.createdAt));

  const names = await getParticipantDisplayNames(messages.map(m => m.from));
  res.json(messages.map(m => ({ ...m, fromName: names.get(m.from) ?? null })));
}));

predictionsRouter.post('/markets/:id/messages', requireCapability('trade'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const marketId = req.params.id as string;
  const { content } = req.body;
  if (!content || typeof content !== 'string') { res.status(400).json({ error: 'content is required' }); return; }
  const contentError = validateContent(content, 'content', 5_000);
  if (contentError) { res.status(400).json({ error: contentError }); return; }

  const [market] = await db.select({ id: markets.id }).from(markets)
    .where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)));
  if (!market) { res.status(404).json({ error: 'Market not found' }); return; }

  const agentId = req.auth!.agentId;
  const from = agentId || 'admin';
  const id = randomUUID();
  const createdAt = new Date();
  await db.insert(marketMessages).values({ id, workspaceId, marketId, from, content, createdAt });

  const names = await getParticipantDisplayNames([from]);
  res.status(201).json({ id, marketId, from, fromName: names.get(from) ?? null, content, createdAt });
}));

predictionsRouter.get('/markets/:id', requireCapability('read'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const [market] = await db.select().from(markets)
    .where(and(eq(markets.id, req.params.id as string), eq(markets.workspaceId, workspaceId)));
  if (!market) { res.status(404).json({ error: 'Market not found' }); return; }
  const shares = (market.shares as [number, number]) || [0, 0];
  const prob = pHigher(shares, market.liquidity);
  res.json({
    id: market.id, metricId: market.metricId, metricName: market.metricName,
    targetDate: market.targetDate, resolvesOn: endOfPeriod(market.targetDate),
    resolved: market.resolved,
    resolvedAt: market.resolvedAt ?? null,
    actualValue: market.actualValue ?? null,
    rangeMin: market.rangeMin, rangeMax: market.rangeMax, liquidity: market.liquidity,
    tradedVolume: market.tradedVolume ?? 0,
    probability: Math.round(prob * 10000) / 10000,
    consensus: consensus(shares, market.liquidity, market.rangeMin, market.rangeMax) ?? null,
    costToMoveUp1pct: directionTradeCost(shares, 1, market.liquidity * 0.01, market.liquidity),
  });
}));

predictionsRouter.get('/markets/:id/positions', requireCapability('read'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const marketId = req.params.id as string;
  const rows = await db.select().from(positions)
    .where(and(eq(positions.workspaceId, workspaceId), eq(positions.marketId, marketId)));
  res.json(rows.filter(p => p.shares > 0).map(p => ({
    agentId: p.agentId,
    direction: p.direction,
    shares: p.shares,
    totalCost: p.totalCost,
  })));
}));

predictionsRouter.get('/markets/:id/context', requireCapability('read'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const [market] = await db.select().from(markets)
    .where(and(eq(markets.id, req.params.id as string), eq(markets.workspaceId, workspaceId)));
  if (!market) { res.status(404).json({ error: 'Market not found' }); return; }

  const historyLimit = typeof req.query.historyLimit === 'string' ? Math.min(parseInt(req.query.historyLimit, 10), 90) : 20;
  const updatesLimit = typeof req.query.updatesLimit === 'string' ? Math.min(parseInt(req.query.updatesLimit, 10), 30) : 10;

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
    db.select().from(markets)
      .where(and(eq(markets.workspaceId, workspaceId), eq(markets.metricId, market.metricId), eq(markets.resolved, false))),
  ]);

  const metricUpdates = metric ? allUpdates.filter(u => u.metricName === metric.name) : [];
  const shares = (market.shares as [number, number]) || [0, 0];

  res.json({
    market: {
      id: market.id, metricName: market.metricName,
      targetDate: market.targetDate, resolvesOn: endOfPeriod(market.targetDate),
      rangeMin: market.rangeMin, rangeMax: market.rangeMax,
      probability: Math.round(pHigher(shares, market.liquidity) * 10000) / 10000,
      consensus: consensus(shares, market.liquidity, market.rangeMin, market.rangeMax) ?? null,
    },
    metric: metric ? {
      name: metric.name, description: metric.description || undefined, formula: metric.formula,
      currentValue: metric.value, currentTotal: metric.total, dependencies: depValues,
    } : null,
    history: logs.slice(-historyLimit).map(l => ({ value: l.outlook ?? l.value, timestamp: l.timestamp })),
    recentUpdates: metricUpdates.slice(0, updatesLimit).map(u => ({
      oldValue: u.oldValue, newValue: u.newValue, description: u.description, timestamp: u.timestamp,
    })),
    relatedMarkets: relatedMarkets
      .filter(m => m.id !== market.id)
      .map(m => {
        const s = (m.shares as [number, number]) || [0, 0];
        return {
          id: m.id, targetDate: m.targetDate, resolvesOn: endOfPeriod(m.targetDate),
          consensus: consensus(s, m.liquidity, m.rangeMin, m.rangeMax) ?? null,
          probability: Math.round(pHigher(s, m.liquidity) * 10000) / 10000,
        };
      }),
  });
}));

predictionsRouter.post('/markets', requireCapability('manage'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const { metricId, targetDate, rangeMin, rangeMax, liquidity, skipAutoLiquidity } = req.body;
  if (!metricId || typeof metricId !== 'string') { res.status(400).json({ error: 'metricId is required' }); return; }
  if (!targetDate || !isValidDateFormat(targetDate)) { res.status(400).json({ error: 'targetDate must be YYYY, YYYY-MM, YYYY-Www, or YYYY-MM-DD' }); return; }

  const today = new Date().toISOString().slice(0, 10);
  if (endOfPeriod(targetDate) <= today) { res.status(400).json({ error: 'targetDate period must be in the future' }); return; }

  const allMetrics = await getAllMetrics(workspaceId);
  const metric = allMetrics.find(m => m.id === metricId);
  if (!metric) { res.status(404).json({ error: 'Metric not found' }); return; }

  const [existing] = await db.select({ id: markets.id }).from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.metricId, metricId), eq(markets.targetDate, targetDate)));
  if (existing) { res.status(409).json({ error: 'Market already exists' }); return; }

  const rMin = typeof rangeMin === 'number' ? rangeMin : AMM_DEFAULTS.rangeMin;
  const rMax = typeof rangeMax === 'number' ? rangeMax : (metric.marketRangeMax ?? AMM_DEFAULTS.rangeMax);
  if (rMax <= rMin) { res.status(400).json({ error: 'rangeMax must be greater than rangeMin' }); return; }

  const [wsRow] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  const credits = wsRow?.newMarketLiquidityCredits ?? 0;
  const useAutoFund = Boolean(wsRow?.autoFundNewMarkets) && credits > 0 && skipAutoLiquidity !== true;

  const marketId = randomUUID();

  if (useAutoFund) {
    const ownerAgentId = await resolveWorkspaceOwnerAgentId(workspaceId);
    if (!ownerAgentId) {
      res.status(500).json({ error: 'Workspace owner has no agent record' }); return;
    }
    try {
      await db.transaction(async tx => {
        await tx.insert(markets).values({
          id: marketId, workspaceId, metricId, metricName: metric.name, targetDate,
          resolved: false, resolvedAt: null, actualValue: null, active: true,
          rangeMin: rMin, rangeMax: rMax, shares: [0, 0] as [number, number],
          liquidity: 0, pool: 0, createdAt: new Date(),
        });
        await applyAgentLiquidityInjectionTx(tx, {
          workspaceId, marketId, agentId: ownerAgentId, poolContribution: credits,
        });
      });
    } catch (e) {
      if (e instanceof AppError) { res.status(e.status).json({ error: e.message }); return; }
      throw e;
    }
  } else {
    // `liquidity` in the request = credits (pool capital). b = pool / ln(2).
    const pool = typeof liquidity === 'number' ? liquidity : AMM_DEFAULTS.liquidity;
    const liq = pool > 0 ? pool / Math.LN2 : 0; // b parameter
    const liqEventId = randomUUID();
    await db.transaction(async tx => {
      await tx.insert(markets).values({
        id: marketId, workspaceId, metricId, metricName: metric.name, targetDate,
        resolved: false, resolvedAt: null, actualValue: null, active: true,
        rangeMin: rMin, rangeMax: rMax, shares: [0, 0] as [number, number],
        liquidity: liq, pool, createdAt: new Date(),
      });
      await tx.insert(liquidityEvents).values({
        id: liqEventId, workspaceId, marketId, amount: pool, totalLiquidity: liq, type: 'initial', createdAt: new Date(),
      });
    });
  }

  res.status(201).json({ id: marketId, metricId, metricName: metric.name, targetDate });
  emitEvent('market:created', { marketId, metricName: metric.name, targetDate }, workspaceId).catch(e => console.error('emitEvent failed:', e));
}));

predictionsRouter.get('/markets/:id/liquidity-events', requireCapability('read'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const rows = await db.select().from(liquidityEvents)
    .where(and(eq(liquidityEvents.workspaceId, workspaceId), eq(liquidityEvents.marketId, req.params.id as string)));
  res.json(rows.map(r => ({
    id: r.id, amount: r.amount, totalLiquidity: r.totalLiquidity, type: r.type,
    createdAt: r.createdAt,
  })));
}));

predictionsRouter.post('/markets/liquidity/bulk', requireCapability('manage'), wrap(async (req, res) => {
  const { workspaceId, agentId: callerAgentId } = req.auth!;
  const { amount, agentId: bodyAgentId, proposalId } = req.body;
  if (typeof amount !== 'number' || amount <= 0) { res.status(400).json({ error: 'amount must be a positive number' }); return; }
  const agentId = (typeof bodyAgentId === 'string' && bodyAgentId) ? bodyAgentId : callerAgentId;
  if (!agentId) { res.status(400).json({ error: 'agentId is required' }); return; }

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }
  const wsMembers = await listParticipantsForWorkspace(workspaceId);
  if (!wsMembers.some(m => m.id === agentId)) { res.status(403).json({ error: 'Agent is not in your workspace' }); return; }

  let marketRows = await db.select().from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.active, true), eq(markets.resolved, false)));
  if (proposalId) marketRows = marketRows.filter(m => m.proposalId === proposalId);
  else marketRows = marketRows.filter(m => !m.proposalId);
  if (marketRows.length === 0) { res.status(400).json({ error: 'No active markets' }); return; }

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
    const newShares: [number, number] = hasLiquidity
      ? [oldShares[0] * bRatio, oldShares[1] * bRatio]
      : [0, 0];
    return { market: m, newLiquidity, newShares, newPool, poolContribution: amount };
  });

  const totalCost = Math.round(amount * marketUpdates.length * 1e6) / 1e6;
  if (!sufficientBalance(balanceUnits, totalCost)) {
    res.status(400).json({ error: `Insufficient balance: need ${totalCost}, have ${fromUnits(balanceUnits)}` }); return;
  }

  await db.transaction(async tx => {
    await tx.update(agents).set({
      balance: sql`${agents.balance} - ${toUnits(totalCost)}`,
      spentBetting: sql`${agents.spentBetting} + ${totalCost}`,
    }).where(eq(agents.id, agentId));

    for (const { market, newLiquidity, newShares, newPool, poolContribution } of marketUpdates) {
      await tx.update(markets).set({ liquidity: newLiquidity, shares: newShares, pool: newPool })
        .where(and(eq(markets.id, market.id), eq(markets.workspaceId, workspaceId)));
      await tx.insert(liquidityEvents).values({
        id: randomUUID(), workspaceId, marketId: market.id, agentId, amount, poolContribution,
        totalLiquidity: newLiquidity, type: 'injection', createdAt: new Date(),
      });
    }
  });

  res.json({ markets: marketRows.length, totalCost, amountPerMarket: amount });
}));

predictionsRouter.post('/markets/:id/liquidity', requireCapability('manage'), wrap(async (req, res) => {
  const { workspaceId, agentId: callerAgentId } = req.auth!;
  const { amount, agentId: bodyAgentId } = req.body;
  if (typeof amount !== 'number' || amount <= 0) { res.status(400).json({ error: 'amount must be a positive number' }); return; }
  const agentId = (typeof bodyAgentId === 'string' && bodyAgentId) ? bodyAgentId : callerAgentId;
  if (!agentId) { res.status(400).json({ error: 'agentId is required' }); return; }

  const [preMarket] = await db.select().from(markets)
    .where(and(eq(markets.id, req.params.id as string), eq(markets.workspaceId, workspaceId)));
  if (!preMarket) { res.status(404).json({ error: 'Market not found' }); return; }

  const [preAgent] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (!preAgent) { res.status(404).json({ error: 'Agent not found' }); return; }
  const wsMembers = await listParticipantsForWorkspace(workspaceId);
  if (!wsMembers.some(m => m.id === agentId)) { res.status(403).json({ error: 'Agent is not in your workspace' }); return; }

  try {
    await db.transaction(async tx => {
      await applyAgentLiquidityInjectionTx(tx, {
        workspaceId,
        marketId: preMarket.id,
        agentId,
        poolContribution: amount,
      });
    });
    const [updated] = await db.select().from(markets)
      .where(and(eq(markets.id, preMarket.id), eq(markets.workspaceId, workspaceId)));
    const newLiq = updated?.liquidity ?? 0;
    res.json({ liquidity: newLiq, poolContribution: amount });
  } catch (e) {
    if (e instanceof AppError) { res.status(e.status).json({ error: e.message }); return; }
    throw e;
  }
}));

// Void an open market: refunds all positions at cost, returns LP pool
// remainder to liquidity providers proportionally, and marks the market as
// voided=true (preserves history). The next market-refresh
// cycle will recreate the market at the same (metricId, targetDate) if the
// time-preference curve still wants one there.
predictionsRouter.post('/markets/:id/void', requireCapability('manage'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const marketId = req.params.id as string;
  const [market] = await db.select().from(markets)
    .where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)));
  if (!market) { res.status(404).json({ error: 'Market not found' }); return; }
  if (market.resolved) { res.status(409).json({ error: 'Market is already resolved or voided' }); return; }
  const result = await voidMarket(market, workspaceId);
  res.json({ voided: true, refundedPositions: result.refunded });
}));

predictionsRouter.post('/resolve', requireCapability('manage'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  res.json(await resolvePredictions(req.body?.targetDate, workspaceId));
}));

/**
 * POST /api/predictions/markets/:id/resolve
 * Admin-only force-resolve for a single market, regardless of targetDate.
 * Use to settle a market early (e.g. to test payouts in CI without waiting
 * for the daily cron). Resolves at the metric's current `total`.
 * Returns 404 if the market doesn't exist, 409 if already resolved.
 */
predictionsRouter.post('/markets/:id/resolve', requireCapability('manage'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const marketId = req.params.id as string;
  const [market] = await db.select().from(markets)
    .where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)));
  if (!market) { res.status(404).json({ error: 'Market not found' }); return; }
  if (market.resolved) { res.status(409).json({ error: 'Market is already resolved' }); return; }
  const result = await resolveSingleMarket(marketId, workspaceId);
  if (result.skipped) {
    res.status(409).json({ error: 'Could not resolve (metric value missing/negative or already resolved)' });
    return;
  }
  res.json({ resolved: true, totalPayout: result.totalPayout });
}));

predictionsRouter.post('/markets/refresh', requireCapability('manage'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const proposalId = typeof req.body?.proposalId === 'string' ? req.body.proposalId : undefined;
  if (proposalId) {
    const [proposal] = await db.select().from(proposals)
      .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
    if (!proposal) { res.status(404).json({ error: 'Proposal not found' }); return; }
    const existingIds = (proposal.conditionalMarketIds as string[]) ?? [];
    const subsidy = proposal.liquiditySubsidy ?? 0;
    const marketIds = await createConditionalMarkets(proposalId, workspaceId, {
      subsidyPerMarket: subsidy,
      proposerAgentId: subsidy > 0 ? proposal.proposedBy : null,
    });
    await db.update(proposals).set({ conditionalMarketIds: marketIds })
      .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
    const reused = existingIds.length > 0 && existingIds.length === marketIds.length &&
      existingIds.every(id => marketIds.includes(id));
    res.json({ created: reused ? 0 : marketIds.length, deactivated: 0, deduplicated: 0 });
    return;
  }
  const force = req.body?.force === true;
  res.json(await refreshRelativeDateMarkets(workspaceId, { force }));
}));

predictionsRouter.post('/markets/notify', requireCapability('manage'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const { metricId, metricName } = req.body || {};
  if (!metricId && !metricName) {
    res.status(400).json({ error: 'metricId or metricName is required' }); return;
  }
  let targetMetricId = metricId ?? null;
  if (!targetMetricId && metricName) {
    const allMetrics = await getAllMetrics(workspaceId);
    const m = allMetrics.find(x => x.name === metricName);
    if (!m) { res.status(404).json({ error: 'Metric not found' }); return; }
    targetMetricId = m.id;
  }
  const openMarkets = await db.select().from(markets)
    .where(and(eq(markets.workspaceId, workspaceId), eq(markets.metricId, targetMetricId), eq(markets.resolved, false)));
  for (const m of openMarkets) {
    await emitEvent('market:created', { marketId: m.id, metricName: m.metricName, targetDate: m.targetDate }, workspaceId);
  }
  res.json({ emitted: openMarkets.length });
}));
