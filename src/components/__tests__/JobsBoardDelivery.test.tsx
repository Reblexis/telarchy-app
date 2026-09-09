import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';

/**
 * Whether the approved work happened, on the board (docs/guides/proposals.md,
 * "After approval: say whether it happened").
 *
 * The market priced "if this is approved, the metric lands at X". Approval was
 * the last thing the row said, so a reader could not tell a market that was
 * wrong from a promise that was not kept. What is pinned here is that an
 * approved row always says which of the three it is, and that a decided-but-
 * not-approved row says nothing about delivery, because nothing was promised.
 */

vi.mock('../../lib/api', () => ({
  api: { getParticipant: async () => ({ payoutHandle: 'paid@example.com' }) },
}));

import { JobsBoard } from '../JobsBoard';

const HORIZON = '2026-09';

const proposal = (id: string, title: string, status: string, delivery?: Record<string, unknown>) =>
  ({
    id,
    title,
    description: '',
    askUsd: 10,
    proposedByName: 'Jason',
    createdAt: '2026-08-25T10:00:00Z',
    status,
    resolvedAt: status === 'pending' ? null : '2026-08-28T10:00:00Z',
    marketPairCount: 1,
    markets: [
      {
        metricId: 'rev',
        metricName: 'net revenue',
        targetDate: HORIZON,
        resolvesOn: '2026-09-01T00:00:00Z',
        approvedConsensus: 102,
        declinedConsensus: 100,
        delta: 2,
        approvedMarketId: `${id}-a`,
        declinedMarketId: `${id}-d`,
        approvedProbability: 0.5,
        approvedLiquidity: 100,
        declinedProbability: 0.5,
        declinedLiquidity: 100,
        rangeMin: 0,
        rangeMax: 1000,
      },
    ],
    ...delivery,
  }) as never;

const base = {
  unit: '$',
  selectedId: null,
  onSelect: () => {},
  onPropose: async () => {},
  signedIn: true,
  onRequireSignup: () => {},
  workspaceName: 'Telarchy',
  horizonDate: HORIZON,
  horizonMetricId: 'rev',
};

function board(proposals: unknown[]) {
  const view = render(
    <MemoryRouter>
      <JobsBoard {...base} proposals={proposals as never} />
    </MemoryRouter>,
  );
  // The decided proposals are folded away by default; this spec is about them.
  const show = screen.queryByText('Show');
  if (show) fireEvent.click(show);
  return view;
}

describe('an approved proposal says whether it happened', () => {
  test('delivered carries the day it was delivered', () => {
    board([
      proposal('d1', 'Reach out to 30 founders', 'approved', {
        deliveryState: 'delivered',
        deliveredAt: '2026-09-02T00:00:00Z',
        deliveryNote: '30 written to, 4 replied',
      }),
    ]);
    expect(screen.getByText(/delivered/)).toBeTruthy();
    expect(screen.getByText(/2 Sep/)).toBeTruthy();
  });

  test('in progress says so', () => {
    board([proposal('d1', 'A day on the UI', 'approved', { deliveryState: 'in_progress' })]);
    expect(screen.getByText(/in progress/)).toBeTruthy();
  });

  test('an approved proposal nobody has spoken for says not started, rather than saying nothing', () => {
    board([proposal('d1', 'Apply to YC', 'approved', { deliveryState: 'not_started' })]);
    expect(screen.getByText(/not started/)).toBeTruthy();
  });

  test('a payload from before the field reads as not started, not as delivered', () => {
    board([proposal('d1', 'An old one', 'approved')]);
    expect(screen.getByText(/not started/)).toBeTruthy();
  });
});

describe('what has nothing to report', () => {
  test('a declined proposal was never promised, so it carries no delivery state', () => {
    board([proposal('d1', 'Sponsor a prize', 'declined', { deliveryState: 'not_started' })]);
    expect(screen.queryByText(/not started/)).toBeNull();
  });

  test('a pending proposal is still on the ballot and carries none either', () => {
    board([proposal('p1', 'Still deciding', 'pending', { deliveryState: 'not_started' })]);
    expect(screen.queryByText(/not started/)).toBeNull();
  });
});
