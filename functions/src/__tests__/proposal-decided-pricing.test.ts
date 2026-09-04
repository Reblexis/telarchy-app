/**
 * A decision records the pair prices it was made on.
 *
 * docs/ui-conventions.md, "Top contractors" (owner ruling 2026-09-04): a
 * decided proposal is valued at the moment the owner ruled. The pair's
 * prices are written to proposals.decidedPricing on approval or decline,
 * before either branch is voided, and never re-read from the books.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { and, eq } from 'drizzle-orm';
import { agents, type DecidedPair, markets, metrics as metricsTable, proposals, workspaces } from '../db/schema';
import { consensus, initialPool } from '../lib/amm';
import { toUnits } from '../lib/validation';
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

const WS = 'ws-decided';
const OWNER = 'owner-decided';
const PROPOSER = 'proposer-decided';
const METRIC = 'metric-decided';
const TARGET = '2026-12';

async function seed() {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-owner-decided', balance: toUnits(1000) },
    { id: PROPOSER, apiKeyHash: 'h-proposer-decided', balance: toUnits(1000) },
  ]);
  await db.insert(workspaces).values({ id: WS, name: 'Decided', createdBy: OWNER, visibility: 'private' });
  await db.insert(metricsTable).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Active traders',
    value: 20,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: 'mkt-base',
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Active traders',
    targetDate: TARGET,
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 20],
    liquidity: 100,
    pool: initialPool(100),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
    branch: null,
  });
  await db.insert(proposals).values({
    id: 'p1',
    workspaceId: WS,
    proposedBy: PROPOSER,
    title: 'Write 500 words',
    description: '',
    status: 'pending',
    conditionalMarketIds: [],
    liquiditySubsidy: 0,
  });
  await createConditionalMarkets('p1', WS, { contributions: { [PROPOSER]: 50 } });
}

async function branchPrices() {
  const rows = await db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, WS), eq(markets.proposalId, 'p1')));
  const price = (branch: string) => {
    const m = rows.find(r => r.branch === branch)!;
    return consensus(m.shares as [number, number], m.liquidity, m.rangeMin, m.rangeMax) ?? null;
  };
  return { approved: price('approved'), declined: price('declined'), rows };
}

async function decidedPricing(): Promise<DecidedPair[] | null> {
  const [p] = await db.select({ d: proposals.decidedPricing }).from(proposals).where(eq(proposals.id, 'p1'));
  return p.d ?? null;
}

describe('a decision records the pair prices it was made on', () => {
  test('a pending proposal has no decision pricing', async () => {
    await seed();
    expect(await decidedPricing()).toBeNull();
  });

  test('approving records both branches at their price at that moment, before the declined branch is voided', async () => {
    await seed();
    // Move the declined branch so the two sides differ and the record is
    // distinguishable from a fresh open.
    const before = await branchPrices();
    const declined = before.rows.find(r => r.branch === 'declined')!;
    await db
      .update(markets)
      .set({ shares: [30, 0] })
      .where(and(eq(markets.id, declined.id), eq(markets.workspaceId, WS)));
    const priced = await branchPrices();
    expect(priced.approved).not.toBeNull();
    expect(priced.declined).not.toBeNull();
    expect(priced.approved).not.toBe(priced.declined);

    await approveProposal('p1', WS, OWNER);

    const recorded = await decidedPricing();
    expect(recorded).toEqual([
      {
        metricId: METRIC,
        targetDate: TARGET,
        approvedConsensus: priced.approved,
        declinedConsensus: priced.declined,
      },
    ]);
  });

  test('declining records the pair the same way', async () => {
    await seed();
    const priced = await branchPrices();
    await declineProposal('p1', WS, OWNER, 'not now');
    expect(await decidedPricing()).toEqual([
      { metricId: METRIC, targetDate: TARGET, approvedConsensus: priced.approved, declinedConsensus: priced.declined },
    ]);
  });

  test('a branch with no liquidity at the decision is recorded as null, not as a number', async () => {
    await seed();
    const { rows } = await branchPrices();
    const approved = rows.find(r => r.branch === 'approved')!;
    await db
      .update(markets)
      .set({ liquidity: 0, shares: [0, 0] })
      .where(and(eq(markets.id, approved.id), eq(markets.workspaceId, WS)));
    await approveProposal('p1', WS, OWNER);
    const recorded = await decidedPricing();
    expect(recorded).toHaveLength(1);
    expect(recorded![0].approvedConsensus).toBeNull();
    expect(recorded![0].declinedConsensus).not.toBeNull();
  });

  test('the record does not move when the surviving branch trades or is re-anchored afterwards', async () => {
    await seed();
    const priced = await branchPrices();
    await approveProposal('p1', WS, OWNER);
    const { rows } = await branchPrices();
    const approved = rows.find(r => r.branch === 'approved')!;
    // What the 2026-09-02 hand re-anchor did to tetraspace's approved branch.
    await db
      .update(markets)
      .set({ shares: [60, 0] })
      .where(and(eq(markets.id, approved.id), eq(markets.workspaceId, WS)));
    const after = await branchPrices();
    expect(after.approved).not.toBe(priced.approved);
    expect((await decidedPricing())![0].approvedConsensus).toBe(priced.approved);
  });

  test("a decided proposal's pair summary (proposal detail, brief) reads the record, not the books", async () => {
    await seed();
    const priced = await branchPrices();
    await approveProposal('p1', WS, OWNER);
    const { rows } = await branchPrices();
    const approved = rows.find(r => r.branch === 'approved')!;
    await db
      .update(markets)
      .set({ shares: [60, 0] })
      .where(and(eq(markets.id, approved.id), eq(markets.workspaceId, WS)));
    const after = await branchPrices();
    expect(after.approved).not.toBe(priced.approved);

    const [pair] = await getProposalMarketSummariesForProposal('p1', WS);
    expect(pair.approved!.consensus).toBe(priced.approved);
    expect(pair.declined!.consensus).toBe(priced.declined);
    expect(pair.delta).toBeCloseTo(priced.approved! - priced.declined!, 6);
  });

  test("a pending proposal's pair summary reads the books", async () => {
    await seed();
    const priced = await branchPrices();
    const [pair] = await getProposalMarketSummariesForProposal('p1', WS);
    expect(pair.approved!.consensus).toBe(priced.approved);
    expect(pair.delta).toBe(priced.approved! - priced.declined!);
  });
});
