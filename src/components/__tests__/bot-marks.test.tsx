import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';
import type { LeaderboardEntry, PublicContractor } from '../../lib/api';

/**
 * A bot says it is one (docs/ui-conventions.md, "A bot says it is one").
 * Every public surface that prints a participant's name prints the mark
 * `bot` after it when the API says the participant is a bot, and never
 * otherwise; a bot the platform runs names its model on its profile; the
 * standings footer counts the bots trading on the floor and points at
 * /agents.
 */

const getFloorComments = vi.fn();
const getMarketActivity = vi.fn();
const getPublicProfile = vi.fn();

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api');
  return {
    ...actual,
    api: {
      getSeasons: async () => ({ seasons: [] }),
      getSeasonStandings: async () => ({ participants: [] }),
      getLeaderboard: async () => ({ participants: [] }),
      getMySeason: async () => ({ season: null, optedIn: false, canEnter: false }),
      getParticipant: async () => ({ payoutHandle: null }),
      getFloorComments: () => getFloorComments(),
      getMarketActivity: (a: string, b: string) => getMarketActivity(a, b),
      getPublicProfile: (id: string) => getPublicProfile(id),
      sendProposalMessage: vi.fn(),
      sendMarketMessage: vi.fn(),
    },
  };
});
vi.mock('../PageTopBar', () => ({ PageTopBar: () => null }));

const { FloorStandings } = await import('../FloorRails');
const { FloorComments } = await import('../FloorComments');
const { AllTimeTable } = await import('../LeaderTables');
const { JobsBoard } = await import('../JobsBoard');
const { ParticipantProfilePage } = await import('../../pages/ParticipantProfilePage');

function trader(n: number, bot?: boolean): LeaderboardEntry {
  return {
    id: `p${n}`,
    nickname: `trader${n}`,
    rank: n,
    totalEarnings: 1000 - n,
    totalTrades: 10,
    resolvedMarkets: 0,
    accuracy: null,
    calibration: null,
    lastTradeAt: null,
    ...(bot === undefined ? {} : { bot }),
  } as unknown as LeaderboardEntry;
}
function contractor(n: number, bot?: boolean): PublicContractor {
  return {
    id: `c${n}`,
    name: `contractor${n}`,
    impact: 10,
    jobs: 1,
    pendingJobs: 1,
    pricedJobs: 1,
    earnedUsd: 0,
    ...(bot === undefined ? {} : { bot }),
  } as PublicContractor;
}

const rowOf = (text: string) => screen.getByText(text).closest('li, tr') as HTMLElement;
const marked = (el: HTMLElement | null) => !!el?.querySelector('.pubws-bot');

describe('the standings footers', () => {
  test('A BOT ON THE BOARD CARRIES THE MARK; a person does not', () => {
    render(
      <MemoryRouter>
        <FloorStandings entries={[trader(1, true), trader(2, false), trader(3)]} contractors={[]} />
      </MemoryRouter>,
    );
    expect(marked(rowOf('trader1'))).toBe(true);
    expect(marked(rowOf('trader2'))).toBe(false);
    // An older payload without the field reads as a person, never a guess.
    expect(marked(rowOf('trader3'))).toBe(false);
    expect(rowOf('trader1').querySelector('.pubws-bot')?.textContent).toBe('bot');
  });

  test('a bot contractor carries the mark', () => {
    render(
      <MemoryRouter>
        <FloorStandings entries={[]} contractors={[contractor(1, true), contractor(2, false)]} />
      </MemoryRouter>,
    );
    expect(marked(rowOf('contractor1'))).toBe(true);
    expect(marked(rowOf('contractor2'))).toBe(false);
  });

  test('a bot among the traders on this proposal carries the mark', () => {
    render(
      <MemoryRouter>
        <FloorStandings
          entries={[]}
          proposalTraders={[
            { ...trader(4, true), positionLine: 'bet higher if approved' },
            { ...trader(5, false), positionLine: 'bet lower if declined' },
          ]}
        />
      </MemoryRouter>,
    );
    expect(marked(rowOf('trader4'))).toBe(true);
    expect(marked(rowOf('trader5'))).toBe(false);
  });

  test('THE FOOTER NAMES THE BOTS TRADING HERE and links to building one', () => {
    render(
      <MemoryRouter>
        <FloorStandings entries={[trader(1)]} contractors={[]} botTraders={3} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/3 bots trade here\./)).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Build your own' });
    expect(link.getAttribute('href')).toBe('/agents');
  });

  test('one bot is singular', () => {
    render(
      <MemoryRouter>
        <FloorStandings entries={[trader(1)]} contractors={[]} botTraders={1} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/1 bot trades here\./)).toBeTruthy();
  });

  test.each([0, undefined])('no bots (%s), no line', n => {
    render(
      <MemoryRouter>
        <FloorStandings entries={[trader(1)]} contractors={[]} botTraders={n} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/trades? here/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Build your own' })).toBeNull();
  });
});

