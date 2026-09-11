import { describe, expect, test } from 'vitest';
import { overlayFeedQuotes } from '../feed-overlay';

/**
 * The open step's prices read from the feed (docs/ui-conventions.md, "The
 * feed drives the floor"): a pending proposal the feed names, with one
 * pair, shows the feed's latest quotes; everything else is left alone.
 */
const pair = (over: Record<string, unknown> = {}) => ({
  metricName: 'Reached length',
  targetDate: '2026-09-11T17:30',
  resolvesOn: '2026-09-11T17:31:00Z',
  approvedConsensus: 3,
  declinedConsensus: 3,
  delta: 0,
  ...over,
});
const proposal = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, number: 1, title: 't', status: 'pending', markets: [pair()], ...over }) as never;
const ws = (proposals: unknown[]) => ({ workspaceId: 'w', proposals }) as never;

describe('overlayFeedQuotes', () => {
  test("a pending proposal with one pair takes the feed's approved, declined and impact", () => {
    const out = overlayFeedQuotes(ws([proposal('p1')]), { p1: { approved: 3.9, declined: 3.0 } });
    const m = (out as { proposals: Array<{ markets: Array<Record<string, number>> }> }).proposals[0].markets[0];
    expect(m.approvedConsensus).toBe(3.9);
    expect(m.declinedConsensus).toBe(3.0);
    expect(m.delta).toBeCloseTo(0.9, 9);
  });
  test('a decided proposal, one the feed does not name, one with two pairs, and null quotes are untouched', () => {
    const rows = [
      proposal('decided', { status: 'approved' }),
      proposal('unnamed'),
      proposal('two', { markets: [pair(), pair({ targetDate: '2026-09-11T18:30' })] }),
      proposal('nulls'),
    ];
    const out = overlayFeedQuotes(ws(rows), {
      decided: { approved: 9, declined: 1 },
      two: { approved: 9, declined: 1 },
      nulls: { approved: null, declined: 3 },
    }) as { proposals: Array<{ markets: Array<Record<string, number>> }> };
    for (const p of out.proposals)
      for (const m of p.markets) expect([m.approvedConsensus, m.declinedConsensus, m.delta]).toEqual([3, 3, 0]);
  });
  test('no feed, or no workspace: the same object back', () => {
    const w = ws([proposal('p1')]);
    expect(overlayFeedQuotes(w, {})).toBe(w);
    expect(overlayFeedQuotes(null, { p1: { approved: 1, declined: 0 } })).toBeNull();
  });
});
