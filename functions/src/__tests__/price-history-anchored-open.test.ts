/**
 * A market's price history has to start where the market started.
 *
 * Conditional pairs and near-horizon baselines open ANCHORED: shares are
 * already outstanding before anyone trades (`anchoredMarketState`). The replay
 * assumed an empty book, so every point it produced was a price the market
 * never printed, and the last one did not match the live consensus. On the
 * chart that draws as a wrong flat level across the whole window with a cliff
 * at the right-hand edge, which reads as "every trade happened at once, just
 * now" (owner report 2026-08-19).
 *
 * The numbers below are the Telarchy floor's own branch market as it stood
 * that day: b = 120.22 over a 0-50 range, opened anchored at the baseline's
 * 6.25, one buy of 15.14 shares of higher. It replayed as 26.57 against a
 * live consensus of 6.97.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { eq } from 'drizzle-orm';
import { agents, liquidityEvents, markets, metrics, trades, workspaces } from '../db/schema';
import { consensus } from '../lib/amm';
import { toUnits } from '../lib/validation';
import { marketPriceSeries, replayMarketTradePoints } from '../services/predictions';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-anchored';
const METRIC = 'metric-anchored';
const MARKET = 'market-anchored';
const B = 120.22458674074696;
const ANCHOR: [number, number] = [233.946243505, 0];
const BUY = 15.1393114;

const OPENED = new Date('2026-08-19T10:06:38.616Z');
const TRADED = new Date('2026-08-19T10:06:57.864Z');

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  await db.insert(agents).values({ id: 'trader', apiKeyHash: 'h-t', balance: toUnits(1000) });
  await db.insert(workspaces).values({
    id: WS,
    name: 'Anchored',
    slug: 'anchored',
    createdBy: 'trader',
    visibility: 'public',
  });
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: 'Weekly active verified traders',
    value: 6,
    formula: '0',
    marketRangeMax: 50,
  });
  // The book as it stands now: the anchor plus the one buy.
  await db.insert(markets).values({
    id: MARKET,
    workspaceId: WS,
    metricId: METRIC,
    metricName: 'Weekly active verified traders',
    targetDate: '2026-12',
    rangeMin: 0,
    rangeMax: 50,
    shares: [ANCHOR[0], ANCHOR[1] + BUY],
    liquidity: B,
    pool: B * Math.LN2,
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
    createdAt: OPENED,
  });
  await db.insert(liquidityEvents).values({
    id: 'liq-open',
    workspaceId: WS,
    marketId: MARKET,
    agentId: 'trader',
    amount: B * Math.LN2,
    poolContribution: B * Math.LN2,
    totalLiquidity: B,
    type: 'initial',
    createdAt: OPENED,
  });
  await db.insert(trades).values({
    id: 'trade-1',
    workspaceId: WS,
    agentId: 'trader',
    marketId: MARKET,
    direction: 'higher',
    shares: BUY,
    cost: 8,
    createdAt: TRADED,
  });
});

const live = () => consensus([ANCHOR[0], ANCHOR[1] + BUY], B, 0, 50)!;

describe('price history of a market that opened anchored', () => {
  test('the last replayed point equals the live consensus', async () => {
    const points = await replayMarketTradePoints(MARKET, WS);
    expect(points).toHaveLength(1);
    // Replaying from an empty book gave 26.57 here; the market's real call is 6.97.
    expect(points[points.length - 1].consensus).toBeCloseTo(live(), 2);
    expect(live()).toBeCloseTo(6.97, 2);
  });

  test('the series opens at the anchor, at the time the market opened', async () => {
    const series = await marketPriceSeries(MARKET, WS);
    expect(series).toHaveLength(2);
    // The pair opened at the baseline's value, which is what anchoring means.
    expect(series[0].consensus).toBeCloseTo(6.25, 1);
    expect(series[0].at.getTime()).toBe(OPENED.getTime());
    expect(series[1].at.getTime()).toBe(TRADED.getTime());
    expect(series[1].consensus).toBeCloseTo(live(), 2);
  });

  test('one trade draws a real move in time, not a cliff at the right edge', async () => {
    // Two points at two different instants is the whole fix: a single point
    // is what the chart could only render as a flat line ending in a jump.
    const series = await marketPriceSeries(MARKET, WS);
    const times = new Set(series.map(p => p.at.getTime()));
    expect(times.size).toBe(2);
    expect(series[0].consensus).not.toBeCloseTo(series[1].consensus!, 3);
  });

  test('a market that opened empty is unchanged', async () => {
    await db
      .update(markets)
      .set({ shares: [0, BUY] })
      .where(eq(markets.id, MARKET));
    const series = await marketPriceSeries(MARKET, WS);
    // Opens at the midpoint prior, then the buy moves it up.
    expect(series[0].consensus).toBeCloseTo(25, 1);
    expect(series[series.length - 1].consensus).toBeCloseTo(consensus([0, BUY], B, 0, 50)!, 2);
  });
});

/**
 * The AUTOFUND anchored open must leave its thinner b on the ledger
 * (docs/market-integrity.md I4).
 *
 * The bug this pins (owner report 2026-08-29): insertPendingMarkets injected
 * the subsidy (ledger row: totalLiquidity = the injection's fat total), then
 * overwrote the book to the anchored thinner b with NO ledger row. The
 * replay prices trades with the ledger's b, so the LookPilot weekly chart
 * climbed to $9,990 while every trade executed around $5-7k on the real
 * book, and the chart ended in a cliff onto the live price.
 */
