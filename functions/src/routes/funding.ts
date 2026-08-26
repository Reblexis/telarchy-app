/**
 * Funding packages, the liquidity budget and its allocation, and workspace
 * prize pools (docs/liquidity.md, docs/workspace-pools.md). Mounted at
 * /api/workspaces beside the workspaces router; every route acts on the
 * path workspace and re-checks capabilities against it, the way
 * PUT /:id/settings does.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client';
import { fundingPurchases, markets, metrics as metricsTable, workspaces } from '../db/schema';
import { AppError } from '../lib/errors';
import {
  CREDITS_PER_USD,
  MAX_PURCHASE_CENTS,
  MIN_PURCHASE_CENTS,
  POOL_FRACTION_BP,
  parseMonthKey,
} from '../lib/funding';
import { publicOrigin } from '../lib/origin';
import { fromUnits, MIN_LIQUIDITY_CONTRIBUTION, toUnits } from '../lib/validation';
import { wrap } from '../lib/wrap';
import { computeCapabilities } from '../middleware/capabilities';
import { requireCapability } from '../middleware/roles';
import { createFundingCheckout, fundingEnabled } from '../services/funding';
import { metricWeight, readBudgetUnits } from '../services/liquidityBudget';
import { applyAgentLiquidityInjectionTx } from '../services/marketLiquidity';
import { computePoolBoard, listPools } from '../services/workspacePools';
import type { AuthInfo } from '../types';

export const fundingRouter = Router();

async function capsFor(auth: AuthInfo, wsId: string) {
  return wsId === auth.workspaceId
    ? auth.capabilities
    : await computeCapabilities({
        workspaceId: wsId,
        uid: auth.uid,
        agentId: auth.agentId,
        isMasterKey: auth.isMasterKey,
      });
}

async function loadWorkspace(wsId: string) {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
  if (!ws) throw new AppError('Workspace not found', 404);
  return ws;
}

/** manage_workspace on the path workspace: the owner's own money and steering wheel. */
async function requireOwnerOnPath(req: { auth?: AuthInfo; params: Record<string, unknown> }): Promise<string> {
  const wsId = String(req.params.id);
  await loadWorkspace(wsId);
  const caps = await capsFor(req.auth!, wsId);
  if (!caps.has('manage_workspace'))
    throw new AppError('This requires the manage_workspace capability on this workspace', 403);
  return wsId;
}

// ---------------------------------------------------------------------------
// Funding packages
// ---------------------------------------------------------------------------

fundingRouter.post(
  '/:id/funding/checkout',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const wsId = await requireOwnerOnPath(req);
    if (!fundingEnabled()) {
      res.status(503).json({ error: 'Funding packages are not enabled on this instance' });
      return;
    }
    const amountCents = Number(req.body?.amountCents);
    if (!Number.isInteger(amountCents) || amountCents < MIN_PURCHASE_CENTS || amountCents > MAX_PURCHASE_CENTS) {
      res
        .status(400)
        .json({ error: `amountCents must be an integer between ${MIN_PURCHASE_CENTS} and ${MAX_PURCHASE_CENTS}` });
      return;
    }
    const origin = publicOrigin();
    const returnPath =
      typeof req.body?.returnPath === 'string' && req.body.returnPath.startsWith('/') ? req.body.returnPath : '/manage';
    const { purchaseId, url } = await createFundingCheckout({
      workspaceId: wsId,
      buyerAgentId: req.auth!.agentId ?? null,
      amountCents,
      successUrl: id => `${origin}${returnPath}?funding=paid&purchase=${id}`,
      cancelUrl: `${origin}${returnPath}?funding=cancelled`,
    });
    res.json({ purchaseId, url });
  }),
);

fundingRouter.get(
  '/:id/funding',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const wsId = await requireOwnerOnPath(req);
    const budgetUnits = await readBudgetUnits(db, wsId);
    const purchases = await db
      .select()
      .from(fundingPurchases)
      .where(eq(fundingPurchases.workspaceId, wsId))
      .orderBy(sql`${fundingPurchases.createdAt} desc`);
    const pools = await listPools(wsId);
    res.json({
      enabled: fundingEnabled(),
      rates: { creditsPerUsd: CREDITS_PER_USD, poolFractionBp: POOL_FRACTION_BP, minPurchaseCents: MIN_PURCHASE_CENTS },
      budget: { units: budgetUnits, credits: fromUnits(budgetUnits) },
      purchases: purchases.map(p => ({
        id: p.id,
        amountCents: p.amountCents,
        credits: fromUnits(Number(p.creditsUnits)),
        poolCents: p.poolCents,
        poolMonth: p.poolMonth,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
        paidAt: p.paidAt ? p.paidAt.toISOString() : null,
      })),
      pools: pools.map(p => ({
        month: p.month,
        poolCents: p.poolCents,
        rolloverCents: p.rolloverCents,
        totalCents: p.poolCents + p.rolloverCents,
        status: p.status,
        distributedCents: p.distributedCents,
      })),
    });
  }),
);

// ---------------------------------------------------------------------------
// Allocation
// ---------------------------------------------------------------------------

