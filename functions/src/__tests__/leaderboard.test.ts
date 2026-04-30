import {
  computeLeaderboard,
  type LeaderboardMarket,
  type LeaderboardPosition,
  type LeaderboardTrade,
} from '../lib/leaderboard';

const m = (overrides: Partial<LeaderboardMarket>): LeaderboardMarket => ({
  id: 'mkt',
  workspaceId: 'ws',
  rangeMin: 0,
  rangeMax: 1000,
  resolved: false,
  actualValue: null,
  ...overrides,
});

const t = (overrides: Partial<LeaderboardTrade>): LeaderboardTrade => ({
  agentId: 'a',
  workspaceId: 'ws',
  marketId: 'mkt',
  cost: 0,
  createdAt: null,
  ...overrides,
});

const p = (overrides: Partial<LeaderboardPosition>): LeaderboardPosition => ({
  agentId: 'a',
  workspaceId: 'ws',
  marketId: 'mkt',
  direction: 'higher',
  shares: 0,
  ...overrides,
});

describe('computeLeaderboard', () => {
  test('returns no participants when there is no activity', () => {
    expect(computeLeaderboard([], [], [], new Map(), 100)).toEqual([]);
  });

  test('participants with only open markets are unranked but listed', () => {
    const result = computeLeaderboard(
      [m({ resolved: false })],
      [t({ agentId: 'kai', cost: 5, createdAt: new Date('2026-04-29T10:00:00Z') })],
      [p({ agentId: 'kai', shares: 10 })],
      new Map([['kai', 'Kai']]),
      100,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'kai', rank: null, calibration: null, accuracy: null });
    expect(result[0].lastTradeAt).toBe('2026-04-29T10:00:00.000Z');
  });

  test('perfect higher bet on a max-resolution scores calibration 1', () => {
    const result = computeLeaderboard(
      [m({ resolved: true, actualValue: 1000 })],
      [t({ agentId: 'a', cost: 5 })],
      [p({ agentId: 'a', direction: 'higher', shares: 10 })],
      new Map(),
      100,
    );
    expect(result[0].calibration).toBe(1);
    expect(result[0].accuracy).toBe(1);
    // earnings = -cost + shares * 1.0 = -5 + 10 = 5
    expect(result[0].totalEarnings).toBeCloseTo(5);
  });

  test('worst higher bet on a min-resolution scores calibration 0', () => {
    const result = computeLeaderboard(
      [m({ resolved: true, actualValue: 0 })],
      [t({ agentId: 'a', cost: 4 })],
      [p({ agentId: 'a', direction: 'higher', shares: 10 })],
      new Map(),
      100,
    );
    expect(result[0].calibration).toBe(0);
    expect(result[0].accuracy).toBe(0);
    // earnings = -4 + 0 = -4
    expect(result[0].totalEarnings).toBeCloseTo(-4);
  });

  test('mid-range resolution gives ~0.5 calibration regardless of direction', () => {
    const result = computeLeaderboard(
      [m({ resolved: true, actualValue: 500 })],
      [t({ agentId: 'h' }), t({ agentId: 'l' })],
      [
        p({ agentId: 'h', direction: 'higher', shares: 8 }),
        p({ agentId: 'l', direction: 'lower', shares: 8 }),
      ],
      new Map(),
      100,
    );
    for (const e of result) {
      expect(e.calibration).toBeCloseTo(0.5);
      expect(e.accuracy).toBe(0); // factor > 0.5 strict; 0.5 is not "correct"
    }
  });

  test('calibration is shares-weighted across multiple resolved markets', () => {
    // Agent has two resolved positions:
    //   market A (resolves at 1000 -> higher factor 1.0): 10 higher shares
    //   market B (resolves at 0 -> higher factor 0.0): 30 higher shares
    // Weighted mean: (10*1 + 30*0) / 40 = 0.25
    const result = computeLeaderboard(
      [
        m({ id: 'A', resolved: true, actualValue: 1000 }),
        m({ id: 'B', resolved: true, actualValue: 0 }),
      ],
      [
        t({ marketId: 'A', cost: 5 }),
        t({ marketId: 'B', cost: 12 }),
      ],
      [
        p({ marketId: 'A', direction: 'higher', shares: 10 }),
        p({ marketId: 'B', direction: 'higher', shares: 30 }),
      ],
      new Map(),
      100,
    );
    expect(result[0].calibration).toBeCloseTo(0.25);
    // Accuracy = 1/2 (won market A only)
    expect(result[0].accuracy).toBeCloseTo(0.5);
    // Earnings = -(5+12) + (10*1 + 30*0) = -17 + 10 = -7
    expect(result[0].totalEarnings).toBeCloseTo(-7);
    expect(result[0].resolvedMarkets).toBe(2);
  });

  test('ranks identical-calibration participants by earnings desc', () => {
    const result = computeLeaderboard(
      [
        m({ id: 'B', resolved: true, actualValue: 750 }),
        m({ id: 'C', resolved: true, actualValue: 750 }),
      ],
      [
        t({ agentId: 'beta', marketId: 'B', cost: 1 }),
        t({ agentId: 'gamma', marketId: 'B', cost: 1 }),
        t({ agentId: 'gamma', marketId: 'C', cost: 1 }),
      ],
      [
        p({ agentId: 'beta', marketId: 'B', direction: 'higher', shares: 10 }),
        p({ agentId: 'gamma', marketId: 'B', direction: 'higher', shares: 10 }),
        p({ agentId: 'gamma', marketId: 'C', direction: 'higher', shares: 10 }),
      ],
      new Map(),
      100,
    );
    expect(result.map(e => e.id)).toEqual(['gamma', 'beta']);
    expect(result[0].rank).toBe(1);
    expect(result[1].rank).toBe(2);
  });

  test('unranked participants follow ranked ones, sorted by lastTradeAt desc', () => {
    const result = computeLeaderboard(
      [
        m({ id: 'R', resolved: true, actualValue: 1000 }),
        m({ id: 'O', resolved: false }),
      ],
      [
        // ranked: has a resolved position
        t({ agentId: 'ranked', marketId: 'R', cost: 1, createdAt: new Date('2026-01-01T00:00:00Z') }),
        // unranked-recent: traded yesterday on an open market
        t({ agentId: 'recent', marketId: 'O', cost: 1, createdAt: new Date('2026-04-29T00:00:00Z') }),
        // unranked-old: traded long ago on an open market
        t({ agentId: 'old', marketId: 'O', cost: 1, createdAt: new Date('2025-01-01T00:00:00Z') }),
      ],
      [
        p({ agentId: 'ranked', marketId: 'R', direction: 'higher', shares: 5 }),
        p({ agentId: 'recent', marketId: 'O', direction: 'higher', shares: 5 }),
        p({ agentId: 'old', marketId: 'O', direction: 'higher', shares: 5 }),
      ],
      new Map(),
      100,
    );
    expect(result.map(e => e.id)).toEqual(['ranked', 'recent', 'old']);
    expect(result[0].rank).toBe(1);
    expect(result[1].rank).toBe(null);
    expect(result[2].rank).toBe(null);
  });

  test('ignores positions with zero shares (fully sold out)', () => {
    const result = computeLeaderboard(
      [m({ resolved: true, actualValue: 1000 })],
      [t({ cost: 1 })],
      [p({ shares: 0 })],
      new Map(),
      100,
    );
    // Trade still records this agent so they appear, but with no resolved
    // position they can't be ranked.
    expect(result).toHaveLength(1);
    expect(result[0].calibration).toBe(null);
    expect(result[0].resolvedMarkets).toBe(0);
  });

  test('respects the limit parameter', () => {
    const marketList = [m({ resolved: true, actualValue: 1000 })];
    const tradeList: LeaderboardTrade[] = [];
    const positionList: LeaderboardPosition[] = [];
    for (let i = 0; i < 5; i++) {
      tradeList.push(t({ agentId: `a${i}`, cost: 1 }));
      positionList.push(p({ agentId: `a${i}`, shares: 10 }));
    }
    const result = computeLeaderboard(marketList, tradeList, positionList, new Map(), 3);
    expect(result).toHaveLength(3);
  });

  test('does not double-count markets across workspaces with the same id', () => {
    // Two workspaces happen to use the same market id but they are distinct
    // markets. Filtering uses the (workspaceId, marketId) tuple.
    const result = computeLeaderboard(
      [
        m({ id: 'shared', workspaceId: 'wsA', resolved: true, actualValue: 1000 }),
        m({ id: 'shared', workspaceId: 'wsB', resolved: true, actualValue: 0 }),
      ],
      [
        t({ agentId: 'a', workspaceId: 'wsA', marketId: 'shared', cost: 1 }),
        t({ agentId: 'a', workspaceId: 'wsB', marketId: 'shared', cost: 1 }),
      ],
      [
        p({ agentId: 'a', workspaceId: 'wsA', marketId: 'shared', direction: 'higher', shares: 10 }),
        p({ agentId: 'a', workspaceId: 'wsB', marketId: 'shared', direction: 'higher', shares: 10 }),
      ],
      new Map(),
      100,
    );
    // Two distinct resolved markets; calibration = (10*1 + 10*0) / 20 = 0.5
    expect(result[0].resolvedMarkets).toBe(2);
    expect(result[0].calibration).toBeCloseTo(0.5);
  });
});