describe('an autofunded anchored open leaves its b on the ledger', () => {
  const WS2 = 'ws-autofund';
  const METRIC2 = 'metric-autofund';
  const MARKET2 = 'market-autofund';

  test('the anchor row is written and the replay ends at the live consensus', async () => {
    await truncateAll();
    await db.insert(agents).values({ id: 'owner-agent', apiKeyHash: 'h-o', balance: toUnits(5000) });
    await db.insert(workspaces).values({
      id: WS2,
      name: 'Autofund',
      slug: 'autofund',
      createdBy: 'owner-agent',
      visibility: 'public',
      autoFundNewMarkets: true,
      newMarketLiquidityCredits: 1386,
    });
    await db.insert(metrics).values({
      id: METRIC2,
      workspaceId: WS2,
      name: 'Net revenue (USD)',
      value: 4863, // p = 0.19452 across 0..25000: well off-center, thin anchored book
      formula: '0',
      marketRangeMax: 25_000,
    });
    // Tomorrow, though any horizon anchors now (2026-08-31).
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const { insertPendingMarkets } = await import('../services/markets');
    await insertPendingMarkets(
      [
        {
          marketId: MARKET2,
          metricId: METRIC2,
          metricName: 'Net revenue (USD)',
          targetDate: tomorrow,
          rangeMax: 25_000,
        },
      ],
      WS2,
    );

    const [m] = await db.select().from(markets).where(eq(markets.id, MARKET2));
    expect(m.liquidity).toBeGreaterThan(0);
    // The anchored b is thinner than the injected subsidy; the ledger's last
    // word must be the b the book actually trades at.
    const evs = await db.select().from(liquidityEvents).where(eq(liquidityEvents.marketId, MARKET2));
    const last = [...evs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).pop()!;
    expect(last.type).toBe('anchor');
    expect(last.totalLiquidity).toBeCloseTo(m.liquidity, 6);

    // One buy of higher, the way the engine writes it: a trades row plus the
    // share it moved, priced (implicitly) at the anchored b.
    const shares = m.shares as [number, number];
    const bought = 388.98;
    await db
      .update(markets)
      .set({ shares: [shares[0], shares[1] + bought] })
      .where(eq(markets.id, MARKET2));
    await db.insert(trades).values({
      id: 'trade-af-1',
      workspaceId: WS2,
      agentId: 'owner-agent',
      marketId: MARKET2,
      direction: 'higher',
      shares: bought,
      cost: 91,
      createdAt: new Date(Date.now() + 60_000),
    });

    const liveNow = consensus([shares[0], shares[1] + bought], m.liquidity, 0, 25_000)!;
    const points = await replayMarketTradePoints(MARKET2, WS2);
    // Replaying with the injection's fat b put this thousands above the
    // market's real call; the cliff at the chart's right edge was the gap.
    expect(points[points.length - 1].consensus).toBeCloseTo(liveNow, 2);
  });
});
