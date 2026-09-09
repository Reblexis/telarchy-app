import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';

/**
 * The proposal row (docs/ui-conventions.md, "The proposals board", revised
 * 2026-09-09; record notes/decisions/ui-conventions.md).
 *
 * Two lines, and only one of them is loud: the title and the impact on the
 * first, the four facts as an ICON ROW on the second, the two verbs on the
 * right. Nothing is stacked on the right edge, which is what made this row
 * unreadable in a 340px rail ("4 things below each otherh seem like too
 * much", Viktor, 2026-09-09). And every priced row can be traded from where
 * it is read: a priced row with nothing to press is a table, not a market.
 */

vi.mock('../../lib/api', () => ({
  api: { getParticipant: async () => ({ payoutHandle: 'paid@example.com' }) },
}));

import { JobsBoard } from '../JobsBoard';

const pair = (over: Record<string, unknown> = {}) => ({
  metricId: 'rev',
  metricName: 'Net revenue (USD)',
  targetDate: '2026-12',
  resolvesOn: '2026-12-31T00:00:00Z',
  approvedConsensus: 5_100,
  declinedConsensus: 5_000,
  delta: 100,
  approvedMarketId: 'm-a',
  declinedMarketId: 'm-d',
  approvedProbability: 0.5,
  approvedLiquidity: 100,
  declinedProbability: 0.5,
  declinedLiquidity: 100,
  approvedPool: 1_500,
  declinedPool: 1_500,
  approvedTraders: 1,
  declinedTraders: 0,
  approvedVolume: 0,
  declinedVolume: 0,
  rangeMin: 0,
  rangeMax: 25_000,
  ...over,
});

const proposal = (over: Record<string, unknown> = {}) =>
  ({
    id: 'c1',
    number: 7,
    title: 'Open source a trading agent',
    description: '',
    askUsd: 80,
    proposedByName: 'Jason',
    proposedByHandle: 'jason-handle',
    createdAt: '2026-09-01T10:00:00Z',
    decideBy: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString(),
    status: 'pending',
    marketPairCount: 1,
    markets: [pair()],
    ...over,
  }) as never;

const base = {
  unit: '$',
  selectedId: null,
  onSelect: () => {},
  onPropose: async () => {},
  signedIn: true,
  onRequireSignup: () => {},
  workspaceName: 'Telarchy',
  horizonDate: '2026-12',
  horizonMetricId: 'rev',
};

function board(props: Record<string, unknown> = {}, ps = [proposal()]) {
  return render(
    <MemoryRouter>
      <JobsBoard {...base} {...props} proposals={ps} />
    </MemoryRouter>,
  );
}

describe('the row is two lines, and only one of them is loud', () => {
  test('the title and the impact share the first line; the facts are an icon row under it', () => {
    const { container } = board();
    const row = container.querySelector('.pubws-prow') as HTMLElement;
    expect(row.querySelector('.pubws-ballot-title')?.textContent).toContain('Open source a trading agent');
    expect(row.querySelector('.pubws-prow-impact')?.textContent).toContain('100');
    const meta = row.querySelector('.pubws-prow-meta') as HTMLElement;
    expect(meta.textContent).toContain('Jason');
    expect(meta.textContent).toContain('$80');
    expect(meta.textContent).toContain('3,000');
    // Icons, not words: each fact carries its sentence as a hover instead.
    expect(meta.textContent).not.toMatch(/to them|pool|decides/);
    expect(meta.querySelectorAll('svg').length).toBeGreaterThanOrEqual(3);
    expect([...meta.querySelectorAll('span[title]')].map(s => s.getAttribute('title')).join(' ')).toMatch(
      /credits behind this proposal/,
    );
  });

  test('nothing is stacked on the right edge: impact and verbs are one horizontal group', () => {
    const { container } = board();
    const row = container.querySelector('.pubws-prow') as HTMLElement;
    // Everything that used to hang under the impact (pool, clock) is on the
    // meta line now, so the right edge carries the number and the verbs.
    const impact = row.querySelector('.pubws-prow-impact') as HTMLElement;
    expect(impact.querySelector('.pubws-ballot-pool')).toBeNull();
    expect(impact.querySelector('.pubws-ballot-clock')).toBeNull();
    expect(row.querySelector('.pubws-prow-meta .pubws-ballot-pool')).toBeTruthy();
    expect(row.querySelector('.pubws-prow-meta .pubws-ballot-clock')).toBeTruthy();
  });
});

describe('every priced row can be traded from where it is read', () => {
  test('a pending, priced proposal carries Higher and Lower', () => {
    const traded: Array<[string, string]> = [];
    const { container } = board({ onTrade: (id: string, dir: string) => traded.push([id, dir]) });
    const acts = container.querySelector('.pubws-prow-acts') as HTMLElement;
    fireEvent.click(within(acts).getByRole('button', { name: 'Higher' }));
    fireEvent.click(within(acts).getByRole('button', { name: 'Lower' }));
    expect(traded).toEqual([
      ['c1', 'higher'],
      ['c1', 'lower'],
    ]);
  });

  test('pressing a verb does not also toggle the row open', () => {
    const picked: string[] = [];
    const { container } = board({ onSelect: (id: string) => picked.push(id), onTrade: () => {} });
    const acts = container.querySelector('.pubws-prow-acts') as HTMLElement;
    fireEvent.click(within(acts).getByRole('button', { name: 'Higher' }));
    expect(picked).toEqual([]);
    // The title still selects it.
    fireEvent.click(screen.getByTitle('Open source a trading agent'));
    expect(picked).toEqual(['c1']);
  });

  test('a decided proposal has no verbs: nothing can be traded on it any more', () => {
    const { container } = board({ onTrade: () => {} }, [proposal({ status: 'approved', resolvedAt: '2026-09-05' })]);
    expect(container.querySelector('.pubws-prow-acts')).toBeNull();
  });

  test('an unpriced proposal has no verbs: there is no market to trade against', () => {
    const { container } = board({ onTrade: () => {} }, [
      proposal({ markets: [pair({ delta: null, approvedConsensus: null, declinedConsensus: null })] }),
    ]);
    expect(container.querySelector('.pubws-prow-impact')?.textContent).toContain('open');
    expect(container.querySelector('.pubws-prow-acts')).toBeNull();
  });

  test('with no handler there are no verbs, so the board stays a list', () => {
    const { container } = board();
    expect(container.querySelector('.pubws-prow-acts')).toBeNull();
  });
});
