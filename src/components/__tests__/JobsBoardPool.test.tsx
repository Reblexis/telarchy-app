import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';

/**
 * What is behind a proposal, on the board (owner ask 2026-09-02: "show total
 * liquidity next to a proposal in the proposals panel", and the rule it
 * serves: "proposals are ordered by total liquidity available").
 *
 * The pool is the sum of BOTH branches across every pair, because that is
 * what somebody put behind this proposal's forecast; a reader comparing two
 * proposals is comparing conviction, and half of it is not the number.
 */

vi.mock('../../lib/api', () => ({
  api: { getParticipant: async () => ({ payoutHandle: 'paid@example.com' }) },
}));

import { JobsBoard, poolOf } from '../JobsBoard';

const pair = (targetDate: string, approvedPool: number | null, declinedPool: number | null) => ({
  metricId: 'rev',
  metricName: 'Net revenue (USD)',
  targetDate,
  resolvesOn: '2026-12-31T00:00:00Z',
  approvedConsensus: 5_100,
  declinedConsensus: 5_000,
  delta: 100,
  approvedMarketId: `a-${targetDate}`,
  declinedMarketId: `d-${targetDate}`,
  approvedProbability: 0.5,
  approvedLiquidity: 100,
  declinedProbability: 0.5,
  declinedLiquidity: 100,
  approvedPool,
  declinedPool,
  approvedTraders: 1,
  declinedTraders: 0,
  approvedVolume: 0,
  declinedVolume: 0,
  rangeMin: 0,
  rangeMax: 25_000,
});

const proposal = (id: string, title: string, pools: Array<[number | null, number | null]>, delta = 100) =>
  ({
    id,
    title,
    description: '',
    askUsd: null,
    proposedByName: 'Jason',
    createdAt: '2026-09-01T10:00:00Z',
    status: 'pending',
    marketPairCount: pools.length,
    markets: pools.map(([a, d], i) => ({ ...pair(`2026-1${i}`, a, d), delta })),
  }) as never;

const base = {
  unit: '$',
  selectedId: null,
  onSelect: () => {},
  onPropose: async () => {},
  signedIn: true,
  onRequireSignup: () => {},
  workspaceName: 'Telarchy',
};

describe('the pool behind a proposal', () => {
  test('is both branches of every pair, added up', () => {
    expect(
      poolOf(
        proposal('c', 'x', [
          [250, 250],
          [1_000, 500],
        ]),
      ),
    ).toBe(2_000);
  });

  test('counts a branch with no market as nothing, not as a hole', () => {
    expect(poolOf(proposal('c', 'x', [[250, null]]))).toBe(250);
    expect(poolOf(proposal('c', 'x', [[null, null]]))).toBe(0);
  });

  test('prints beside the proposal, under its impact', () => {
    render(
      <MemoryRouter>
        <JobsBoard
          {...base}
          proposals={[proposal('c1', 'Open source a trading agent', [[3_500, 3_480]])]}
          horizonDate="2026-10"
          horizonMetricId="rev"
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('6,980')).toBeInTheDocument();
  });

  // The rule the number exists for: money decides the order, so a proposal
  // somebody funded is read first.
  test('orders the ballot deepest first', () => {
    render(
      <MemoryRouter>
        <JobsBoard
          {...base}
          proposals={[
            proposal('thin', 'A proposal nobody funded', [[250, 250]]),
            proposal('deep', 'A proposal somebody believes in', [[18_000, 18_556]]),
            proposal('mid', 'A proposal in between', [[3_000, 3_000]]),
          ]}
          horizonDate="2026-10"
          horizonMetricId="rev"
        />
      </MemoryRouter>,
    );
    const titles = [...document.querySelectorAll('.pubws-ballot-title')].map(n => n.textContent);
    expect(titles).toEqual(['A proposal somebody believes in', 'A proposal in between', 'A proposal nobody funded']);
  });

  test('a proposal with nothing behind it still shows the zero, and sits last', () => {
    render(
      <MemoryRouter>
        <JobsBoard
          {...base}
          proposals={[proposal('empty', 'Unfunded', [[null, null]]), proposal('funded', 'Funded', [[500, 500]])]}
          horizonDate="2026-10"
          horizonMetricId="rev"
        />
      </MemoryRouter>,
    );
    const titles = [...document.querySelectorAll('.pubws-ballot-title')].map(n => n.textContent);
    expect(titles).toEqual(['Funded', 'Unfunded']);
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  // Somebody has to tell the person about to post one that money moves it.
  test('the propose footer says what puts a proposal up the list', () => {
    render(
      <MemoryRouter>
        <JobsBoard {...base} proposals={[]} horizonDate="2026-10" horizonMetricId="rev" />
      </MemoryRouter>,
    );
    expect(screen.getByText(/credits behind it and it moves up/i)).toBeInTheDocument();
  });
});