describe('the full leaderboard', () => {
  test('a bot row carries the mark', () => {
    render(
      <MemoryRouter>
        <table>
          <AllTimeTable rows={[trader(1, true), trader(2, false)]} />
        </table>
      </MemoryRouter>,
    );
    expect(marked(rowOf('trader1'))).toBe(true);
    expect(marked(rowOf('trader2'))).toBe(false);
  });
});

describe("the market's Discussion, Positions and Activity", () => {
  function panel() {
    getFloorComments.mockResolvedValue([
      { id: 'c-bot', fromName: 'robo', fromBot: true, content: 'estimate 42', createdAt: new Date().toISOString() },
      { id: 'c-hana', fromName: 'hana', fromBot: false, content: 'higher', createdAt: new Date().toISOString() },
    ]);
    getMarketActivity.mockResolvedValue({
      consensus: 40,
      positions: [
        { handle: 'robo', id: 'robo', bot: true, direction: 'lower', shares: 10, cost: 2, worth: 3 },
        { handle: 'hana', id: 'hana', bot: false, direction: 'higher', shares: 5, cost: 2, worth: 2 },
      ],
      trades: [
        {
          id: 't-bot',
          handle: 'robo',
          bot: true,
          direction: 'lower',
          kind: 'buy',
          shares: 10,
          cost: 2,
          createdAt: new Date().toISOString(),
        },
        {
          id: 't-hana',
          handle: 'hana',
          bot: false,
          direction: 'higher',
          kind: 'buy',
          shares: 5,
          cost: 2,
          createdAt: new Date().toISOString(),
        },
      ],
      pool: [
        {
          id: 'l-bot',
          handle: 'robo',
          bot: true,
          kind: 'deepened',
          amount: 5,
          pool: 15,
          createdAt: new Date().toISOString(),
        },
        {
          id: 'l-house',
          handle: null,
          bot: false,
          kind: 'opened',
          amount: 10,
          pool: 10,
          createdAt: new Date().toISOString(),
        },
      ],
    });
    return render(
      <MemoryRouter>
        <FloorComments idOrSlug="telarchy" subject={{ marketId: 'm1' }} canPost={false} onRequireSignup={() => {}} />
      </MemoryRouter>,
    );
  }

  test("a bot's comment carries the mark beside its author", async () => {
    const { container } = panel();
    fireEvent.click(await screen.findByRole('button', { name: /Discussion/ }));
    await waitFor(() => expect(container.querySelector('[data-comment-id="c-bot"]')).toBeTruthy());
    expect(marked(container.querySelector('[data-comment-id="c-bot"]'))).toBe(true);
    expect(marked(container.querySelector('[data-comment-id="c-hana"]'))).toBe(false);
  });

  test('a bot holding a position carries the mark', async () => {
    const { container } = panel();
    fireEvent.click(await screen.findByRole('button', { name: /Positions/ }));
    await waitFor(() => expect(container.querySelectorAll('.pubws-mkt-row').length).toBe(2));
    const rows = [...container.querySelectorAll('.pubws-mkt-row')] as HTMLElement[];
    expect(marked(rows.find(r => r.textContent?.includes('robo'))!)).toBe(true);
    expect(marked(rows.find(r => r.textContent?.includes('hana'))!)).toBe(false);
  });

  test("a bot's trade and a bot's pool deposit carry the mark; the house's opening does not", async () => {
    const { container } = panel();
    fireEvent.click(await screen.findByRole('button', { name: /Activity/ }));
    await waitFor(() => expect(container.querySelector('[data-trade-id="t-bot"]')).toBeTruthy());
    expect(marked(container.querySelector('[data-trade-id="t-bot"]'))).toBe(true);
    expect(marked(container.querySelector('[data-trade-id="t-hana"]'))).toBe(false);
    const rows = [...container.querySelectorAll('.pubws-mkt-row')] as HTMLElement[];
    expect(marked(rows.find(r => r.textContent?.includes('deepened the pool'))!)).toBe(true);
    expect(marked(rows.find(r => r.textContent?.includes('the house'))!)).toBe(false);
  });
});

