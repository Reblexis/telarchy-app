/**
 * A FAULT REFUND COUNTS IN THE SEASON SCORE, ON THE MARKET IT NAMES.
 *
 * docs/seasons.md, "A fault refund counts": the platform repaying what its
 * own fault cost a holder on one market is money back on that market, so it
 * is scored with that market: when the market settled inside the window, on
 * a floor the season scores. A grant, an apology or an adjustment never is.
 *
 * The case it exists for: on 2026-09-16 the snake's length book changed from
 * an hourly cell to one book per attempt with no notice, a trader's bot read
 * the new horizon as runaway growth and lost 1,644 credits in nine seconds.
 * The owner refunded it; the season standings still showed the loss.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { eq } from 'drizzle-orm';
import { agents, creditLedger, markets, positions, trades, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import { loadSeasonMarked, loadSeasonSettled, loadSeasonSettledSplit } from '../lib/board';
import { toUnits } from '../lib/validation';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-fault';
const OTHER_WS = 'ws-elsewhere';
const KAI = 'kai';
const BO = 'bo';
const B = 10;
const RESOLVED_AT = new Date('2026-09-13T03:40:00Z');

function market(overrides: Partial<typeof markets.$inferInsert> & { id: string; workspaceId: string }) {
  return {
    metricId: 'metric',
    metricName: 'Reached length',
    targetDate: '2026-09-13T03:56',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0] as [number, number],
    liquidity: B,
    pool: initialPool(B),
    active: false,
    resolved: true,
    actualValue: 20,
    resolvedAt: RESOLVED_AT,
    voided: false,
    // The season's settled half starts from traded books.
    tradedVolume: 10,
    ...overrides,
  };
}

let ledgerSeq = 0;
function ledger(row: {
  agentId: string;
  workspaceId: string;
  credits: number;
  reason: string;
  refType: string | null;
  refId: string | null;
}) {
  ledgerSeq += 1;
  return db.insert(creditLedger).values({
    id: `ledger-${ledgerSeq}`,
    workspaceId: row.workspaceId,
    agentId: row.agentId,
    deltaUnits: toUnits(row.credits),
    balanceAfterUnits: toUnits(row.credits),
    reason: row.reason,
    refType: row.refType,
    refId: row.refId,
  } as typeof creditLedger.$inferInsert);
}

/** kai holds 10 higher on each market; resolved at 20 of [0, 100] each pays 2. */
async function holding(agentId: string, workspaceId: string, marketId: string, cost: number) {
  await db.insert(positions).values({
    id: `p-${agentId}-${marketId}`,
    agentId,
    workspaceId,
    marketId,
    direction: 'higher',
    shares: 10,
    totalCost: cost,
  });
  await db.insert(trades).values({
    id: `t-${agentId}-${marketId}`,
    agentId,
    workspaceId,
    marketId,
    direction: 'higher',
    shares: 10,
    cost,
    createdAt: new Date('2026-09-13T03:30:00Z'),
  });
}

beforeAll(async () => {
  await ensureMigrations();
});

beforeEach(async () => {
  await truncateAll();
  await db.insert(workspaces).values([
    { id: WS, name: 'Snake', createdBy: 'owner', visibility: 'public' },
    { id: OTHER_WS, name: 'Elsewhere', createdBy: 'owner', visibility: 'public' },
  ]);
  await db.insert(agents).values([
    { id: KAI, apiKeyHash: 'h-kai', balance: 0 },
    { id: BO, apiKeyHash: 'h-bo', balance: 0 },
  ]);
  await db
    .insert(markets)
    .values([
      market({ id: 'm-lost', workspaceId: WS }),
      market({ id: 'm-won', workspaceId: WS, actualValue: 60 }),
      market({ id: 'm-away', workspaceId: OTHER_WS }),
    ]);
  // m-lost: paid 6, worth 2 -> -4. m-won: paid 5, worth 6 -> +1. Net -3 in WS.
  await holding(KAI, WS, 'm-lost', 6);
  await holding(KAI, WS, 'm-won', 5);
  // m-away: paid 7, worth 2 -> -5, in the other workspace.
  await holding(KAI, OTHER_WS, 'm-away', 7);
  // bo, untouched by any refund, is the control.
  await holding(BO, WS, 'm-won', 3);
});

const START = new Date('2026-09-01T00:00:00Z');
const END = new Date('2026-10-01T00:00:00Z');

function refund(overrides: Partial<Parameters<typeof ledger>[0]> = {}) {
  return ledger({
    agentId: KAI,
    workspaceId: WS,
    credits: 3,
    reason: 'fault_refund',
    refType: 'market',
    refId: 'm-lost',
    ...overrides,
  });
}

