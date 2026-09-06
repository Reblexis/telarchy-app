/**
 * A conditional pair prices the difference from the baseline
 * (docs/guides/creating.md, "A conditional pair prices the difference from
 * the baseline"; docs/market-integrity.md I1c). Each branch's book holds
 * "how far will the metric land from the baseline's forecast if this branch
 * happens", opens at zero, is untouched by the baseline moving, and settles
 * at the actual value minus the baseline recorded when the owner decided.
 * Pairs from before the rule that anyone had traded keep pricing the level
 * and settle at the actual value; untraded ones are reopened as difference
 * books. Owner decision 2026-09-05 (notes/conditional-markets-as-difference-
 * 2026-09-05.md in the telarchy umbrella).
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { and, eq } from 'drizzle-orm';
import {
  agents,
  liquidityEvents,
  markets,
  metricLogs,
  metrics as metricsTable,
  positions,
  proposals,
  trades,
  workspaces,
} from '../db/schema';
import { consensus, initialPool } from '../lib/amm';
import { toUnits } from '../lib/validation';
import { resolveSingleMarket } from '../services/predictions';
import {
  approveProposal,
  createConditionalMarkets,
  declineProposal,
  getProposalMarketSummariesForProposal,
} from '../services/proposals';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-diff';
const OWNER = 'agent-diff-owner';
const PROPOSER = 'agent-diff-proposer';
const HOLDER = 'agent-diff-holder';
const METRIC = 'metric-diff';
const BASELINE = 'mkt-diff-base';
const PROPOSAL = 'prop-diff';
// The settle date is in the past so a reading can be dated inside its period
// and the branch can be resolved in the test.
const DATE = '2020';

// Baseline on [0, 100] seeded to consensus 60: b = 100, diff = b*ln(.6/.4).
const BASE_B = 100;
const diffFor = (p: number) => BASE_B * Math.log(p / (1 - p));

async function seed(opts: { metricName?: string; baselineFunded?: boolean; metricValue?: number } = {}) {
  const metricName = opts.metricName ?? 'Throughput';
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-diff-owner', balance: toUnits(1000) },
    { id: PROPOSER, apiKeyHash: 'h-diff-proposer', balance: toUnits(1000) },
    { id: HOLDER, apiKeyHash: 'h-diff-holder', balance: toUnits(1000) },
  ]);
  await db.insert(workspaces).values({ id: WS, name: 'Diff', createdBy: OWNER, visibility: 'public' });
  await db.insert(metricsTable).values({
    id: METRIC,
    workspaceId: WS,
    name: metricName,
    value: opts.metricValue ?? 55,
    formula: '0',
    marketRangeMax: 100,
  });
  const funded = opts.baselineFunded ?? true;
  await db.insert(markets).values({
    id: BASELINE,
    workspaceId: WS,
    metricId: METRIC,
    metricName,
    targetDate: DATE,
    rangeMin: 0,
    rangeMax: 100,
    shares: funded ? [0, diffFor(0.6)] : [0, 0],
    liquidity: funded ? BASE_B : 0,
    pool: funded ? initialPool(BASE_B) : 0,
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
    branch: null,
  });
}

async function seedProposal(opts: { askUsd?: number; title?: string } = {}) {
  const askUsd = opts.askUsd ?? 0;
  await db.insert(proposals).values({
    id: PROPOSAL,
    workspaceId: WS,
    proposedBy: PROPOSER,
    title: opts.title ?? (askUsd > 0 ? `$${askUsd}: do the thing` : 'do the thing'),
    description: '',
    askUsd,
    status: 'pending',
    conditionalMarketIds: [],
    liquiditySubsidy: 20,
    subsidyContributions: { [PROPOSER]: 20 },
    payoutHandle: askUsd > 0 ? 'paid@example.com' : null,
    createdAt: new Date(),
  });
}

async function spawn() {
  const ids = await createConditionalMarkets(PROPOSAL, WS, { contributions: { [PROPOSER]: 20 }, strict: true });
  await db.update(proposals).set({ conditionalMarketIds: ids }).where(eq(proposals.id, PROPOSAL));
  return ids;
}

async function pairRows() {
  const rows = await db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, WS), eq(markets.proposalId, PROPOSAL)));
  const live = rows.filter(m => !m.resolved);
  return {
    all: rows,
    approved: live.find(m => m.branch === 'approved')!,
    declined: live.find(m => m.branch === 'declined')!,
  };
}

const book = (m: { shares: unknown; liquidity: number; rangeMin: number; rangeMax: number }) =>
  consensus(m.shares as [number, number], m.liquidity, m.rangeMin, m.rangeMax);

async function reading(value: number) {
  await db.insert(metricLogs).values({
    id: `log-${value}`,
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Throughput',
    value,
    timestamp: new Date('2020-06-01T00:00:00Z'),
  });
}

async function hold(marketId: string, shares: number, direction: 'higher' | 'lower' = 'higher') {
  await db.insert(positions).values({
    id: `pos-${marketId}-${direction}`,
    workspaceId: WS,
    agentId: HOLDER,
    marketId,
    direction,
    shares,
    totalCost: shares / 2,
  });
}

async function trade(marketId: string) {
  await db.insert(trades).values({
    id: `trade-${marketId}`,
    workspaceId: WS,
    agentId: HOLDER,
    marketId,
    direction: 'higher',
    shares: 10,
    cost: 5,
    createdAt: new Date(),
  });
}

const balanceOf = async (id: string) => (await db.select().from(agents).where(eq(agents.id, id)))[0].balance as number;

/** An older pair, as the rule before difference pricing left it: priced as a
 *  level on the metric's own range, anchored at the baseline. */