describe('proposed by', () => {
  const proposal = (over: Record<string, unknown>) =>
    ({
      id: 'c1',
      number: 7,
      title: 'Trade every market',
      description: '',
      askUsd: 0,
      proposedByName: 'robo',
      proposedByHandle: 'robo',
      createdAt: '2026-09-01T10:00:00Z',
      decideBy: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString(),
      status: 'pending',
      marketPairCount: 0,
      markets: [],
      ...over,
    }) as never;
  const props = {
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

  test('a proposal a bot posted carries the mark beside the proposer', () => {
    const { container } = render(
      <MemoryRouter>
        <JobsBoard {...props} proposals={[proposal({ proposedByBot: true })]} />
      </MemoryRouter>,
    );
    const who = screen.getByText('robo').closest('span[title]') as HTMLElement;
    expect(marked(who)).toBe(true);
    expect(container.querySelectorAll('.pubws-bot').length).toBe(1);
  });

  test("a person's proposal carries no mark", () => {
    const { container } = render(
      <MemoryRouter>
        <JobsBoard
          {...props}
          proposals={[proposal({ proposedByName: 'hana', proposedByHandle: 'hana', proposedByBot: false })]}
        />
      </MemoryRouter>,
    );
    expect(container.querySelector('.pubws-bot')).toBeNull();
  });
});

describe('the profile', () => {
  const profile = (over: Record<string, unknown>) => ({
    id: 'reference-astra',
    nickname: 'reference-astra',
    image: null,
    manifoldUsername: null,
    intent: null,
    bio: null,
    joinedAt: '2026-09-11T09:00:00Z',
    parent: null,
    children: [],
    balance: 2000,
    stats: {
      rank: null,
      calibration: null,
      accuracy: null,
      totalEarnings: 0,
      settledEarnings: 0,
      openEarnings: 0,
      resolvedMarkets: 0,
      totalTrades: 0,
      tradedVolume: 0,
      lastTradeAt: null,
    },
    activeWorkspaces: [],
    openPositions: [],
    recentTrades: [],
    proposedJobs: [],
    balanceHistory: [],
    profitHistory: [],
    pnlHistory: [],
    bot: false,
    runBy: null,
    model: null,
    ...over,
  });
  async function open(p: Record<string, unknown>) {
    getPublicProfile.mockResolvedValue(profile(p));
    const r = render(
      <MemoryRouter initialEntries={['/participants/reference-astra']}>
        <Routes>
          <Route path="/participants/:id" element={<ParticipantProfilePage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(r.container.querySelector('.prof-head')).toBeTruthy());
    return r.container.querySelector('.prof-head') as HTMLElement;
  }

  test('A BOT THE PLATFORM RUNS SAYS WHO RUNS IT AND ON WHAT', async () => {
    const head = await open({ bot: true, runBy: 'telarchy', model: 'gpt-6-astra/xhigh' });
    expect(marked(head)).toBe(true);
    expect(head.textContent).toContain('Run by Telarchy on gpt-6-astra/xhigh');
  });

  test('a platform bot with no forecast yet is run by Telarchy, no model', async () => {
    const head = await open({ bot: true, runBy: 'telarchy', model: null });
    expect(head.textContent).toContain('Run by Telarchy');
    expect(head.textContent).not.toContain('Run by Telarchy on');
  });

  test('a bot somebody else runs has the mark and no run line', async () => {
    const head = await open({ bot: true, runBy: null, model: null });
    expect(marked(head)).toBe(true);
    expect(head.textContent).not.toContain('Run by');
  });

  test('a person has neither', async () => {
    const head = await open({ bot: false });
    expect(marked(head)).toBe(false);
    expect(head.textContent).not.toContain('Run by');
  });
});

describe('traders on this proposal, as the floor builds them', () => {
  test('A BOT HOLDING EITHER BRANCH STAYS A BOT in the list', async () => {
    const { holdersOf } = await import('../../pages/TradePage');
    const rows = holdersOf(
      [
        { id: 'robo', handle: 'robo', bot: true, direction: 'higher', cost: 1, worth: 2, branch: 'approved' },
        { id: 'robo', handle: 'robo', bot: true, direction: 'lower', cost: 1, worth: 1, branch: 'declined' },
        { id: 'hana', handle: 'hana', bot: false, direction: 'lower', cost: 1, worth: 1, branch: 'declined' },
      ],
      [],
    );
    expect(rows.find(r => r.id === 'robo')?.bot).toBe(true);
    expect(rows.find(r => r.id === 'hana')?.bot).toBe(false);
  });
});
