/**
 * The month's pool board (docs/workspace-pools.md): the pool figure, the
 * eligible trader's share and payout, the excluded one's reason, and the
 * rules link only once the month has started.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const getWorkspacePool = vi.fn();

vi.mock('../../lib/api', () => ({
  api: {
    getMarketplaceWorkspace: async () => ({ workspaceId: 'ws-1', name: 'Acme', slug: 'acme' }),
    getWorkspacePool: (...args: unknown[]) => getWorkspacePool(...args),
    getLeaderboard: async () => ({ participants: [{ id: 'alice', nickname: 'alice' }] }),
  },
}));

import { PoolPage } from '../PoolPage';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/:slug/pools/:month" element={<PoolPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getWorkspacePool.mockReset();
});

describe('the pool board', () => {
  test('shows the pool, the shares, the exclusions, and the rules link for a running month', async () => {
    getWorkspacePool.mockResolvedValue({
      workspaceId: 'ws-1',
      month: '2026-10',
      status: 'running',
      poolCents: 8000,
      rolloverCents: 2000,
      totalCents: 10000,
      monthStart: '2026-10-01T00:00:00.000Z',
      monthEnd: '2026-11-01T00:00:00.000Z',
      final: false,
      entries: [
        {
          agentId: 'alice',
          score: 120,
          tradeCount: 12,
          marketCount: 2,
          earlyTradeCount: 5,
          eligible: true,
          exclusion: null,
          share: 1,
          payoutCents: 10000,
          rank: 1,
        },
        {
          agentId: 'owner',
          score: 300,
          tradeCount: 12,
          marketCount: 2,
          earlyTradeCount: 5,
          eligible: false,
          exclusion: 'owner_or_admin',
          share: 0,
          payoutCents: 0,
          rank: null,
        },
      ],
    });
    renderAt('/acme/pools/2026-10');
    expect((await screen.findAllByText('$100.00')).length).toBeGreaterThan(0);
    expect(getWorkspacePool).toHaveBeenCalledWith('ws-1', '2026-10');
    expect(await screen.findByText('alice')).toBeInTheDocument();
    expect(screen.getByText('100% of the pool')).toBeInTheDocument();
    expect(screen.getByText('owns or administers a workspace')).toBeInTheDocument();
    expect(screen.getByText('The rules.').closest('a')?.getAttribute('href')).toBe('/legal/pools/ws-1/2026-10');
    expect(screen.getByText('Board, live')).toBeInTheDocument();
  });

  test('a scheduled month has no rules link and says nothing has resolved', async () => {
    getWorkspacePool.mockResolvedValue({
      workspaceId: 'ws-1',
      month: '2026-11',
      status: 'scheduled',
      poolCents: 500,
      rolloverCents: 0,
      totalCents: 500,
      monthStart: '2026-11-01T00:00:00.000Z',
      monthEnd: '2026-12-01T00:00:00.000Z',
      final: false,
      entries: [],
    });
    renderAt('/acme/pools/2026-11');
    expect(await screen.findByText('$5.00')).toBeInTheDocument();
    expect(screen.queryByText('The rules.')).toBeNull();
    expect(screen.getByText('Nothing has resolved inside this month yet.')).toBeInTheDocument();
  });
});