async function seedLevelPair(opts: { traded: boolean }) {
  for (const [id, branch] of [
    ['mkt-level-approved', 'approved'],
    ['mkt-level-declined', 'declined'],
  ] as const) {
    await db.insert(markets).values({
      id,
      workspaceId: WS,
      metricId: METRIC,
      metricName: 'Throughput',
      targetDate: DATE,
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, diffFor(0.6)],
      liquidity: BASE_B,
      pool: initialPool(BASE_B),
      active: true,
      resolved: false,
      voided: false,
      proposalId: PROPOSAL,
      branch,
      quotes: 'level',
    });
    // The subsidy record a real spawn writes, which a void refunds.
    await db.insert(liquidityEvents).values({
      id: `liq-${id}`,
      workspaceId: WS,
      marketId: id,
      agentId: PROPOSER,
      amount: initialPool(BASE_B),
      poolContribution: initialPool(BASE_B),
      totalLiquidity: BASE_B,
      type: 'proposal-subsidy',
      fundedFrom: 'balance',
      createdAt: new Date(),
    });
  }
  await db
    .update(proposals)
    .set({ conditionalMarketIds: ['mkt-level-approved', 'mkt-level-declined'] })
    .where(eq(proposals.id, PROPOSAL));
  if (opts.traded) await trade('mkt-level-approved');
}

