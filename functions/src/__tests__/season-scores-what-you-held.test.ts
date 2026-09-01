/**
 * THE RULE: your season score is what your trades actually did, all of them.
 *
 * The 6-hour cutoff existed for one reason, published in
 * docs/legal/season-0-rules.md: "it just cannot farm the prize off a reading
 * that is already visible". A market resolves on its reading now, so the
 * reading becoming visible IS the resolution and there is no window to farm.
 * The cutoff protects nothing.
 *
 * It also cost something, because "does not count" cut both ways. It was
 * meant to ignore late BUYING and it also ignored late SELLING:
 *
 *   before the cutoff   buy 5,000 shares for 3,000   -> counted
 *   after the cutoff    sell all 5,000 back for ~2,950 -> IGNORED
 *   at resolution       you hold nothing
 *   the scorer thinks   5,000 shares bought for 3,000 -> scores the full win
 *
 * So one bankroll could be scored on an unlimited number of markets in
 * sequence, for the cost of the spread each time (bug hunt 2026-08-31, P1
 * "one bankroll, unlimited markets"). Counting every trade makes the
 * arithmetic self-correcting: sell out and your counted position is zero at
 * a net cost of the spread, so the round trip scores a small loss, which is
 * what it was.
 *
 * MID-SEASON RULE CHANGE. Season 0 is experimental and its published rules
 * say they may be adjusted while it runs, with every change announced on the
 * season page BEFORE it takes effect. This one reduces the score of anyone
 * who sold out after a cutoff and kept the win, so it is not harm-free and
 * the announcement is not optional.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { agents, markets, metrics, trades } from '../db/schema';
import { loadSeasonSettled } from '../lib/board';
import { computeSettledWindowProfit } from '../lib/leaderboard';
import { provisionWorkspace } from '../lib/participants';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

/** One market, resolved at the top of its range: `higher` pays 1 a share. */
const MARKET = {
  id: 'm1',
  workspaceId: 'ws',
  rangeMin: 0,
  rangeMax: 100,
  actualValue: 100,
  voided: false,
};

const agg = (direction: 'higher' | 'lower', shares: number, cost: number) => ({
  agentId: 'trader',
  workspaceId: 'ws',
  marketId: 'm1',
  direction,
  shares,
  cost,
});

describe('the arithmetic, on the aggregate the query produces', () => {
  // The query groups by (agent, workspace, market, direction) and sums, so a
  // buy and a later sell of the same side arrive as ONE row. That is what
  // makes counting the sell self-correcting.
  test('a held position scores the win', () => {
    const out = computeSettledWindowProfit([MARKET], [agg('higher', 5000, 3000)]);
    expect(out.get('trader')).toBeCloseTo(2000, 6);
  });

  test('a round trip nets to zero shares at the cost of the spread', () => {
    // buy 5,000 for 3,000 then sell them back for 2,950: shares 0, cost 50.
    const out = computeSettledWindowProfit([MARKET], [agg('higher', 0, 50)]);
    expect(out.get('trader')).toBeCloseTo(-50, 6);
  });

  test('selling half keeps half the win', () => {
    const out = computeSettledWindowProfit([MARKET], [agg('higher', 2500, 1525)]);
    expect(out.get('trader')).toBeCloseTo(975, 6);
  });
});

describe('every trade counts, including the late ones', () => {
  const WS = 'ws-cut';
  const TRADER = 'agent-cut';
  const MARKET_ID = 'market-cut';
  const RESOLVED_AT = new Date('2026-06-15T12:00:00Z');
  const WINDOW_START = new Date('2026-06-01T00:00:00Z');
  const WINDOW_END = new Date('2026-06-30T00:00:00Z');

  async function seedRoundTrip() {
    await db.insert(agents).values([
      { id: 'agent-cut-owner', apiKeyHash: 'h-cuo', balance: 0 },
      { id: TRADER, apiKeyHash: 'h-cut', balance: 0 },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await provisionWorkspace(db as any, {
      wsId: WS,
      name: 'Cutoff',
      createdBy: 'agent-cut-owner',
      ownerAgentId: 'agent-cut-owner',
      visibility: 'public',
    });
    await db.insert(metrics).values({
      id: 'metric-cut',
      workspaceId: WS,
      name: 'Revenue',
      value: 100,
      formula: '0',
      marketRangeMax: 100,
    });
    await db.insert(markets).values({
      id: MARKET_ID,
      workspaceId: WS,
      metricId: 'metric-cut',
      metricName: 'Revenue',
      targetDate: '2026-06-14',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0],
      liquidity: 200,
      pool: 0,
      active: false,
      resolved: true,
      voided: false,
      actualValue: 100,
      resolvedAt: RESOLVED_AT,
    });
    // Bought a day before resolution: comfortably before any cutoff.
    await db.insert(trades).values({
      id: 'trade-buy',
      workspaceId: WS,
      marketId: MARKET_ID,
      agentId: TRADER,
      direction: 'higher',
      shares: 5000,
      cost: 3000,
      createdAt: new Date(RESOLVED_AT.getTime() - 24 * 3_600_000),
    });
    // Sold back ONE HOUR before resolution: inside the old 6-hour cutoff, so
    // this is the trade that used to be invisible.
    await db.insert(trades).values({
      id: 'trade-sell',
      workspaceId: WS,
      marketId: MARKET_ID,
      agentId: TRADER,
      direction: 'higher',
      shares: -5000,
      cost: -2950,
      createdAt: new Date(RESOLVED_AT.getTime() - 1 * 3_600_000),
    });
  }

  test('selling out before resolution cancels the score the buy earned', async () => {
    await seedRoundTrip();

    const scores = await loadSeasonSettled([WS], WINDOW_START, WINDOW_END);

    // Under the cutoff the sell was dropped and this scored +2,000 on shares
    // the trader did not hold at resolution, so one bankroll could be scored
    // on market after market. Counting it, the round trip costs the spread.
    expect(scores.get(TRADER) ?? 0).toBeLessThan(0);
    expect(scores.get(TRADER)).toBeCloseTo(-50, 6);
  });
});
