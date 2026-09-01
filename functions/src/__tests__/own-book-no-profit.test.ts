/**
 * THE RULE: profit out of a book you funded is not score.
 *
 * The Terms have always said, in section 2, that buying market liquidity
 * "confers no contest entry, standing, or score". The scoring did not enforce
 * it. Season score counted trading profit and ignored the LP loss sitting on
 * the other side of the same account, so an entrant could fund their own
 * market's pool, be the only trader in it, win it, and convert pool credits
 * into season score at roughly one for one. Credit-neutral for them, and the
 * score is what the prize is proportional to.
 *
 * So in a market you contributed pool credits to, your settled trading profit
 * is reduced by what you put in, FLOORED AT ZERO rather than turned into a
 * loss. Three cases the floor exists for:
 *
 *   - an LP who does not trade their own book is untouched, because there is
 *     no trading profit to reduce
 *   - a trader who funded nothing is untouched
 *   - someone who funded a book and won MORE than they put in keeps the
 *     excess, because that part was real risk against other people
 *
 * Deliberately about the MARKET, not about the person: no account is excluded
 * from anything. That is why this is the rule and strictEligibility is not.
 * Eligibility asks who you are and shrinks the field; this asks what the trade
 * was and shrinks nothing (owner decision 2026-09-01, who declined
 * strictEligibility for exactly that reason).
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { computeSettledWindowProfit } from '../lib/leaderboard';

/** One market, settling at the top of its range: `higher` pays 1 a share. */
const MARKET = { id: 'm1', workspaceId: 'ws', rangeMin: 0, rangeMax: 100, actualValue: 100, voided: false };

const agg = (agentId: string, shares: number, cost: number) => ({
  agentId,
  workspaceId: 'ws',
  marketId: 'm1',
  direction: 'higher' as const,
  shares,
  cost,
});

/** What each agent put into this market's pool. */
const funded = (entries: Record<string, number>) => {
  const m = new Map<string, number>();
  for (const [agentId, amount] of Object.entries(entries)) m.set(`${agentId} ws m1`, amount);
  return m;
};

describe('a book you paid for does not pay you score', () => {
  test('the self-deal nets to nothing', () => {
    // Funded the pool with 2,000, then took 2,000 of trading profit out of it.
    const out = computeSettledWindowProfit([MARKET], [agg('mallory', 5000, 3000)], funded({ mallory: 2000 }));
    expect(out.get('mallory')).toBeCloseTo(0, 6);
  });

  test('a trader who funded nothing keeps every credit of it', () => {
    const out = computeSettledWindowProfit([MARKET], [agg('honest', 5000, 3000)], funded({ mallory: 2000 }));
    expect(out.get('honest')).toBeCloseTo(2000, 6);
  });

  test('funding is not a penalty: an LP who does not trade scores nothing, not a loss', () => {
    const out = computeSettledWindowProfit([MARKET], [], funded({ lp: 2000 }));
    expect(out.get('lp') ?? 0).toBe(0);
  });

  test('winning MORE than you funded keeps the excess, because that part was real risk', () => {
    // 2,000 of profit against 500 funded: 1,500 is other people's money.
    const out = computeSettledWindowProfit([MARKET], [agg('mixed', 5000, 3000)], funded({ mixed: 500 }));
    expect(out.get('mixed')).toBeCloseTo(1500, 6);
  });

  test('a LOSS on your own book is still a loss, not floored away', () => {
    // Paid 4,000 for shares that pay 3,000.
    const out = computeSettledWindowProfit([MARKET], [agg('unlucky', 3000, 4000)], funded({ unlucky: 2000 }));
    expect(out.get('unlucky')).toBeCloseTo(-1000, 6);
  });

  test('with no funding data at all, nothing changes', () => {
    const out = computeSettledWindowProfit([MARKET], [agg('anyone', 5000, 3000)]);
    expect(out.get('anyone')).toBeCloseTo(2000, 6);
  });
});

/**
 * The pure function above is only half of it: the key the board builds has to
 * match the key windowProfit looks up, or the offset silently never applies
 * and every test above still passes. This drives the real query.
 */
