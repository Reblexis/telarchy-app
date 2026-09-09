import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';

vi.mock('../../lib/api', () => ({ api: { getPublicProfile: vi.fn() } }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../../components/PageTopBar', () => ({ PageTopBar: () => null }));

import { api } from '../../lib/api';
import { ParticipantProfilePage } from '../ParticipantProfilePage';

/**
 * Whether they were right (docs/ui-conventions.md, "The participant profile").
 *
 * The profile told a forecaster how many credits they hold and never whether
 * their calls landed, which is the question that brings one back. What is
 * pinned here is that the answer is the record itself: one row per settled
 * market, the close and their own call on that market's own scale. A
 * participant with nothing settled is told that, rather than shown a
 * flattering zero.
 */
const BASE = {
  id: 'kestrel',
  nickname: 'kestrel',
  image: null,
  manifoldUsername: null,
  intent: null,
  bio: null,
  joinedAt: '2026-08-14T00:00:00.000Z',
  parent: null,
  children: [],
  balance: 12480,
  stats: {
    rank: 3,
    calibration: 0.62,
    accuracy: 0.63,
    totalEarnings: 1240,
    settledEarnings: 900,
    openEarnings: 340,
    resolvedMarkets: 19,
    totalTrades: 42,
    tradedVolume: 8000,
    lastTradeAt: '2026-09-08T00:00:00.000Z',
  },
  activeWorkspaces: [],
  openPositions: [],
  recentTrades: [],
  proposedJobs: [],
  balanceHistory: [],
  profitHistory: [],
  pnlHistory: [],
  settledCalls: [
    {
      workspaceId: 'w1',
      workspaceName: 'Telarchy',
      workspaceSlug: 'telarchy',
      marketId: 'm1',
      metricName: 'Active traders',
      targetDate: '2026-08',
      resolvedAt: '2026-09-01T00:00:00.000Z',
      close: 6,
      call: 7,
      rangeMin: 0,
      rangeMax: 50,
    },
    {
      workspaceId: 'w1',
      workspaceName: 'Telarchy',
      workspaceSlug: 'telarchy',
      marketId: 'm2',
      metricName: 'Telarchy revenue (USD)',
      targetDate: '2026-08',
      resolvedAt: '2026-08-25T00:00:00.000Z',
      close: 0,
      call: null,
      rangeMin: 0,
      rangeMax: 1000,
    },
  ],
};

async function renderProfile(profile: unknown) {
  (api.getPublicProfile as ReturnType<typeof vi.fn>).mockResolvedValue(profile);
  const { container } = render(
    <MemoryRouter initialEntries={['/p/kestrel']}>
      <Routes>
        <Route path="/p/:id" element={<ParticipantProfilePage />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText('kestrel')).toBeTruthy());
  return container;
}

describe('the strip says whether they were right', () => {
  test('accuracy is a cell, as a share of the markets that resolved', async () => {
    const container = await renderProfile(BASE);
    const cell = container.querySelector('[data-testid="prof-stat-accuracy"]');
    expect(cell?.textContent).toContain('63%');
    expect(cell?.textContent).toContain('19');
  });

  test('a participant with nothing resolved is told so, not shown a zero', async () => {
    const container = await renderProfile({
      ...BASE,
      stats: { ...BASE.stats, accuracy: null, calibration: null, resolvedMarkets: 0 },
      settledCalls: [],
    });
    const cell = container.querySelector('[data-testid="prof-stat-accuracy"]');
    expect(cell?.textContent).toContain('not yet');
    expect(cell?.textContent).not.toContain('0%');
  });
});

describe('every settled market, with the close and their call', () => {
  test('one row per settled market, newest first', async () => {
    const container = await renderProfile(BASE);
    const rows = container.querySelectorAll('.prof-call');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Active traders');
  });

  test('a row carries the close, the call and the distance between them', async () => {
    const container = await renderProfile(BASE);
    const first = container.querySelector('.prof-call');
    expect(first?.textContent).toContain('closed 6');
    expect(first?.textContent).toContain('called 7');
    expect(first?.textContent).toContain('off by 1');
  });

  test('a call that was never recorded says so rather than sitting at zero', async () => {
    const container = await renderProfile(BASE);
    const second = container.querySelectorAll('.prof-call')[1];
    expect(second.textContent).toContain('no call recorded');
    // One mark on the scale, the close; nothing pretending to be their call.
    expect(second.querySelectorAll('.prof-call-dot')).toHaveLength(1);
  });

  test('both marks sit on the market’s own scale', async () => {
    const container = await renderProfile(BASE);
    const first = container.querySelector('.prof-call');
    expect(first?.querySelectorAll('.prof-call-dot')).toHaveLength(2);
    expect(first?.textContent).toContain('0 to 50');
  });

  test('nothing settled yet is an empty section, not a missing one', async () => {
    const container = await renderProfile({ ...BASE, settledCalls: [] });
    expect(container.textContent).toContain('Settled');
    expect(container.querySelectorAll('.prof-call')).toHaveLength(0);
  });
});