fundingRouter.get(
  '/:id/liquidity',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const wsId = await requireOwnerOnPath(req);
    const ws = await loadWorkspace(wsId);
    const budgetUnits = await readBudgetUnits(db, wsId);
    const rows = await db
      .select({
        id: markets.id,
        metricId: markets.metricId,
        metricName: markets.metricName,
        targetDate: markets.targetDate,
        pool: markets.pool,
        liquidity: markets.liquidity,
        proposalId: markets.proposalId,
      })
      .from(markets)
      .where(and(eq(markets.workspaceId, wsId), eq(markets.active, true), eq(markets.resolved, false)));
    const metricRows = await db
      .select({ id: metricsTable.id, name: metricsTable.name })
      .from(metricsTable)
      .where(eq(metricsTable.workspaceId, wsId));
    res.json({
      budget: { units: budgetUnits, credits: fromUnits(budgetUnits) },
      autoFund: { enabled: ws.autoFundNewMarkets, creditsPerMarket: ws.newMarketLiquidityCredits },
      weights: ws.liquidityWeights ?? {},
      metrics: metricRows.map(m => ({ id: m.id, name: m.name, weight: metricWeight(ws.liquidityWeights, m.id) })),
      markets: rows.map(r => ({
        id: r.id,
        metricId: r.metricId,
        metricName: r.metricName,
        targetDate: r.targetDate,
        pool: r.pool ?? 0,
        b: r.liquidity,
        proposalId: r.proposalId,
      })),
    });
  }),
);

fundingRouter.put(
  '/:id/liquidity/weights',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const wsId = await requireOwnerOnPath(req);
    const body = req.body?.weights ?? req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ error: 'weights must be an object of { [metricId]: weight >= 0 }' });
      return;
    }
    const known = new Set(
      (await db.select({ id: metricsTable.id }).from(metricsTable).where(eq(metricsTable.workspaceId, wsId))).map(
        m => m.id,
      ),
    );
    const clean: Record<string, number> = {};
    for (const [metricId, w] of Object.entries(body as Record<string, unknown>)) {
      if (!known.has(metricId)) {
        res.status(400).json({ error: `Unknown metric ${metricId}` });
        return;
      }
      if (typeof w !== 'number' || !Number.isFinite(w) || w < 0 || w > 1000) {
        res.status(400).json({ error: `weight for ${metricId} must be a number between 0 and 1000` });
        return;
      }
      if (w !== 1) clean[metricId] = w;
    }
    await db.update(workspaces).set({ liquidityWeights: clean }).where(eq(workspaces.id, wsId));
    res.json({ weights: clean });
  }),
);

/**
 * Spread the budget: fund every active market up to a target pool, largest
 * shortfall first, until the target or the budget is reached.
 */
fundingRouter.post(
  '/:id/liquidity/spread',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const wsId = await requireOwnerOnPath(req);
    const targetPool = Number(req.body?.targetPool);
    if (!Number.isFinite(targetPool) || targetPool <= 0) {
      res.status(400).json({ error: 'targetPool must be a positive number of credits' });
      return;
    }
    const onlyMetricIds: string[] | null = Array.isArray(req.body?.metricIds) ? req.body.metricIds.map(String) : null;
    const rows = await db
      .select({ id: markets.id, metricId: markets.metricId, pool: markets.pool })
      .from(markets)
      .where(
        and(
          eq(markets.workspaceId, wsId),
          eq(markets.active, true),
          eq(markets.resolved, false),
          ...(onlyMetricIds && onlyMetricIds.length ? [inArray(markets.metricId, onlyMetricIds)] : []),
        ),
      );
    const shortfalls = rows
      .map(r => ({ id: r.id, need: Math.round((targetPool - (r.pool ?? 0)) * 1e6) / 1e6 }))
      .filter(r => r.need >= MIN_LIQUIDITY_CONTRIBUTION)
      .sort((a, b) => b.need - a.need);
    let remaining = await readBudgetUnits(db, wsId);
    const funded: Array<{ marketId: string; amount: number }> = [];
    await db.transaction(async tx => {
      for (const s of shortfalls) {
        const amount = Math.min(s.need, fromUnits(remaining));
        if (amount < MIN_LIQUIDITY_CONTRIBUTION) break;
        await applyAgentLiquidityInjectionTx(tx, {
          workspaceId: wsId,
          marketId: s.id,
          agentId: null,
          source: 'budget',
          poolContribution: amount,
        });
        remaining -= toUnits(amount);
        funded.push({ marketId: s.id, amount });
      }
    });
    res.json({ funded, budgetRemaining: fromUnits(remaining) });
  }),
);

// ---------------------------------------------------------------------------
// Pools (public: the board is the per-workspace leaderboard for the month)
// ---------------------------------------------------------------------------

fundingRouter.get(
  '/:id/pools',
  requireCapability('read'),
  wrap(async (req, res) => {
    const wsId = String(req.params.id);
    await loadWorkspace(wsId);
    const pools = await listPools(wsId);
    res.json({
      pools: pools.map(p => ({
        month: p.month,
        poolCents: p.poolCents,
        rolloverCents: p.rolloverCents,
        totalCents: p.poolCents + p.rolloverCents,
        status: p.status,
        distributedCents: p.distributedCents,
        rulesPath: p.status === 'scheduled' ? null : `/api/legal/pools/${wsId}/${p.month}`,
      })),
    });
  }),
);

fundingRouter.get(
  '/:id/pools/:month',
  requireCapability('read'),
  wrap(async (req, res) => {
    const wsId = String(req.params.id);
    const month = String(req.params.month);
    if (!parseMonthKey(month)) {
      res.status(400).json({ error: 'month must be YYYY-MM' });
      return;
    }
    await loadWorkspace(wsId);
    const board = await computePoolBoard(wsId, month);
    if (!board) {
      res.status(404).json({ error: 'No pool for that month' });
      return;
    }
    res.json(board);
  }),
);
