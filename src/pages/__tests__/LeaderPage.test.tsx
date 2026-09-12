import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../lib/api', async importOriginal => ({
  // The real adapter: the season section renders exactly what it maps.
  seasonStandingToEntry: (await importOriginal<typeof import('../../lib/api')>()).seasonStandingToEntry,
  api: {
    getSeasons: vi.fn(),
    getMySeason: vi.fn(),
    getLeaderboard: vi.fn(),
    getPublicWorkspaces: vi.fn(),
    getMarketplaceWorkspace: vi.fn(),
    getSeasonStandings: vi.fn(),
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
  id: 's0',
  name: 'Season 0',
  status: 'draft',
  startsAt: '2026-08-22T00:00:00.000Z',
  endsAt: '2026-10-16T00:00:00.000Z',
  settledAt: null,
  poolUsd: 1000,
  payoutMode: 'ladder' as const,
  minPayoutUsd: 0,
  strictEligibility: false,
  ladder: [
    { place: 1, prizeUsd: 500 },
    { place: 2, prizeUsd: 250 },
    { place: 3, prizeUsd: 125 },
    { place: 4, prizeUsd: 75 },
    { place: 5, prizeUsd: 50 },
  ],
  rulesUrl: '/legal/season-0',
};

const trader = (overrides: Record<string, unknown>) => ({
  rank: 1,
  id: 'a1',
  nickname: 'kai',
  image: null,
  manifoldUsername: null,
  calibration: null,
  accuracy: null,
  totalEarnings: 42,
  resolvedMarkets: 0,
  totalTrades: 7,
  lastTradeAt: null,
  seasonEntered: false,
  seasonPrizeUsd: null,
  ...overrides,
});

/** What the URL says, printed into the tree, because the picker's whole
 *  contract is that the choice lives in the query and nowhere else. */
function Where() {
  const loc = useLocation();
  return <i data-testid="where">{loc.search}</i>;
}

const renderPage = (entry = '/leaderboard') =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <LeaderPage />
      <Where />
    </MemoryRouter>,
  );

const where = () => screen.getByTestId('where').textContent;
const picker = () => screen.getByLabelText('Floor') as HTMLSelectElement;

// /leaderboard is the all-time global board (the season standings live on
// /season and behind "Show full leaderboard" on a workspace floor). The season
// is fetched only for the one-line banner and the per-row prize chip.
const mockBoard = (participants: unknown[]) =>
  vi.mocked(api.getLeaderboard).mockResolvedValue({ participants } as never);