describe('a conditional pair prices the difference from the baseline', () => {
  test('both branches open at zero on a range half the metric range either side of it', async () => {
    await seed();
    await seedProposal();
    await spawn();
    const { approved, declined } = await pairRows();
    for (const m of [approved, declined]) {
      expect(m.quotes).toBe('difference');
      expect(m.rangeMin).toBe(-50);
      expect(m.rangeMax).toBe(50);
      expect(book(m)).toBeCloseTo(0, 6);
      expect(m.liquidity).toBeGreaterThan(0);
    }
  });

  test('the approved branch of a paid job on net money opens at minus the ask', async () => {
    await seed({ metricName: 'Net revenue (USD)' });
    await seedProposal({ askUsd: 20 });
    await spawn();
    const { approved, declined } = await pairRows();
    expect(book(approved)).toBeCloseTo(-20, 6);
    expect(book(declined)).toBeCloseTo(0, 6);
  });

  test('an unpriced baseline still opens the pair at zero', async () => {
    await seed({ baselineFunded: false });
    await seedProposal();
    await spawn();
    const { approved, declined } = await pairRows();
    expect(book(approved)).toBeCloseTo(0, 6);
    expect(book(declined)).toBeCloseTo(0, 6);
  });

  test('the summary reads the impact as the book and the consensus as baseline plus impact', async () => {
    await seed();
    await seedProposal();
    await spawn();
    const [pair] = await getProposalMarketSummariesForProposal(PROPOSAL, WS);
    expect(pair.quotes).toBe('difference');
    expect(pair.reference).toBeNull();
    expect(pair.baselineConsensus).toBeCloseTo(60, 6);
    expect(pair.approved?.impact).toBeCloseTo(0, 6);
    expect(pair.declined?.impact).toBeCloseTo(0, 6);
    expect(pair.approved?.consensus).toBeCloseTo(60, 6);
    expect(pair.declined?.consensus).toBeCloseTo(60, 6);
    expect(pair.delta).toBeCloseTo(0, 6);
  });

  test('the baseline moving moves neither branch, only the level they read as', async () => {
    await seed();
    await seedProposal();
    await spawn();
    const before = await pairRows();
    // Someone trades the branch to +5, then the baseline moves 60 -> 70.
    await db
      .update(markets)
      .set({ shares: [0, before.approved.liquidity * Math.log(0.55 / 0.45)] })
      .where(eq(markets.id, before.approved.id));
    await db.update(markets).set({ shares: [0, diffFor(0.7)] }).where(eq(markets.id, BASELINE));
    const after = await pairRows();
    expect(book(after.approved)).toBeCloseTo(5, 6);
    expect(book(after.declined)).toBeCloseTo(0, 6);
    const [pair] = await getProposalMarketSummariesForProposal(PROPOSAL, WS);
    expect(pair.approved?.impact).toBeCloseTo(5, 6);
    expect(pair.approved?.consensus).toBeCloseTo(75, 6);
    expect(pair.declined?.consensus).toBeCloseTo(70, 6);
    expect(pair.delta).toBeCloseTo(5, 6);
  });

  test('with no baseline price the level is unknown but the impact and the delta are not', async () => {
    await seed({ baselineFunded: false });
    await seedProposal();
    await spawn();
    const [pair] = await getProposalMarketSummariesForProposal(PROPOSAL, WS);
    expect(pair.baselineConsensus).toBeNull();
    expect(pair.approved?.consensus).toBeNull();
    expect(pair.approved?.impact).toBeCloseTo(0, 6);
    expect(pair.delta).toBeCloseTo(0, 6);
  });
});

describe('deciding records the reference the pair settles against', () => {
  test('approving records the baseline forecast on both branches and in the record', async () => {
    await seed();
    await seedProposal();
    await spawn();
    await approveProposal(PROPOSAL, WS, OWNER);
    const { all } = await pairRows();
    for (const m of all) expect(m.referenceValue).toBeCloseTo(60, 6);
    const [p] = await db.select().from(proposals).where(eq(proposals.id, PROPOSAL));
    const [pair] = p.decidedPricing ?? [];
    expect(pair.baselineConsensus).toBeCloseTo(60, 6);
    expect(pair.approvedImpact).toBeCloseTo(0, 6);
    expect(pair.declinedImpact).toBeCloseTo(0, 6);
    expect(pair.approvedConsensus).toBeCloseTo(60, 6);
  });

  test('declining records it the same way', async () => {
    await seed();
    await seedProposal();
    await spawn();
    await declineProposal(PROPOSAL, WS, OWNER, 'not now');
    const { all } = await pairRows();
    for (const m of all) expect(m.referenceValue).toBeCloseTo(60, 6);
  });

  test('with no baseline price the reference is the metric reading at the decision', async () => {
    await seed({ baselineFunded: false, metricValue: 42 });
    await seedProposal();
    await spawn();
    await approveProposal(PROPOSAL, WS, OWNER);
    const { all } = await pairRows();
    for (const m of all) expect(m.referenceValue).toBeCloseTo(42, 6);
  });

  test('the summary of a decided pair reads the recorded reference', async () => {
    await seed();
    await seedProposal();
    await spawn();
    await approveProposal(PROPOSAL, WS, OWNER);
    const [pair] = await getProposalMarketSummariesForProposal(PROPOSAL, WS);
    expect(pair.reference).toBeCloseTo(60, 6);
    expect(pair.approved?.consensus).toBeCloseTo(60, 6);
  });
});