describe('A FAULT REFUND COUNTS IN THE SEASON SCORE, ON THE MARKET IT NAMES', () => {
  test('without a refund the season shows the loss (the baseline the rule changes)', async () => {
    const s = await loadSeasonSettled([WS], START, END);
    expect(s.get(KAI)).toBeCloseTo(-3, 6);
    expect(s.get(BO)).toBeCloseTo(3, 6);
  });

  test('the season still showed the 1,644 credits a rule change took (2026-09-16): a refund of the net loss brings the season score back to zero', async () => {
    await refund();
    const s = await loadSeasonSettled([WS], START, END);
    expect(s.get(KAI)).toBeCloseTo(0, 6);
  });

  test('nobody else moves', async () => {
    await refund();
    expect((await loadSeasonSettled([WS], START, END)).get(BO)).toBeCloseTo(3, 6);
  });

  test('the marked standings carry it too, because the settled half is where it is added', async () => {
    await refund();
    expect((await loadSeasonMarked([WS], START, END)).get(KAI)).toBeCloseTo(0, 6);
  });

  test('the standings scoped to one floor carry it: it is trading money on that floor, unlike a transfer', async () => {
    await refund();
    expect((await loadSeasonSettled([WS], START, END, { floorOnly: true })).get(KAI)).toBeCloseTo(0, 6);
  });

  test('a refund on a market that settled BEFORE the window does not count, as the market does not', async () => {
    await refund();
    const s = await loadSeasonSettled([WS], new Date('2026-09-14T00:00:00Z'), END);
    expect(s.get(KAI) ?? 0).toBe(0);
  });

  test('a refund on a market that settled AFTER the window does not count, whenever it was paid', async () => {
    await refund();
    const s = await loadSeasonSettled([WS], START, new Date('2026-09-13T00:00:00Z'));
    expect(s.get(KAI) ?? 0).toBe(0);
  });

  test('a market settling exactly at the end instant counts, and so does its refund', async () => {
    await refund();
    expect((await loadSeasonSettled([WS], START, RESOLVED_AT)).get(KAI)).toBeCloseTo(0, 6);
  });

  test('a market settling exactly at the start instant does not count, and neither does its refund', async () => {
    await refund();
    expect((await loadSeasonSettled([WS], RESOLVED_AT, END)).get(KAI) ?? 0).toBe(0);
  });

  test('a refund counts only when the season scores the floor its market is on', async () => {
    await refund({ workspaceId: OTHER_WS, credits: 5, refId: 'm-away' });
    expect((await loadSeasonSettled([WS], START, END)).get(KAI)).toBeCloseTo(-3, 6);
    expect((await loadSeasonSettled([OTHER_WS], START, END)).get(KAI)).toBeCloseTo(0, 6);
    expect((await loadSeasonSettled([WS, OTHER_WS], START, END)).get(KAI)).toBeCloseTo(-3, 6);
  });

  test('an apology grant, an admin adjustment or a signup grant never enters the season score', async () => {
    await ledger({
      agentId: KAI,
      workspaceId: WS,
      credits: 1000,
      reason: 'admin_adjustment',
      refType: null,
      refId: 'apology',
    });
    await ledger({
      agentId: KAI,
      workspaceId: 'platform',
      credits: 500,
      reason: 'signup_grant',
      refType: null,
      refId: null,
    });
    await ledger({
      agentId: KAI,
      workspaceId: WS,
      credits: 9,
      reason: 'admin_adjustment',
      refType: 'market',
      refId: 'm-lost',
    });
    expect((await loadSeasonSettled([WS], START, END)).get(KAI)).toBeCloseTo(-3, 6);
  });

  test('a fault_refund row that names no market is not counted', async () => {
    await refund({ refType: null });
    await refund({ refType: 'proposal' });
    expect((await loadSeasonSettled([WS], START, END)).get(KAI)).toBeCloseTo(-3, 6);
  });

  test('a market id that exists nowhere counts nothing', async () => {
    await refund({ refId: 'm-gone' });
    expect((await loadSeasonSettled([WS, OTHER_WS], START, END)).get(KAI)).toBeCloseTo(-8, 6);
  });

  test('a market id that exists on two scored floors counts the refund once, on the floor it was booked in', async () => {
    await db.insert(markets).values(market({ id: 'm-lost', workspaceId: OTHER_WS }));
    await refund();
    expect((await loadSeasonSettled([WS, OTHER_WS], START, END)).get(KAI)).toBeCloseTo(-5, 6);
    expect((await loadSeasonSettled([OTHER_WS], START, END)).get(KAI)).toBeCloseTo(-5, 6);
  });

  test('several refunds to the same holder add up', async () => {
    await refund({ credits: 1 });
    await refund({ credits: 2 });
    expect((await loadSeasonSettled([WS], START, END)).get(KAI)).toBeCloseTo(0, 6);
  });

  test('a refund on a cancelled market counts on top of the void refund', async () => {
    await db.insert(markets).values(market({ id: 'm-void', workspaceId: WS, voided: true, actualValue: null }));
    await holding(KAI, WS, 'm-void', 4);
    const before = (await loadSeasonSettled([WS], START, END)).get(KAI)!;
    await refund({ credits: 2, refId: 'm-void' });
    expect((await loadSeasonSettled([WS], START, END)).get(KAI)).toBeCloseTo(before + 2, 6);
  });

  test("a bot's refund reaches its owner's entry once, and the bot keeps its own number", async () => {
    await db.insert(agents).values({ id: 'owner-of-kai', apiKeyHash: 'h-own', balance: 0 });
    await db.update(agents).set({ ownerAgentId: 'owner-of-kai' }).where(eq(agents.id, KAI));
    await refund();
    const split = await loadSeasonSettledSplit([WS], START, END);
    expect(split.ownById.get(KAI)).toBeCloseTo(0, 6);
    expect(split.byId.get('owner-of-kai')).toBeCloseTo(0, 6);
  });
});
