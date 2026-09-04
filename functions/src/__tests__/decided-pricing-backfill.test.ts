/**
 * The one-off backfill of proposals.decidedPricing values a proposal decided
 * before the record existed at its pair's prices AT THE DECISION, replayed
 * from the trade history, and takes a hand re-anchored untraded book from
 * its recorded previous state (services/decided-pricing-backfill.ts).
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { and, eq } from 'drizzle-orm';
import { agents, markets, metrics as metricsTable, proposals, trades, workspaces } from '../db/schema';
import { consensus, initialPool } from '../lib/amm';
import { backfillDecidedPricing } from '../services/decided-pricing-backfill';
import { marketPriceSeries } from '../services/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-backfill';
const OWNER = 'owner-backfill';
const TRADER = 'trader-backfill';
const DECIDED_AT = new Date('2026-08-21T15:45:26Z');

const book = (id: string, branch: 'approved' | 'declined', shares: [number, number], voided = false) => ({
  id,
  workspaceId: WS,
  metricId: 'metric-bf',
  metricName: 'Active traders',
  targetDate: '2026-09',
  rangeMin: 0,
  rangeMax: 100,
  shares,
  liquidity: 100,
  pool: initialPool(100),
  active: true,
  resolved: voided,
  voided,
  proposalId: 'p-old',
  branch,
});

async function seed(status: 'approved' | 'declined' = 'approved') {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-owner-bf', balance: 0 },
    { id: TRADER, apiKeyHash: 'h-trader-bf', balance: 0 },
  ]);
  await db.insert(workspaces).values({ id: WS, name: 'Backfill', createdBy: OWNER, visibility: 'private' });
  await db.insert(metricsTable).values({
    id: 'metric-bf',
    workspaceId: WS,
    name: 'Active traders',
    value: 20,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(proposals).values({
    id: 'p-old',
    workspaceId: WS,
    proposedBy: TRADER,
    title: 'old job',
    description: '',
    status,
    resolvedAt: DECIDED_AT,
  });
}

const trade = (id: string, marketId: string, at: string, direction: 'higher' | 'lower' = 'higher') => ({
  id,
  workspaceId: WS,
  agentId: TRADER,
  marketId,
  direction,
  shares: 5,
  cost: 3,
  createdAt: new Date(at),
});

describe('backfillDecidedPricing', () => {
  test('values the pair at the decision: trades before it count, trades after it do not', async () => {
    await seed();
    await db.insert(markets).values([book('appr', 'approved', [0, 30]), book('decl', 'declined', [10, 0], true)]);
    await db
      .insert(trades)
      .values([
        trade('t1', 'appr', '2026-08-21T14:00:00Z'),
        trade('t2', 'appr', '2026-08-25T10:00:00Z'),
        trade('t3', 'appr', '2026-09-01T10:00:00Z'),
      ]);
    const series = await marketPriceSeries('appr', WS);
    const atDecision = series.filter(p => p.at.getTime() <= DECIDED_AT.getTime()).at(-1)!.consensus;
    const now = series.at(-1)!.consensus;
    expect(atDecision).not.toBe(now);

    const [r] = await backfillDecidedPricing({ apply: true });
    expect(r.pricing).toHaveLength(1);
    expect(r.pricing[0].approvedConsensus).toBe(atDecision);
    expect(r.pricing[0].declinedConsensus).toBe(consensus([10, 0], 100, 0, 100));
    const [p] = await db.select({ d: proposals.decidedPricing }).from(proposals).where(eq(proposals.id, 'p-old'));
    expect(p.d).toEqual(r.pricing);
  });

  test('an untraded book is priced at its opening, unless a recorded pre-re-anchor state is passed', async () => {
    await seed();
    // tetraspace's shape: the approved book was re-anchored to 12.83 after
    // the decision; before that it read what the declined branch opened at.
    await db.insert(markets).values([book('appr', 'approved', [60, 0]), book('decl', 'declined', [0, 0], true)]);
    const plain = await backfillDecidedPricing({ apply: false });
    expect(plain[0].pricing[0].approvedConsensus).toBe(consensus([60, 0], 100, 0, 100));

    const overrides = new Map([['appr', { shares: [0, 0] as [number, number], liquidity: 100 }]]);
    const [r] = await backfillDecidedPricing({ overrides, apply: false });
    expect(r.pricing[0].approvedConsensus).toBe(consensus([0, 0], 100, 0, 100));
  });

  test('a recorded pre-re-anchor state is ignored for a book that has traded', async () => {
    await seed();
    await db.insert(markets).values([book('appr', 'approved', [0, 30]), book('decl', 'declined', [0, 0], true)]);
    await db.insert(trades).values([trade('t1', 'appr', '2026-08-21T14:00:00Z')]);
    const series = await marketPriceSeries('appr', WS);
    const overrides = new Map([['appr', { shares: [99, 0] as [number, number], liquidity: 100 }]]);
    const [r] = await backfillDecidedPricing({ overrides, apply: false });
    expect(r.pricing[0].approvedConsensus).toBe(series.at(-1)!.consensus);
  });

  test('a proposal that already carries a record is left alone', async () => {
    await seed();
    await db.insert(markets).values([book('appr', 'approved', [0, 30]), book('decl', 'declined', [0, 0], true)]);
    const record = [
      { metricId: 'metric-bf', targetDate: '2026-09', approvedConsensus: 23.41, declinedConsensus: 18.14 },
    ];
    await db.update(proposals).set({ decidedPricing: record }).where(eq(proposals.id, 'p-old'));
    const rows = await backfillDecidedPricing({ apply: true });
    expect(rows).toEqual([]);
    const [p] = await db.select({ d: proposals.decidedPricing }).from(proposals).where(eq(proposals.id, 'p-old'));
    expect(p.d).toEqual(record);
  });

  test('a dry run writes nothing', async () => {
    await seed('declined');
    await db.insert(markets).values([book('appr', 'approved', [0, 30], true), book('decl', 'declined', [0, 0])]);
    const rows = await backfillDecidedPricing({ apply: false });
    expect(rows).toHaveLength(1);
    const [p] = await db.select({ d: proposals.decidedPricing }).from(proposals).where(eq(proposals.id, 'p-old'));
    expect(p.d).toBeNull();
    // A declined job counts zero on the rail but its record is kept all the same.
    expect(rows[0].status).toBe('declined');
  });

  test('a pending proposal is never touched', async () => {
    await seed();
    await db.update(proposals).set({ status: 'pending', resolvedAt: null }).where(eq(proposals.id, 'p-old'));
    await db.insert(markets).values([book('appr', 'approved', [0, 30]), book('decl', 'declined', [0, 0])]);
    expect(await backfillDecidedPricing({ apply: true })).toEqual([]);
    const [m] = await db
      .select()
      .from(markets)
      .where(and(eq(markets.id, 'appr'), eq(markets.workspaceId, WS)));
    expect(m).toBeDefined();
  });
});