describe('a difference branch settles at the actual value minus the reference', () => {
  test('a reading above the reference pays the higher side its share of the range', async () => {
    await seed();
    await seedProposal();
    await spawn();
    await approveProposal(PROPOSAL, WS, OWNER);
    const { approved } = await pairRows();
    await hold(approved.id, 100);
    await reading(70);
    const before = await balanceOf(HOLDER);
    const r = await resolveSingleMarket(approved.id, WS);
    expect(r.resolved).toBe(true);
    const [row] = await db.select().from(markets).where(eq(markets.id, approved.id));
    // The book settles at 70 - 60 = +10 on [-50, 50]: p = 0.6.
    expect(row.actualValue).toBeCloseTo(10, 6);
    expect(await balanceOf(HOLDER)).toBe(before + toUnits(60));
  });

  test('a reading below the reference settles negative, which a level book could never do', async () => {
    await seed();
    await seedProposal();
    await spawn();
    await approveProposal(PROPOSAL, WS, OWNER);
    const { approved } = await pairRows();
    await hold(approved.id, 100, 'lower');
    await reading(50);
    const before = await balanceOf(HOLDER);
    const r = await resolveSingleMarket(approved.id, WS);
    expect(r.resolved).toBe(true);
    const [row] = await db.select().from(markets).where(eq(markets.id, approved.id));
    expect(row.actualValue).toBeCloseTo(-10, 6);
    // Lower pays 1 - p = 0.6.
    expect(await balanceOf(HOLDER)).toBe(before + toUnits(60));
  });

  test('a difference past the range settles at the edge', async () => {
    await seed();
    await seedProposal();
    await spawn();
    await approveProposal(PROPOSAL, WS, OWNER);
    const { approved } = await pairRows();
    await hold(approved.id, 100);
    await reading(100);
    const before = await balanceOf(HOLDER);
    await resolveSingleMarket(approved.id, WS);
    const [row] = await db.select().from(markets).where(eq(markets.id, approved.id));
    expect(row.actualValue).toBeCloseTo(40, 6);
    expect(await balanceOf(HOLDER)).toBe(before + toUnits(90));
  });

  test('a difference branch with no reference refuses to settle rather than guess', async () => {
    await seed();
    await seedProposal();
    await spawn();
    const { approved } = await pairRows();
    // Decided outside the platform's own path: status set by hand, no reference.
    await db.update(proposals).set({ status: 'approved' }).where(eq(proposals.id, PROPOSAL));
    await hold(approved.id, 100);
    await reading(70);
    const r = await resolveSingleMarket(approved.id, WS);
    expect(r.skipped).toBe(true);
    const [row] = await db.select().from(markets).where(eq(markets.id, approved.id));
    expect(row.resolved).toBe(false);
  });
});

