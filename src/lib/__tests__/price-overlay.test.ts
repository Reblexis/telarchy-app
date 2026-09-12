import { describe, expect, test } from 'vitest';
import type { FloorPriceBook, PublicWorkspace } from '../api';
import { overlayFloorPrices } from '../price-overlay';

/**
 * The once-a-second prices laid over the floor payload (docs/ui-conventions.md,
 * "The floor's live poll"): every price the floor shows moves in place, and
 * nothing is reordered or replaced that did not change. A list replaced at a
 * refresh once opened the wrong proposal on a late click
 * (docs/reviews/2026-09-11-snake-design-critic-2.md), so identity is part of
 * the contract, not an optimisation.
 */

function books(...rows: FloorPriceBook[]): Map<string, FloorPriceBook> {
  return new Map(rows.map(b => [b.marketId, b]));
}
const book = (marketId: string, consensus: number | null, probability: number | null = 0.5, pool = 100) => ({
  marketId,
  consensus,
  probability,
  pool,
  tradeCount: 1,
});

function pair(over: Record<string, unknown> = {}) {
  return {
    metricId: 'metric',
    metricName: 'Revenue',
    targetDate: '2028',
    resolvesOn: '2029-01-01T00:00:00Z',
    approvedConsensus: 60,
    declinedConsensus: 50,
    delta: 10,
    approvedMarketId: 'm-a',
    declinedMarketId: 'm-d',
    approvedProbability: 0.6,
    approvedLiquidity: 200,
    declinedProbability: 0.5,
    declinedLiquidity: 200,
    approvedPool: 100,
    declinedPool: 100,
    approvedTraders: 0,
    declinedTraders: 0,
    approvedVolume: 0,
    declinedVolume: 0,
    rangeMin: 0,
    rangeMax: 100,
    ...over,
  };
}

function workspace(): PublicWorkspace {
  return {
    workspaceId: 'ws',
    name: 'Floor',
    slug: 'floor',
    markets: [
      {
        marketId: 'm-base',
        metricId: 'metric',
        metricName: 'Revenue',
        targetDate: '2028',
        resolvesOn: '2029-01-01T00:00:00Z',
        consensus: 40,
        probability: 0.4,
        liquidity: 200,
        pool: 100,
        rangeMin: 0,
        rangeMax: 100,
      },
      {
        marketId: 'm-base-2',
        metricId: 'metric',
        metricName: 'Revenue',
        targetDate: '2029',
        resolvesOn: '2030-01-01T00:00:00Z',
        consensus: 45,
        probability: 0.45,
        liquidity: 200,
        pool: 100,
        rangeMin: 0,
        rangeMax: 100,
      },
    ],
    proposals: [
      { id: 'p-1', title: 'One', status: 'pending', markets: [pair()] },
      {
        id: 'p-2',
        title: 'Options',
        status: 'pending',
        options: [
          { id: 'forward', label: 'Forward' },
          { id: 'left', label: 'Left' },
          { id: 'right', label: 'Right' },
        ],
        markets: [
          pair({
            approvedConsensus: null,
            declinedConsensus: null,
            approvedMarketId: null,
            declinedMarketId: null,
            delta: 2,
            options: [
              { id: 'forward', label: 'Forward', marketId: 'm-f', consensus: 5, probability: 0.05, pool: 10, delta: 2 },
              { id: 'left', label: 'Left', marketId: 'm-l', consensus: 3, probability: 0.03, pool: 10, delta: -2 },
              { id: 'right', label: 'Right', marketId: 'm-r', consensus: 1, probability: 0.01, pool: 10, delta: -4 },
            ],
          }),
        ],
      },
      { id: 'p-3', title: 'Decided', status: 'approved', markets: [pair({ approvedMarketId: 'm-dec' })] },
    ],
  } as unknown as PublicWorkspace;
}

describe('overlayFloorPrices', () => {
  test('nothing to lay over hands back the very same payload', () => {
    const ws = workspace();
    expect(overlayFloorPrices(ws, null)).toBe(ws);
    expect(overlayFloorPrices(ws, new Map())).toBe(ws);
    expect(overlayFloorPrices(null, books(book('m-base', 70)))).toBeNull();
  });

  test('prices equal to the payload change nothing, down to the object', () => {
    const ws = workspace();
    expect(overlayFloorPrices(ws, books(book('m-base', 40, 0.4, 100), book('m-a', 60, 0.6, 100)))).toBe(ws);
  });

  test('a baseline book moves its consensus, probability and pool in place', () => {
    const ws = workspace();
    const out = overlayFloorPrices(ws, books(book('m-base', 70, 0.7, 150)));
    expect(out).not.toBe(ws);
    expect(out!.markets[0]).toMatchObject({ marketId: 'm-base', consensus: 70, probability: 0.7, pool: 150 });
    // Untouched rows keep their identity; nothing is reordered.
    expect(out!.markets[1]).toBe(ws.markets[1]);
    expect(out!.markets.map(m => m.marketId)).toEqual(['m-base', 'm-base-2']);
    expect(out!.proposals).toBe(ws.proposals);
  });

  test('a pair moves both worlds and its delta', () => {
    const ws = workspace();
    const out = overlayFloorPrices(ws, books(book('m-a', 72, 0.72, 130), book('m-d', 49, 0.49, 90)));
    const m = out!.proposals![0].markets[0];
    expect(m).toMatchObject({
      approvedConsensus: 72,
      approvedProbability: 0.72,
      approvedPool: 130,
      declinedConsensus: 49,
      declinedProbability: 0.49,
      declinedPool: 90,
      delta: 23,
    });
    expect(out!.proposals![1]).toBe(ws.proposals![1]);
    expect(out!.proposals![2]).toBe(ws.proposals![2]);
  });

  test('a proposal with options moves each option and recomputes every lead', () => {
    const ws = workspace();
    // left overtakes forward.
    const out = overlayFloorPrices(ws, books(book('m-l', 9, 0.09, 12)));
    const m = out!.proposals![1].markets[0];
    const byId = Object.fromEntries((m.options ?? []).map(o => [o.id, o]));
    expect(byId.left).toMatchObject({ consensus: 9, probability: 0.09, pool: 12, delta: 4 });
    expect(byId.forward.delta).toBe(-4);
    expect(byId.right.delta).toBe(-8);
    expect(m.delta).toBe(4);
    // The options stay in the proposer's order.
    expect((m.options ?? []).map(o => o.id)).toEqual(['forward', 'left', 'right']);
  });

  test('the proposals keep their order and their ids, whatever the prices do', () => {
    const ws = workspace();
    const out = overlayFloorPrices(ws, books(book('m-a', 1), book('m-f', 99)));
    expect(out!.proposals!.map(p => p.id)).toEqual(['p-1', 'p-2', 'p-3']);
  });

  test('a decided proposal is printed as it was ruled on, never repriced', () => {
    const ws = workspace();
    const out = overlayFloorPrices(ws, books(book('m-dec', 99)));
    expect(out).toBe(ws);
  });
});
