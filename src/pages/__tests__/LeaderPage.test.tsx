import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../lib/api', () => ({
  api: {
    getSeasons: vi.fn(),
    getMySeason: vi.fn(),
    getFloorLeaders: vi.fn(),
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

// getFloorLeaders is the one call that decides all-time-vs-season and returns
// the season it chose. `seasonMode:false` is the all-time board (with an
// optional draft/settled season for the banner); `true` is the running-season
// standings board.
const mockBoard = (participants: unknown[], seasonMode = false, season: unknown = draftSeason) =>
  vi.mocked(api.getFloorLeaders).mockResolvedValue({ participants, seasonMode, season } as never);

beforeEach(() => {
  vi.mocked(api.getPublicWorkspaces).mockResolvedValue([] as never);
  vi.mocked(api.getMySeason).mockResolvedValue({ entered: false } as never);
});

describe('the season chip on the all-time board (draft season)', () => {
  test('before the season starts, an entrant shows a neutral marker, not a dollar', async () => {
    // No baselines exist yet, so there is no rank to hand a prize on. Painting
    // the $500 top rung on every entrant read as "this person wins $500" when
    // two people were entered (owner report 2026-08-21). Neutral until it runs.
    mockBoard([trader({ id: 'in', nickname: 'entrant', seasonEntered: true, seasonPrizeUsd: null })]);
    renderPage();
    expect(await screen.findByText('entered')).toBeInTheDocument();
    expect(screen.queryByText('$500')).toBeNull();
  });

  test('an entrant in the money shows the projected payout', async () => {
    mockBoard([trader({ id: 'in', nickname: 'entrant', seasonEntered: true, seasonPrizeUsd: 250 })]);
    renderPage();
    expect(await screen.findByText('$250')).toBeInTheDocument();
  });

  test('an entrant outside the rungs shows entered, never $0', async () => {
    mockBoard([trader({ id: 'in', nickname: 'entrant', seasonEntered: true, seasonPrizeUsd: 0 })]);
    renderPage();
    expect(await screen.findByText('entered')).toBeInTheDocument();
    expect(screen.queryByText('$0')).toBeNull();
  });

  test('a trader who has not entered carries no season chip', async () => {
    mockBoard([trader({ id: 'out', nickname: 'bystander', seasonEntered: false, seasonPrizeUsd: null })]);
    const { container } = renderPage();
    await screen.findByText('bystander');
    expect(container.querySelector('.lbp-prize')).toBeNull();
  });
});

describe('the board becomes the season standings while a season runs', () => {
  const runningSeason = { ...draftSeason, status: 'running' };
  // What getFloorLeaders returns in season mode: standings already adapted to
  // the leaderboard-entry shape (season score in totalEarnings, projected
  // payout in seasonPrizeUsd, totalTrades synthesised so the row survives the
  // never-traded filter).
  const standing = (o: Record<string, unknown>) =>
    trader({ seasonEntered: true, totalTrades: 1, resolvedMarkets: 0, ...o });

  test('the heading and lead name the season, not lifetime profit', async () => {
    mockBoard([standing({ id: 'a', nickname: 'kai', totalEarnings: 12, seasonPrizeUsd: 500 })], true, runningSeason);
    renderPage();
    expect(await screen.findByText('Standings')).toBeInTheDocument();
    expect(screen.getByText(/ranked by how much each/i)).toBeInTheDocument();
    // The lifetime "Traders" heading must be gone in season mode.
    expect(screen.queryByText('Traders')).toBeNull();
  });

  test('an in-the-money entrant shows the projected prize', async () => {
    mockBoard([standing({ id: 'a', nickname: 'kai', totalEarnings: 12, seasonPrizeUsd: 500 })], true, runningSeason);
    renderPage();
    expect(await screen.findByText('$500')).toBeInTheDocument();
  });

  test('an entrant outside the paying places shows a dash, not "entered"', async () => {
    mockBoard([standing({ id: 'a', nickname: 'kai', totalEarnings: 0, seasonPrizeUsd: 0 })], true, runningSeason);
    renderPage();
    await screen.findByText('kai');
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('entered')).toBeNull();
  });

  test('the lifetime trades sub-line is hidden in season mode', async () => {
    mockBoard([standing({ id: 'a', nickname: 'kai', totalEarnings: 0, seasonPrizeUsd: 0, totalTrades: 1 })], true, runningSeason);
    const { container } = renderPage();
    await screen.findByText('kai');
    // The sub-line shows lifetime trades/accuracy; the synthesised "1 trade" is
    // meaningless per-season, so the whole line is gone in season mode.
    expect(container.querySelector('.lbp-sub')).toBeNull();
  });
});