describe('pairs from before difference pricing', () => {
  test('a market row carries the level rule unless told otherwise', async () => {
    await seed();
    const [row] = await db.select().from(markets).where(eq(markets.id, BASELINE));
    expect(row.quotes).toBe('level');
    expect(row.referenceValue).toBeNull();
  });

  test('a traded level pair is left exactly where trading put it by the refresh', async () => {
    await seed();
    await seedProposal();
    await seedLevelPair({ traded: true });
    const ids = await createConditionalMarkets(PROPOSAL, WS, { contributions: { [PROPOSER]: 20 } });
    expect(ids.sort()).toEqual(['mkt-level-approved', 'mkt-level-declined']);
    const { approved, declined } = await pairRows();
    expect(approved.id).toBe('mkt-level-approved');
    expect(approved.quotes).toBe('level');
    expect(approved.voided).toBe(false);
    expect(book(approved)).toBeCloseTo(60, 6);
    expect(declined.quotes).toBe('level');
  });

  test('an untraded level pair is reopened as a difference book, free', async () => {
    await seed();
    await seedProposal();
    await seedLevelPair({ traded: false });
    const proposerBefore = await balanceOf(PROPOSER);
    const ids = await createConditionalMarkets(PROPOSAL, WS, { contributions: { [PROPOSER]: 20 } });
    expect(ids).not.toContain('mkt-level-approved');
    const { all, approved, declined } = await pairRows();
    const old = all.filter(m => m.id.startsWith('mkt-level-'));
    expect(old.every(m => m.voided)).toBe(true);
    expect(approved.quotes).toBe('difference');
    expect(book(approved)).toBeCloseTo(0, 6);
    expect(declined.quotes).toBe('difference');
    expect(approved.rangeMin).toBe(-50);
    // The old books' subsidy came back (2 x initialPool(100)) and the new
    // books took their contribution again (2 x 20).
    const expected = proposerBefore + toUnits(2 * initialPool(BASE_B)) - toUnits(40);
    // Refunds are paid to the cent.
    expect(Math.abs((await balanceOf(PROPOSER)) - expected)).toBeLessThan(toUnits(0.02));
  });

  test('a branch missing beside a traded level branch spawns as a level book, never a mixed pair', async () => {
    await seed();
    await seedProposal();
    await seedLevelPair({ traded: true });
    await db.delete(markets).where(eq(markets.id, 'mkt-level-declined'));
    await createConditionalMarkets(PROPOSAL, WS, { contributions: { [PROPOSER]: 20 } });
    const { approved, declined } = await pairRows();
    expect(approved.id).toBe('mkt-level-approved');
    expect(declined.quotes).toBe('level');
    expect(declined.rangeMin).toBe(0);
    expect(declined.rangeMax).toBe(100);
    // A level branch opens at the baseline, as the old rule had it.
    expect(book(declined)).toBeCloseTo(60, 0);
  });

  test('a pair with one traded branch keeps both branches as they are', async () => {
    await seed();
    await seedProposal();
    await seedLevelPair({ traded: true });
    await createConditionalMarkets(PROPOSAL, WS, { contributions: { [PROPOSER]: 20 } });
    const { approved, declined } = await pairRows();
    expect(approved.id).toBe('mkt-level-approved');
    expect(declined.id).toBe('mkt-level-declined');
  });

  test('a level pair reads and decides as it always did', async () => {
    await seed();
    await seedProposal();
    await seedLevelPair({ traded: true });
    const [pair] = await getProposalMarketSummariesForProposal(PROPOSAL, WS);
    expect(pair.quotes).toBe('level');
    expect(pair.approved?.impact).toBeNull();
    expect(pair.approved?.consensus).toBeCloseTo(60, 6);
    expect(pair.delta).toBeCloseTo(0, 6);
    await approveProposal(PROPOSAL, WS, OWNER);
    const { all } = await pairRows();
    for (const m of all) expect(m.referenceValue).toBeNull();
  });

  test('a level branch settles at the actual value, not at a difference', async () => {
    await seed();
    await seedProposal();
    await seedLevelPair({ traded: true });
    await approveProposal(PROPOSAL, WS, OWNER);
    await hold('mkt-level-approved', 100);
    await reading(70);
    const before = await balanceOf(HOLDER);
    const r = await resolveSingleMarket('mkt-level-approved', WS);
    expect(r.resolved).toBe(true);
    const [row] = await db.select().from(markets).where(eq(markets.id, 'mkt-level-approved'));
    expect(row.actualValue).toBeCloseTo(70, 6);
    expect(await balanceOf(HOLDER)).toBe(before + toUnits(70));
  });
});
