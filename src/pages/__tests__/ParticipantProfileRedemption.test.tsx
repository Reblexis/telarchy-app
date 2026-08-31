import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';

/**
 * A redemption on a profile reads as a redemption.
 *
 * The engine cashes the matched pairs a contrarian buy leaves behind. The
 * profile used to render that ledger row by the sign of its cost, so a
 * participant's own page told them they had SOLD something they never sold
 * (participant report 2026-08-31).
 */

vi.mock('../../lib/api', () => ({
  api: { getPublicProfile: vi.fn() },
}));
vi.mock('../../components/PageTopBar', () => ({ PageTopBar: () => null }));
vi.mock('react-router-dom', async importOriginal => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useParams: () => ({ id: 'quroe' }),
}));

import { api } from '../../lib/api';
import { ParticipantProfilePage } from '../ParticipantProfilePage';

const base = {
  id: 'quroe',
  nickname: 'Quroe',
  bio: null,
  intent: null,
  joinedAt: '2026-08-20T00:00:00.000Z',
  manifoldUsername: null,
  stats: { rank: 4, totalEarnings: 0, settledEarnings: 0, openEarnings: 0, totalTrades: 3, lastTradeAt: null },
  openPositions: [],
  proposedJobs: [],
  balanceHistory: [],
  pnlHistory: [],
};

function profileWith(trades: unknown[]) {
  return { ...base, recentTrades: trades };
}

describe('a redemption on a profile', () => {
  test('reads as a redemption, never as a sell', async () => {
    vi.mocked(api.getPublicProfile).mockResolvedValue(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      profileWith([
        {
          id: 't-redeem',
          workspaceId: 'ws',
          workspaceName: 'Telarchy',
          marketId: 'm1',
          proposalId: null,
          metricName: 'Implied valuation (USD)',
          targetDate: '2026-08-31',
          direction: null,
          kind: 'redeem',
          shares: 4.8,
          cost: -4.8,
          createdAt: new Date().toISOString(),
        },
        {
          id: 't-buy',
          workspaceId: 'ws',
          workspaceName: 'Telarchy',
          marketId: 'm1',
          proposalId: null,
          metricName: 'Implied valuation (USD)',
          targetDate: '2026-08-31',
          direction: 'lower',
          kind: 'buy',
          shares: 5462,
          cost: 3900,
          createdAt: new Date().toISOString(),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any,
    );

    render(
      <MemoryRouter>
        <ParticipantProfilePage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText(/Redeemed 4.8 matched pairs/)).toBeTruthy());
    expect(screen.queryByText(/Sold/)).toBeNull();
    expect(screen.getByText(/Bought 5,462 lower/)).toBeTruthy();
  });

  test('a real sell still says sold', async () => {
    vi.mocked(api.getPublicProfile).mockResolvedValue(
      profileWith([
        {
          id: 't-sell',
          workspaceId: 'ws',
          workspaceName: 'Telarchy',
          marketId: 'm1',
          proposalId: null,
          metricName: 'Implied valuation (USD)',
          targetDate: '2026-08-31',
          direction: 'higher',
          kind: 'sell',
          shares: 12,
          cost: -30,
          createdAt: new Date().toISOString(),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any,
    );

    render(
      <MemoryRouter>
        <ParticipantProfilePage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText(/Sold 12.0 higher/)).toBeTruthy());
  });
});
