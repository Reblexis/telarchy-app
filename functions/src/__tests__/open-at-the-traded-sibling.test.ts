/**
 * A baseline book on a metric that already has a traded open book opens at
 * that book's price, not at the reading (docs/ui-conventions.md, "Where
 * markets open").
 *
 * Owner report 2026-09-03: "there should be stable range for all dates in a
 * given metric so how is it possible that telarchy implied valueation has 1k
 * at yearly market and 1 mil at monthly". The range was the same on both.
 * The yearly book, added that evening, opened at the $0 reading clamped to
 * $20,000, beside a September book five trades had carried to $820,000.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { and, eq } from 'drizzle-orm';
import { agents, markets, metrics, workspaces } from '../db/schema';
import { anchoredMarketState, consensus, initialPool } from '../lib/amm';
import { toUnits } from '../lib/validation';
import { insertPendingMarkets } from '../services/markets';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-sibling';
const OWNER = 'owner-sibling';
const METRIC = 'm-valuation';
const RANGE = 20_000_000;

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values({ id: OWNER, apiKeyHash: 'h-sib', balance: toUnits(5000) });
  await db.insert(workspaces).values({
    id: WS,
    name: 'Telarchy',
    createdBy: OWNER,
    visibility: 'public',
    autoFundNewMarkets: true,
    newMarketLiquidityCredits: 250,
  });
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Implied valuation (USD)',
    value: 0,
    formula: '0',
    marketRangeMax: RANGE,
  });
});

/** An open baseline book sitting at `price`, traded or not. */
async function book(id: string, targetDate: string, price: number, opts: { traded: boolean; pool?: number }) {
  const pool = opts.pool ?? 360;
  const st = anchoredMarketState(pool, price / RANGE);
  await db.insert(markets).values({
    id,
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Implied valuation (USD)',
    targetDate,
    rangeMin: 0,
    rangeMax: RANGE,
    shares: st.shares,
    liquidity: st.liquidity,
    pool: initialPool(st.liquidity),
    tradedVolume: opts.traded ? 902 : 0,
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
  });
}

async function priceOf(id: string): Promise<number> {
  const [m] = await db
    .select()
    .from(markets)
    .where(and(eq(markets.id, id), eq(markets.workspaceId, WS)));
  return consensus(m.shares as [number, number], m.liquidity, m.rangeMin, m.rangeMax) as number;
}

const open = (id: string, targetDate: string) =>
  insertPendingMarkets(
    [{ marketId: id, metricId: METRIC, metricName: 'Implied valuation (USD)', targetDate, rangeMax: RANGE }],
    WS,
  );

test('a new yearly book opens at the traded monthly book, not at the $0 reading', async () => {
  await book('mk-sep', '2099-09', 820_000, { traded: true });
  await open('mk-year', '2099');
  expect(await priceOf('mk-year')).toBeCloseTo(820_000, -3);
});

test('with no traded book the reading still governs (the edge clamp, $20,000)', async () => {
  await book('mk-sep', '2099-09', 820_000, { traded: false });
  await open('mk-year', '2099');
  expect(await priceOf('mk-year')).toBeCloseTo(20_000, -2);
});

test('the traded book whose settlement is nearest wins', async () => {
  await book('mk-sep', '2099-09', 820_000, { traded: true });
  await book('mk-2100', '2100', 3_000_000, { traded: true });
  await open('mk-dec', '2099-12');
  expect(await priceOf('mk-dec')).toBeCloseTo(820_000, -3);
  await open('mk-2101', '2101');
  expect(await priceOf('mk-2101')).toBeCloseTo(3_000_000, -3);
});

test('a settled traded book is not a sibling', async () => {
  await book('mk-sep', '2099-09', 820_000, { traded: true });
  await db.update(markets).set({ resolved: true }).where(eq(markets.id, 'mk-sep'));
  await open('mk-year', '2099');
  expect(await priceOf('mk-year')).toBeCloseTo(20_000, -2);
});