beforeEach(() => {
  vi.mocked(api.getSeasons).mockResolvedValue({ seasons: [draftSeason] } as never);
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

describe('the season standings section (running season)', () => {
  // Owner ask 2026-08-22: /leaderboard carries a SEPARATE season board,
  // scored on the season metric, above the all-time field.
  test('a running season renders its own board, dollars included on a losing field', async () => {
    vi.mocked(api.getSeasons).mockResolvedValue({ seasons: [{ ...draftSeason, status: 'running' }] } as never);
    vi.mocked(api.getSeasonStandings).mockResolvedValue({
      season: { ...draftSeason, status: 'running' },
      participants: [
        { rank: 1, id: 'e1', nickname: 'elonmusk', score: -31, projectedPrizeUsd: 500 },
        { rank: 2, id: 'e2', nickname: 'the-big-boss', score: -94, projectedPrizeUsd: 250 },
      ],
    } as never);
    mockBoard([trader({ id: 'a1', nickname: 'kai' })]);
    renderPage();

    expect(await screen.findByText('Season 0 standings')).toBeInTheDocument();
    // The reported bug: a negative field showed a dash where the money was.
    // The dollars render twice per row on purpose: the desktop prize column
    // and the phone sub-line under the score (CSS shows one at a time).
    expect((await screen.findAllByText('$500')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('$250').length).toBeGreaterThan(0);
    expect(screen.getByText('-31 cr')).toBeInTheDocument();
    // The all-time board still stands separately underneath.
    expect(screen.getByText('kai')).toBeInTheDocument();
  });

  test('a draft season shows no standings section', async () => {
    vi.mocked(api.getSeasonStandings).mockClear();
    mockBoard([trader({})]);
    renderPage();
    await screen.findByText('kai');
    expect(vi.mocked(api.getSeasonStandings)).not.toHaveBeenCalled();
    expect(screen.queryByText('Season 0 standings')).toBeNull();
  });
});

describe('the settled/open split under the ranking number', () => {
  // Owner question 2026-08-24: does the board show what was earned from
  // resolutions alone? It ranked one blended number. Now the split prints
  // beneath it (docs/seasons.md "The score"); the total is still the rank key.
  test('an all-time row carries the settled/open split (columns, and the phone sub-line)', async () => {
    mockBoard([trader({ totalEarnings: 719.51, settledEarnings: 16.95, openEarnings: 702.56 })]);
    renderPage();
    // One formatter everywhere: under 1,000 the cents are kept, because a
    // season score of +9.73 rounding to +10 in one table and not the other
    // read as a bug (design review 2026-08-28).
    expect(await screen.findByText('+719.51 cr')).toBeInTheDocument();
    // The columns say it on desktop; the sub-line restates it on a phone.
    expect(screen.getByText('+16.95 settled · +702.56 open')).toBeInTheDocument();
    expect(screen.getByText('+702.56')).toBeInTheDocument();
  });

  test('a row without the split (an older payload) prints the total alone', async () => {
    mockBoard([trader({ totalEarnings: 42 })]);
    renderPage();
    expect(await screen.findByText('+42 cr')).toBeInTheDocument();
    expect(screen.queryByText(/settled ·/)).toBeNull();
  });

  test('a season row never prints a split: a season score is a difference of marks', async () => {
    vi.mocked(api.getSeasons).mockResolvedValue({ seasons: [{ ...draftSeason, status: 'running' }] } as never);
    vi.mocked(api.getSeasonStandings).mockResolvedValue({
      season: { ...draftSeason, status: 'running' },
      participants: [{ rank: 1, id: 'e1', nickname: 'elonmusk', score: 12, projectedPrizeUsd: 500 }],
    } as never);
    mockBoard([]);
    renderPage();
    expect(await screen.findByText('+12 cr')).toBeInTheDocument();
    expect(screen.queryByText(/settled ·/)).toBeNull();
  });
});

/**
 * The floor picker (docs/ui-conventions.md, "The leaderboard
 * (/leaderboard)"): one select above the boards, "Every floor" by default,
 * scoping the all-time board and the contractors board to the chosen floor.
 * The choice lives in the URL as ?workspace=<slug>, so the back button walks
 * it and the link is shareable; the page holds no filter the URL does not
 * show.
 */
describe('the floor picker', () => {
  const floors = [
    { workspaceId: 'w1', name: 'Acme', slug: 'acme', visibility: 'public' },
    { workspaceId: 'w2', name: 'Beta Co', slug: 'beta', visibility: 'public' },
  ];
  const contractorOf = (name: string) => ({
    id: `c-${name}`,
    name,
    impact: 10,
    jobs: 1,
    pendingJobs: 1,
    pricedJobs: 1,
    earnedUsd: 0,
  });

  beforeEach(() => {
    // Call history only: "was the board ever asked for every floor?" is the
    // question several of these ask, and it cannot be asked across tests.
    for (const fn of [api.getLeaderboard, api.getMarketplaceWorkspace, api.getSeasonStandings])
      vi.mocked(fn).mockClear();
    vi.mocked(api.getPublicWorkspaces).mockResolvedValue(floors as never);
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation((async (idOrSlug: string) => ({
      topContractors: [contractorOf(`poster-${idOrSlug}`)],
    })) as never);
    mockBoard([trader({})]);
  });

  test('it lists every public floor, with "Every floor" first and selected', async () => {
    renderPage();
    await waitFor(() => expect(within(picker()).getAllByRole('option').length).toBe(3));
    expect([...picker().options].map(o => o.textContent)).toEqual(['Every floor', 'Acme', 'Beta Co']);
    expect([...picker().options].map(o => o.value)).toEqual(['', 'acme', 'beta']);
    expect(picker().value).toBe('');
  });

  test('the default is every floor: the board is asked for without a scope', async () => {
    renderPage();
    await screen.findByText('kai');
    expect(vi.mocked(api.getLeaderboard)).toHaveBeenCalledWith(200, undefined);
  });

  test('PICKING A FLOOR WRITES IT TO THE URL AND RESCOPES THE BOARDS', async () => {
    renderPage();
    await waitFor(() => expect(picker().options.length).toBe(3));
    fireEvent.change(picker(), { target: { value: 'acme' } });
    expect(where()).toBe('?workspace=acme');
    await waitFor(() => expect(vi.mocked(api.getLeaderboard)).toHaveBeenCalledWith(200, 'acme'));
    expect(picker().value).toBe('acme');
  });

  test('the query on first load selects that floor and scopes the boards to it', async () => {
    renderPage('/leaderboard?workspace=beta');
    await waitFor(() => expect(vi.mocked(api.getLeaderboard)).toHaveBeenCalledWith(200, 'beta'));
    expect(vi.mocked(api.getLeaderboard)).not.toHaveBeenCalledWith(200, undefined);
    await waitFor(() => expect(picker().value).toBe('beta'));
    // The contractors board reads that one floor, not the union of them all.
    await waitFor(() => expect(screen.getByText('poster-beta')).toBeInTheDocument());
    expect(screen.queryByText('poster-acme')).toBeNull();
    expect(vi.mocked(api.getMarketplaceWorkspace)).toHaveBeenCalledWith('beta');
    expect(vi.mocked(api.getMarketplaceWorkspace)).not.toHaveBeenCalledWith('acme');
  });

  test('every floor unions the contractors, as it always did', async () => {
    renderPage();
    expect(await screen.findByText('poster-acme')).toBeInTheDocument();
    expect(screen.getByText('poster-beta')).toBeInTheDocument();
  });

  test('choosing "Every floor" again clears the query rather than leaving a stale one', async () => {
    renderPage('/leaderboard?workspace=acme');
    await waitFor(() => expect(picker().value).toBe('acme'));
    fireEvent.change(picker(), { target: { value: '' } });
    expect(where()).toBe('');
    await waitFor(() => expect(vi.mocked(api.getLeaderboard)).toHaveBeenCalledWith(200, undefined));
  });

  test('A FLOOR THE QUERY NAMES THAT IS NOT PUBLIC NEVER WIDENS BACK TO EVERY FLOOR', async () => {
    // The API answers a private or unknown scope with an empty list; the page
    // shows that emptiness rather than quietly ranking the whole platform.
    vi.mocked(api.getLeaderboard).mockResolvedValue({ participants: [] } as never);
    renderPage('/leaderboard?workspace=ghost');
    await waitFor(() => expect(vi.mocked(api.getLeaderboard)).toHaveBeenCalledWith(200, 'ghost'));
    expect(vi.mocked(api.getLeaderboard)).not.toHaveBeenCalledWith(200, undefined);
    expect(await screen.findByText('Nobody has traded yet.')).toBeInTheDocument();
    // And the picker still shows what the URL says, so no filter is hidden.
    await waitFor(() => expect(picker().value).toBe('ghost'));
  });

  test('the season board is never scoped: a season is the whole platform', async () => {
    vi.mocked(api.getSeasons).mockResolvedValue({ seasons: [{ ...draftSeason, status: 'running' }] } as never);
    vi.mocked(api.getSeasonStandings).mockResolvedValue({
      season: { ...draftSeason, status: 'running' },
      participants: [{ rank: 1, id: 'e1', nickname: 'elonmusk', score: 12, projectedPrizeUsd: 500 }],
    } as never);
    renderPage('/leaderboard?workspace=acme');
    expect(await screen.findByText('Season 0 standings')).toBeInTheDocument();
    expect(vi.mocked(api.getSeasonStandings)).toHaveBeenCalledWith('s0', 100);
  });

  test('a bot contractor carries the bot mark on this board', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation((async (idOrSlug: string) => ({
      topContractors: [{ ...contractorOf(`poster-${idOrSlug}`), bot: idOrSlug === 'acme' }],
    })) as never);
    const { container } = renderPage();
    await screen.findByText('poster-acme');
    const rowOf = (name: string) =>
      [...container.querySelectorAll('tr')].find(r => r.textContent?.includes(name)) as HTMLElement;
    expect(rowOf('poster-acme').querySelector('.pubws-bot')).toBeTruthy();
    expect(rowOf('poster-beta').querySelector('.pubws-bot')).toBeNull();
  });
});
