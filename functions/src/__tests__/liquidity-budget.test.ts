/**
 * The liquidity budget wall (docs/liquidity.md): bought credits can only
 * become market liquidity on their workspace, and what comes back comes
 * back to the budget. Against a real database, because the wall is a set
 * of writers, not an arithmetic rule.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { agents, creditLedger, liquidityBudgetLedger, liquidityEvents, markets, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { toUnits } from '../lib/validation';
import { applyBudget, applyBudgetIfSufficient, readBudgetUnits } from '../services/liquidityBudget';
import { applyAgentLiquidityInjectionTx } from '../services/marketLiquidity';
import { distributeLPLeftover, planOwnerFunding } from '../services/markets';
import { ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-1';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values({ id: 'owner', apiKeyHash: 'h', balance: toUnits(100), nickname: 'owner' });
  await db.insert(workspaces).values({ id: WS, name: 'W', slug: 'w', createdBy: 'owner', visibility: 'public' });
  await db.insert(markets).values({
    id: 'm1',
    workspaceId: WS,
    metricId: 'metric-1',
    metricName: 'Revenue',
    targetDate: '2028',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 100,
    pool: initialPool(100),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
  });
});

test('a debit the budget cannot cover applies nothing; a credit is ledgered', async () => {
  expect(
    await applyBudgetIfSufficient(db, { workspaceId: WS, deltaUnits: -toUnits(1), reason: 'injection' }),
  ).toBeNull();
  await applyBudget(db, {
    workspaceId: WS,
    deltaUnits: toUnits(500),
    reason: 'purchase',
    refType: 'purchase',
    refId: 'p1',
  });
  expect(await readBudgetUnits(db, WS)).toBe(toUnits(500));
  const rows = await db.select().from(liquidityBudgetLedger).where(eq(liquidityBudgetLedger.workspaceId, WS));
  expect(rows.map(r => r.reason)).toEqual(['purchase']);
  expect(Number(rows[0].balanceAfterUnits)).toBe(toUnits(500));
});

test('an injection from the budget funds the market, touches no balance, and is marked budget-funded', async () => {
  await applyBudget(db, { workspaceId: WS, deltaUnits: toUnits(500), reason: 'purchase' });
  await db.transaction(async tx => {
    await applyAgentLiquidityInjectionTx(tx, {
      workspaceId: WS,
      marketId: 'm1',
      agentId: null,
      source: 'budget',
      poolContribution: 200,
    });
  });
  expect(await readBudgetUnits(db, WS)).toBe(toUnits(300));
  const [m] = await db
    .select()
    .from(markets)
    .where(and(eq(markets.id, 'm1'), eq(markets.workspaceId, WS)));
  expect(m.pool).toBeCloseTo(initialPool(100) + 200, 6);
  const [ev] = await db.select().from(liquidityEvents).where(eq(liquidityEvents.marketId, 'm1'));
  expect(ev.fundedBy).toBe('budget');
  expect(ev.agentId).toBeNull();
  expect(await db.select().from(creditLedger)).toEqual([]);
  const [owner] = await db.select().from(agents).where(eq(agents.id, 'owner'));
  expect(Number(owner.balance)).toBe(toUnits(100));
});

test('an injection larger than the budget is refused, not taken from the owner', async () => {
  await applyBudget(db, { workspaceId: WS, deltaUnits: toUnits(50), reason: 'purchase' });
  await expect(
    db.transaction(async tx => {
      await applyAgentLiquidityInjectionTx(tx, {
        workspaceId: WS,
        marketId: 'm1',
        agentId: 'owner',
        source: 'budget',
        poolContribution: 80,
      });
    }),
  ).rejects.toThrow(/Insufficient liquidity budget/);
  expect(await readBudgetUnits(db, WS)).toBe(toUnits(50));
  const [owner] = await db.select().from(agents).where(eq(agents.id, 'owner'));
  expect(Number(owner.balance)).toBe(toUnits(100));
});

test('pool leftover from budget-funded liquidity returns to the budget, agent-funded to the agent', async () => {
  await db.insert(liquidityEvents).values([
    {
      id: 'e1',
      workspaceId: WS,
      marketId: 'm1',
      amount: 300,
      poolContribution: 300,
      totalLiquidity: 1,
      type: 'injection',
      agentId: null,
      fundedBy: 'budget',
    },
    {
      id: 'e2',
      workspaceId: WS,
      marketId: 'm1',
      amount: 100,
      poolContribution: 100,
      totalLiquidity: 1,
      type: 'injection',
      agentId: 'owner',
      fundedBy: 'agent',
    },
  ]);
  await db.transaction(async tx => {
    await distributeLPLeftover(tx, 'm1', 40, WS);
  });
  expect(await readBudgetUnits(db, WS)).toBe(toUnits(30));
  const [owner] = await db.select().from(agents).where(eq(agents.id, 'owner'));
  expect(Number(owner.balance)).toBe(toUnits(110));
  const budgetRows = await db.select().from(liquidityBudgetLedger);
  expect(budgetRows.map(r => r.reason)).toEqual(['lp_leftover']);
});

test('auto-fund draws the budget first, the owner second, weights the amount, and stops when both are empty', () => {
  const plan = planOwnerFunding({
    items: [
      { key: 'a', metricId: 'x' },
      { key: 'b', metricId: 'y' },
      { key: 'c', metricId: 'x' },
      { key: 'd', metricId: 'z' },
    ],
    credits: 100,
    weights: { y: 0.5, z: 0 },
    budgetUnits: toUnits(120),
    ownerBalanceUnits: toUnits(100),
  });
  expect(plan).toEqual([
    { key: 'a', amount: 100, source: 'budget' },
    { key: 'b', amount: 50, source: 'agent' }, // budget has 20 left, owner covers 50
    { key: 'c', amount: 100, source: null }, // owner has 50 left
    { key: 'd', amount: 0, source: null }, // weight 0: by hand
  ]);
});
