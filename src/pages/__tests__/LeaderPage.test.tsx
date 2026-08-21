import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../lib/api', () => ({
  api: {
    getSeasons: vi.fn(),
    getMySeason: vi.fn(),
    getLeaderboard: vi.fn(),
    getPublicWorkspaces: vi.fn(),
    getMarketplaceWorkspace: vi.fn(),
  },
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../../hooks/useMyParticipantId', () => ({ useMyParticipantId: () => null }));
vi.mock('../TradePage', () => ({ TopBar: () => null }));
// The clock's arithmetic has its own suite (season-clock.test.ts); here it
// only gates the season line, so a fixed pre-start reading keeps this spec
// from depending on the wall clock.
vi.mock('../../lib/useSeasonClock', () => ({
  useSeasonClock: (season: unknown) => (season ? { phase: 'pre', headline: 'Starts in 1 day', entryOpen: true } : null),
}));

import { api } from '../../lib/api';
import { LeaderPage } from '../LeaderPage';

const draftSeason = {
  id: 's0', name: 'Season 0', status: 'draft',
  startsAt: '2026-08-22T00:00:00.000Z', endsAt: '2026-10-16T00:00:00.000Z',
  settledAt: null, poolUsd: 1000,
  ladder: [
    { place: 1, prizeUsd: 500 }, { place: 2, prizeUsd: 250 },
    { place: 3, prizeUsd: 125 }, { place: 4, prizeUsd: 75 }, { place: 5, prizeUsd: 50 },
  ],
  rulesUrl: '/legal/season-0',
};

const trader = (overrides: Record<string, unknown>) => ({
  rank: 1, id: 'a1', nickname: 'kai', image: null, manifoldUsername: null,
  calibration: null, accuracy: null, totalEarnings: 42, resolvedMarkets: 0,
  totalTrades: 7, lastTradeAt: null, seasonEntered: false, seasonPrizeUsd: null,
  ...overrides,
});

const renderPage = () => render(<MemoryRouter><LeaderPage /></MemoryRouter>);

beforeEach(() => {
  vi.mocked(api.getSeasons).mockResolvedValue({ seasons: [draftSeason] } as never);
  vi.mocked(api.getPublicWorkspaces).mockResolvedValue([] as never);
});

describe('season prize beside an entrant', () => {
  test('before the season starts, an entrant shows a neutral marker, not a dollar', async () => {
    // No baselines exist yet, so there is no rank to hand a prize on. Painting
    // the $500 top rung on every entrant read as "this person wins $500" when
    // two people were entered (owner report 2026-08-21). Neutral until it runs.
    vi.mocked(api.getLeaderboard).mockResolvedValue({
      participants: [trader({ id: 'in', nickname: 'entrant', seasonEntered: true, seasonPrizeUsd: null })],
    } as never);
    renderPage();
    expect(await screen.findByText('entered')).toBeInTheDocument();
    expect(screen.queryByText('$500')).toBeNull();
  });

  test('while the season runs, an entrant in the money shows the projected payout', async () => {
    vi.mocked(api.getLeaderboard).mockResolvedValue({
      participants: [trader({ id: 'in', nickname: 'entrant', seasonEntered: true, seasonPrizeUsd: 250 })],
    } as never);
    renderPage();
    expect(await screen.findByText('$250')).toBeInTheDocument();
  });

  test('while the season runs, an entrant outside the rungs shows entered, never $0', async () => {
    vi.mocked(api.getLeaderboard).mockResolvedValue({
      participants: [trader({ id: 'in', nickname: 'entrant', seasonEntered: true, seasonPrizeUsd: 0 })],
    } as never);
    renderPage();
    expect(await screen.findByText('entered')).toBeInTheDocument();
    expect(screen.queryByText('$0')).toBeNull();
  });

  test('a trader who has not entered carries no season chip', async () => {
    vi.mocked(api.getLeaderboard).mockResolvedValue({
      participants: [trader({ id: 'out', nickname: 'bystander', seasonEntered: false, seasonPrizeUsd: null })],
    } as never);
    const { container } = renderPage();
    await screen.findByText('bystander');
    expect(container.querySelector('.lbp-prize')).toBeNull();
  });
});
