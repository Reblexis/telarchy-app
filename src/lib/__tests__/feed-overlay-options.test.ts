import { describe, expect, test } from 'vitest';
import { overlayFeedQuotes } from '../feed-overlay';

/**
 * The open step's prices read from the feed, for a proposal with options
 * (docs/ui-conventions.md, "The feed drives the floor"; docs/guides/
 * proposals.md, "More than two options"): the feed's `price` is the
 * option's consensus, its `lead` is the option's delta, and the row's
 * delta is the leader's lead. A two-branch proposal keeps taking the pair
 * shape, and a quote of the wrong shape for a proposal is ignored.
 */
const opt = (id: string, label: string, consensus: number | null, delta: number | null) => ({
  id,
  label,
  marketId: `m-${id}`,
  consensus,
  probability: 0.5,
  liquidity: 100,
  pool: 100,
  traders: 1,
  volume: 0,
  delta,
});
const row = (over: Record<string, unknown> = {}) => ({
  metricName: 'Reached length',
  targetDate: '2026-09-11T17:30',
  resolvesOn: '2026-09-11T17:31:00Z',
  approvedConsensus: null,
  declinedConsensus: null,
  delta: 0,
  options: [opt('forward', 'Continue', 3, 0), opt('left', 'Turn left', 3, 0), opt('right', 'Turn right', 3, 0)],
  ...over,
});
const proposal = (id: string, over: Record<string, unknown> = {}) =>
  ({
    id,
    number: 1,
    title: 't',
    status: 'pending',
    options: [
      { id: 'forward', label: 'Continue' },
      { id: 'left', label: 'Turn left' },
      { id: 'right', label: 'Turn right' },
    ],
    markets: [row()],
    ...over,
  }) as never;
const ws = (proposals: unknown[]) => ({ workspaceId: 'w', proposals }) as never;
type Out = {
  proposals: Array<{
    markets: Array<{
      delta: number | null;
      options: Array<{ id: string; consensus: number | null; delta: number | null }>;
    }>;
  }>;
};
const feed = {
  p1: {
    options: {
      forward: { price: 7.2, lead: -1.7 },
      left: { price: 8.9, lead: 1.7 },
      right: { price: 5.1, lead: -3.8 },
    },
  },
};

describe('overlayFeedQuotes with options', () => {
  test("each option takes the feed's price as its consensus and lead as its delta; the row's delta is the leader's lead", () => {
    const out = overlayFeedQuotes(ws([proposal('p1')]), feed) as Out;
    const m = out.proposals[0].markets[0];
    expect(m.options.map(o => [o.id, o.consensus, o.delta])).toEqual([
      ['forward', 7.2, -1.7],
      ['left', 8.9, 1.7],
      ['right', 5.1, -3.8],
    ]);
    expect(m.delta).toBeCloseTo(1.7, 9);
  });

  test('an option the feed prices null is left as the payload had it, and with fewer than two priced the row has no lead', () => {
    const out = overlayFeedQuotes(ws([proposal('p1')]), {
      p1: {
        options: {
          forward: { price: null, lead: null },
          left: { price: 8.9, lead: null },
          right: { price: null, lead: null },
        },
      },
    }) as Out;
    const m = out.proposals[0].markets[0];
    expect(m.options.find(o => o.id === 'forward')).toMatchObject({ consensus: 3, delta: 0 });
    expect(m.options.find(o => o.id === 'left')).toMatchObject({ consensus: 8.9 });
    expect(m.delta).toBeNull();
  });

  test('a pair-shaped quote on an option proposal, and an option-shaped quote on a two-branch proposal, are ignored', () => {
    const pairRow = { ...row(), options: null, approvedConsensus: 3, declinedConsensus: 3, delta: 0 };
    const rows = [proposal('opts'), proposal('pair', { options: null, markets: [pairRow] })];
    const out = overlayFeedQuotes(ws(rows), {
      opts: { approved: 9, declined: 1 },
      pair: { options: { forward: { price: 9, lead: 1 }, left: { price: 8, lead: -1 } } },
    }) as Out & { proposals: Array<{ markets: Array<{ approvedConsensus: number | null }> }> };
    expect(out.proposals[0].markets[0].delta).toBe(0);
    expect(out.proposals[0].markets[0].options.every(o => o.consensus === 3)).toBe(true);
    expect(out.proposals[1].markets[0].approvedConsensus).toBe(3);
    expect(out.proposals[1].markets[0].delta).toBe(0);
  });

  test('a decided option proposal and one with two rows are untouched, and unchanged prices return the same object', () => {
    const rows = [proposal('decided', { status: 'approved' }), proposal('two', { markets: [row(), row()] })];
    const w = ws(rows);
    const out = overlayFeedQuotes(w, { decided: feed.p1, two: feed.p1 });
    expect(out).toBe(w);
    const same = ws([proposal('p1')]);
    expect(
      overlayFeedQuotes(same, {
        p1: { options: { forward: { price: 3, lead: 0 }, left: { price: 3, lead: 0 }, right: { price: 3, lead: 0 } } },
      }),
    ).toBe(same);
  });
});