describe('the season board actually finds who funded what', () => {
  test('a self-dealt market scores nothing through loadSeasonSettled', async () => {
    const { db, ensureMigrations, truncateAll } = await import('./harness/test-db');
    const { agents, liquidityEvents, markets, metrics, trades } = await import('../db/schema');
    const { provisionWorkspace } = await import('../lib/participants');
    const { loadSeasonSettled } = await import('../lib/board');
    await ensureMigrations();
    await truncateAll();

    const WS = 'ws-own';
    const MALLORY = 'agent-own-mallory';
    const HONEST = 'agent-own-honest';
    const MK = 'market-own';
    const RESOLVED_AT = new Date('2026-06-15T12:00:00Z');

    await db.insert(agents).values([
      { id: MALLORY, apiKeyHash: 'h-om', balance: 0 },
      { id: HONEST, apiKeyHash: 'h-oh', balance: 0 },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await provisionWorkspace(db as any, {
      wsId: WS,
      name: 'Own book',
      createdBy: MALLORY,
      ownerAgentId: MALLORY,
      visibility: 'public',
    });
    await db.insert(metrics).values({
      id: 'metric-own',
      workspaceId: WS,
      name: 'Revenue',
      value: 100,
      formula: '0',
      marketRangeMax: 100,
    });
    await db.insert(markets).values({
      id: MK,
      workspaceId: WS,
      metricId: 'metric-own',
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
    // Mallory funded this book with 2,000 of pool credits...
    await db.insert(liquidityEvents).values({
      id: 'liq-own',
      workspaceId: WS,
      marketId: MK,
      agentId: MALLORY,
      amount: 2000,
      poolContribution: 2000,
      totalLiquidity: 200,
      type: 'injection',
      createdAt: new Date('2026-06-02T00:00:00Z'),
    });
    // ...and then took 2,000 of profit back out of it.
    await db.insert(trades).values({
      id: 'trade-own-m',
      workspaceId: WS,
      marketId: MK,
      agentId: MALLORY,
      direction: 'higher',
      shares: 5000,
      cost: 3000,
      createdAt: new Date('2026-06-10T00:00:00Z'),
    });
    // An honest trader on the same book, who funded nothing.
    await db.insert(trades).values({
      id: 'trade-own-h',
      workspaceId: WS,
      marketId: MK,
      agentId: HONEST,
      direction: 'higher',
      shares: 5000,
      cost: 3000,
      createdAt: new Date('2026-06-10T00:00:00Z'),
    });

    const scores = await loadSeasonSettled([WS], new Date('2026-06-01T00:00:00Z'), new Date('2026-06-30T00:00:00Z'));

    expect(scores.get(MALLORY) ?? 0).toBeCloseTo(0, 6);
    expect(scores.get(HONEST)).toBeCloseTo(2000, 6);
  });
});

/**
 * The standings show settled PLUS the mark on positions still open. If the
 * offset applies to only one of those halves, a self-dealer reads as winning
 * in "Total if prices hold" and then scores zero when the market resolves -
 * the exact shape of P1-10, a column promising money the settlement cannot
 * pay. Both halves take it.
 */
describe('the marked column tells the same story the settlement will', () => {
  test('an OPEN position in a book you funded is not marked as profit', async () => {
    const { db, ensureMigrations, truncateAll } = await import('./harness/test-db');
    const { agents, liquidityEvents, markets, metrics, trades } = await import('../db/schema');
    const { provisionWorkspace } = await import('../lib/participants');
    const { loadSeasonMarked } = await import('../lib/board');
    await ensureMigrations();
    await truncateAll();

    const WS = 'ws-mark';
    const MALLORY = 'agent-mark-mallory';
    const HONEST = 'agent-mark-honest';
    const MK = 'market-mark';

    await db.insert(agents).values([
      { id: MALLORY, apiKeyHash: 'h-mm', balance: 0 },
      { id: HONEST, apiKeyHash: 'h-mh', balance: 0 },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await provisionWorkspace(db as any, {
      wsId: WS,
      name: 'Marked own book',
      createdBy: MALLORY,
      ownerAgentId: MALLORY,
      visibility: 'public',
    });
    await db.insert(metrics).values({
      id: 'metric-mark',
      workspaceId: WS,
      name: 'Revenue',
      value: 100,
      formula: '0',
      marketRangeMax: 100,
    });
    // Still OPEN, and priced near the top so the mark is large.
    await db.insert(markets).values({
      id: MK,
      workspaceId: WS,
      metricId: 'metric-mark',
      metricName: 'Revenue',
      targetDate: '2026-06-20',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 1200],
      liquidity: 200,
      pool: 2000,
      active: true,
      resolved: false,
      voided: false,
    });
    await db.insert(liquidityEvents).values({
      id: 'liq-mark',
      workspaceId: WS,
      marketId: MK,
      agentId: MALLORY,
      amount: 2000,
      poolContribution: 2000,
      totalLiquidity: 200,
      type: 'injection',
      createdAt: new Date('2026-06-02T00:00:00Z'),
    });
    for (const [id, agentId] of [
      ['trade-mark-m', MALLORY],
      ['trade-mark-h', HONEST],
    ] as const) {
      await db.insert(trades).values({
        id,
        workspaceId: WS,
        marketId: MK,
        agentId,
        direction: 'higher',
        shares: 600,
        cost: 100,
        createdAt: new Date('2026-06-10T00:00:00Z'),
      });
    }

    const marked = await loadSeasonMarked([WS], new Date('2026-06-01T00:00:00Z'), new Date('2026-06-30T00:00:00Z'));

    // The honest trader's mark stands; the funder's is offset by what they
    // put in, so the column cannot promise them a prize the settlement will
    // not pay.
    expect(marked.get(HONEST) ?? 0).toBeGreaterThan(0);
    expect(marked.get(MALLORY) ?? 0).toBe(0);
  });
});
