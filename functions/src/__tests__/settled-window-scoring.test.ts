/**
 * The settled-window season score (rules amended 2026-08-29): pure
 * arithmetic over resolved-in-window markets and their counted trades
 * (lib/leaderboard.ts computeSettledWindowProfit), plus the effective-instant
 * switch. The SQL side (which markets are in the window, which trades are
 * before the cutoff) is exercised against a real database in
 * season-lifecycle.test.ts.
 */

import { computeSettledWindowProfit, type SettledWindowMarket } from '../lib/leaderboard';
import {
  SEASON_TRADE_CUTOFF_HOURS,
  SETTLED_SCORING_DEFAULT_AT,
  settledScoringActive,
  settledScoringEffectiveAt,
} from '../lib/seasons';

const MKT: SettledWindowMarket = {
  id: 'm1',
  workspaceId: 'ws',
  rangeMin: 0,
  rangeMax: 100,
  actualValue: 50,
  voided: false,
};

const agg = (over: Partial<Parameters<typeof computeSettledWindowProfit>[1][number]>) => ({
  agentId: 'a',
  workspaceId: 'ws',
  marketId: 'm1',
  direction: 'higher',
  shares: 40,
  cost: 10,
  ...over,
});

describe('computeSettledWindowProfit', () => {
  test('a resolved market pays shares x its resolution factor, minus net cash', () => {
    // Range 0..100 resolved at 50: the higher factor is 0.5, so 40 shares
    // pay 20 against 10 of cost.
    const out = computeSettledWindowProfit([MKT], [agg({})]);
    expect(out.get('a')).toBe(10);
  });

  test('the losing side realises its loss', () => {
    const out = computeSettledWindowProfit([MKT], [agg({ direction: 'lower', shares: 40, cost: 25 })]);
    // The lower factor at 50 is also 0.5: 20 back on 25 in.
    expect(out.get('a')).toBe(-5);
  });

  test('a market absent from the window contributes nothing, whatever was traded on it', () => {
    const out = computeSettledWindowProfit([], [agg({ cost: 999 })]);
    expect(out.get('a')).toBeUndefined();
  });

  test('a voided market nets to zero for a holder and keeps a realised gain', () => {
    const voided: SettledWindowMarket = { ...MKT, actualValue: null, voided: true };
    const holder = agg({ agentId: 'holder', cost: 30 });
    // Sold out above cost: net cash negative, refund floored at zero, the
    // gain stands. Same convention as computeTradingProfit.
    const seller = agg({ agentId: 'seller', shares: 0, cost: -12 });
    const out = computeSettledWindowProfit([voided], [holder, seller]);
    expect(out.get('holder')).toBe(0);
    expect(out.get('seller')).toBe(12);
  });

  test('a void refunds NET cash across both directions, not per direction', () => {
    const voided: SettledWindowMarket = { ...MKT, actualValue: null, voided: true };
    const out = computeSettledWindowProfit(
      [voided],
      [agg({ direction: 'higher', cost: 30 }), agg({ direction: 'lower', cost: -40 })],
    );
    // Net cash is -10 (took out more than put in): refund 0, gain kept.
    expect(out.get('a')).toBe(10);
  });

  test('an actual value above the range is capped, like resolution itself', () => {
    const out = computeSettledWindowProfit([{ ...MKT, actualValue: 500 }], [agg({ cost: 0 })]);
    // Capped at rangeMax: higher factor 1, payout 40.
    expect(out.get('a')).toBe(40);
  });

  test('a negative counted holding is never paid (participant-deletion orphans)', () => {
    const out = computeSettledWindowProfit([MKT], [agg({ shares: -5, cost: -3 })]);
    // Payout clamps to zero; the negative cost (cash taken out) still counts.
    expect(out.get('a')).toBe(3);
  });

  test('rounds to 2dp, the standings precision', () => {
    const out = computeSettledWindowProfit([{ ...MKT, actualValue: 33.333 }], [agg({ cost: 0 })]);
    expect(out.get('a')).toBe(Math.round(40 * 0.33333 * 100) / 100);
  });
});

describe('the effective instant', () => {
  afterEach(() => {
    delete process.env.SEASON_SETTLED_SCORING_AT;
  });

  test('defaults to 2026-09-01T00:00Z, the instant the rules announce', () => {
    delete process.env.SEASON_SETTLED_SCORING_AT;
    expect(settledScoringEffectiveAt().toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(SETTLED_SCORING_DEFAULT_AT).toBe('2026-09-01T00:00:00Z');
  });

  test('the boundary is at-or-after, and the env override is read per call', () => {
    process.env.SEASON_SETTLED_SCORING_AT = '2026-09-01T00:00:00Z';
    expect(settledScoringActive(new Date('2026-08-31T23:59:59Z'))).toBe(false);
    expect(settledScoringActive(new Date('2026-09-01T00:00:00Z'))).toBe(true);
    process.env.SEASON_SETTLED_SCORING_AT = '2000-01-01T00:00:00Z';
    expect(settledScoringActive(new Date('2026-08-31T23:59:59Z'))).toBe(true);
  });

  test('the trade cutoff the rules publish', () => {
    expect(SEASON_TRADE_CUTOFF_HOURS).toBe(6);
  });
});
