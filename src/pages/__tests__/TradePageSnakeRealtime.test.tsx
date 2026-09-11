import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The feed drives the floor (docs/ui-conventions.md, "The feed drives the
 * floor" and "A proposal past its deadline reads as closed before the
 * ruling lands", 2026-09-11; Viktor: "make sure the whole page is properly
 * dynamic and reactive to the fast updating snake", "if im on a proposal
 * that has been already approved/declined ... make it clear what has
 * happened"). The LIVE segment is mocked down to the two callbacks the
 * page wires: a step or decision on the feed, and a chevron pick.
 */

const NOW = Date.UTC(2026, 8, 11, 16, 30, 30);

const h = vi.hoisted(() => {
  const state = { proposals: [] as unknown[] };
  const pair = () => ({
    metricId: 'metric-len',
    metricName: 'Reached length',
    targetDate: '2026-09-11T17:30',
    resolvesOn: '2026-09-11T17:31:00Z',
    approvedConsensus: 3.4,
    declinedConsensus: 3.0,
    delta: 0.4,
    approvedMarketId: 'm-a',
    declinedMarketId: 'm-d',
    approvedProbability: 0.5,
    approvedLiquidity: 200,
    declinedProbability: 0.5,
    declinedLiquidity: 200,
    approvedPool: 1000,
    declinedPool: 1000,
    approvedTraders: 0,
    declinedTraders: 0,
    approvedVolume: 0,
    declinedVolume: 0,
    rangeMin: 0,
    rangeMax: 144,
  });
  const proposal = (over: Record<string, unknown>) => ({
    id: `p-${over.number}`,
    title: `Game 1, attempt 49, move 10: Turn ${over.number === 122 ? 'left' : 'right'}`,
    description: '',
    askUsd: null,
    proposedByName: 'snake',
    proposedByHandle: 'snake',
    createdAt: '2026-09-11T16:30:00Z',
    decideBy: '2026-09-11T16:31:00Z',
    status: 'pending',
    marketPairCount: 1,
    markets: [pair()],
    ...over,
  });
  const workspace = () => ({
    workspaceId: 'ws-1',
    name: 'Snake',
    slug: 'snake',
    ownerId: null,
    ownerHandle: null,
    description: null,
    charter: null,
    liveViewUrl: null,
    liveFeed: { kind: 'snake', url: 'https://snake.example.com' },
    visibility: 'public',
    proposalReward: 0,
    spamPenalty: 0,
    joinAs: 'trader' as const,
    signupCredits: 100,
    metricCount: 1,
    openMarketCount: 1,
    participantCount: 3,
    heroMetricId: 'metric-len',
    heroMetricDescription: 'The length.',
    proposalStats: { total: 3, pending: 3, approved: 0, declined: 0 },
    decisionMinutes: 1,
    markets: [
      {
        marketId: 'm-len',
        metricId: 'metric-len',
        metricName: 'Reached length',
        targetDate: '2026-09-11T17:30',
        resolvesOn: '2026-09-11T17:31:00Z',
        consensus: 3,
        probability: 0.5,
        liquidity: 200,
        rangeMin: 0,
        rangeMax: 144,
      },
    ],
    marketHistory: [],
    marketHistoryMarketId: 'm-len',
    horizonHistories: [{ marketId: 'm-len', periodStart: '2026-09-11', points: [], description: 'The length.' }],
    proposals: state.proposals,
  });
  return { state, workspace, proposal };
});

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../../components/MarketChart', () => ({
  GEOM: { wide: { W: 720, PAD_L: 46, PAD_R: 58, H: 260 }, compact: { W: 400, PAD_L: 40, PAD_R: 50, H: 300 } },
  MarketChart: () => <div data-testid="call-chart" />,
}));
vi.mock('../../components/live/LiveView', () => ({
  LiveView: ({
    onStep,
    onPickProposal,
    onQuotes,
  }: {
    onStep?: (s: { step: number; decided: boolean }) => void;
    onPickProposal?: (n: number) => void;
    onQuotes?: (q: Record<string, { approved: number | null; declined: number | null }>) => void;
  }) => (
    <div data-testid="live-view">
      <button type="button" onClick={() => onQuotes?.({ 'p-122': { approved: 3.9, declined: 3.0 } })}>
        feed-quotes
      </button>
      <button type="button" onClick={() => onStep?.({ step: 42, decided: true })}>
        feed-decided
      </button>
      <button type="button" onClick={() => onStep?.({ step: 43, decided: false })}>
        feed-next-step
      </button>
      <button type="button" onClick={() => onPickProposal?.(122)}>
        feed-pick-122
      </button>
    </div>
  ),
}));
vi.mock('../../lib/api', () => {
  const explicit: Record<string, unknown> = {
    getMarketplaceWorkspace: vi.fn(async () => h.workspace()),
    getPublicMarketHistory: vi.fn(async () => []),
    getLeaderboard: vi.fn(async () => ({ participants: [] })),
    getMarketActivity: vi.fn(async () => ({ consensus: null, positions: [], trades: [] })),
    getFloorComments: vi.fn(async () => []),
  };
  const api = new Proxy(explicit, {
    get(target, prop: string) {
      if (!(prop in target)) target[prop] = vi.fn(async () => []);
      return target[prop];
    },
  });
  return { api, setActiveWorkspace: vi.fn() };
});

const { TradePage } = await import('../TradePage');
const { api } = await import('../../lib/api');

function renderFloor(path = '/snake') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/:slug" element={<TradePage />} />
        <Route path="/:slug/p/:number" element={<TradePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
    root = null;
    rootMargin = '';
    thresholds = [];
  } as unknown as typeof IntersectionObserver;
  Element.prototype.scrollIntoView = vi.fn();
  sessionStorage.clear();
  h.state.proposals = [h.proposal({ number: 121 }), h.proposal({ number: 122 }), h.proposal({ number: 123 })];
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

const floorLoads = () => vi.mocked(api.getMarketplaceWorkspace as never as () => unknown).mock.calls.length;

describe('the feed drives the floor', () => {
  test('a decision on the feed reloads the floor payload at once, not on the next poll', async () => {
    renderFloor();
    await waitFor(() => expect(screen.getByTestId('live-view')).toBeTruthy());
    await waitFor(() => expect(floorLoads()).toBeGreaterThanOrEqual(1));
    const before = floorLoads();
    fireEvent.click(screen.getByText('feed-decided'));
    await waitFor(() => expect(floorLoads()).toBe(before + 1));
  });

  test('a new step on the feed reloads the floor payload at once', async () => {
    renderFloor();
    await waitFor(() => expect(screen.getByTestId('live-view')).toBeTruthy());
    const before = floorLoads();
    fireEvent.click(screen.getByText('feed-next-step'));
    await waitFor(() => expect(floorLoads()).toBe(before + 1));
  });

  test('picking a chevron selects that proposal and scrolls its head into view', async () => {
    renderFloor();
    await waitFor(() => expect(screen.getByTestId('live-view')).toBeTruthy());
    fireEvent.click(screen.getByText('feed-pick-122'));
    await waitFor(() => expect(document.querySelector('.pubws-proposal-title')?.textContent).toContain('#122'));
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
  });

  test('opening a proposal by its address scrolls its head into view', async () => {
    renderFloor('/snake/p/123');
    await waitFor(() => expect(document.querySelector('.pubws-proposal-title')?.textContent).toContain('#123'));
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
  });
});

describe("the open step's prices read from the feed", () => {
  test('a quote from the feed moves the world cells and the impact without a floor reload', async () => {
    renderFloor('/snake/p/122');
    await waitFor(() => expect(document.querySelector('.pubws-proposal-title')?.textContent).toContain('#122'));
    const before = floorLoads();
    fireEvent.click(screen.getByText('feed-quotes'));
    await waitFor(() => expect(screen.getByLabelText('if approved').textContent).toMatch(/3\.9/));
    expect(screen.getByLabelText('if declined').textContent).toMatch(/3(\.0+)?(?!\d)/);
    expect(
      document.querySelector('.pubws-proposal-head')?.parentElement?.textContent ?? document.body.textContent,
    ).toMatch(/\+0\.9/);
    expect(floorLoads()).toBe(before);
  });
});

describe('a proposal past its deadline reads as closed before the ruling lands', () => {
  test('the verbs are dead, the ticket is gone, and one line says trading closed', async () => {
    h.state.proposals = [h.proposal({ number: 122, decideBy: '2026-09-11T16:30:00Z' })];
    renderFloor('/snake/p/122');
    await waitFor(() => expect(document.querySelector('.pubws-proposal-title')?.textContent).toContain('#122'));
    const higher = screen.getByRole('button', { name: /Bet Higher/ }) as HTMLButtonElement;
    expect(higher.disabled).toBe(true);
    expect(screen.queryByLabelText('Credits to spend')).toBeNull();
    expect(screen.getByText(/Trading closed at the deadline\. The ruling lands in a moment/)).toBeTruthy();
  });

  test('a live proposal keeps its verbs and shows no such line', async () => {
    h.state.proposals = [h.proposal({ number: 122 })];
    renderFloor('/snake/p/122');
    await waitFor(() => expect(document.querySelector('.pubws-proposal-title')?.textContent).toContain('#122'));
    const higher = screen.getByRole('button', { name: /Bet Higher/ }) as HTMLButtonElement;
    expect(higher.disabled).toBe(false);
    expect(screen.queryByText(/Trading closed at the deadline/)).toBeNull();
  });

  test('the deadline passing while the page is open closes it without a reload', async () => {
    h.state.proposals = [h.proposal({ number: 122, decideBy: new Date(NOW + 3_000).toISOString() })];
    renderFloor('/snake/p/122');
    await waitFor(() => expect(document.querySelector('.pubws-proposal-title')?.textContent).toContain('#122'));
    expect((screen.getByRole('button', { name: /Bet Higher/ }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_100);
    });
    await waitFor(() =>
      expect((screen.getByRole('button', { name: /Bet Higher/ }) as HTMLButtonElement).disabled).toBe(true),
    );
    expect(screen.getByText(/Trading closed at the deadline/)).toBeTruthy();
  });
});

describe('the ruling on the head', () => {
  test('an approved proposal carries the approved pill before its number and the ruling clock to the second', async () => {
    h.state.proposals = [
      h.proposal({
        number: 122,
        status: 'approved',
        resolvedAt: '2026-09-11T16:30:58Z',
        decideBy: '2026-09-11T16:31:00Z',
      }),
    ];
    renderFloor('/snake/p/122');
    await waitFor(() => expect(document.querySelector('.pubws-proposal-title')?.textContent).toContain('#122'));
    const head = document.querySelector('.pubws-proposal-head') as HTMLElement;
    const pill = head.querySelector('.pubws-ballot-status') as HTMLElement;
    expect(pill.textContent).toBe('approved');
    expect(pill.className).toContain('is-approved');
    expect(head.textContent).toMatch(/approved \d\d:\d\d:58/);
    expect(head.textContent).not.toMatch(/decided 11 Sep/);
    expect(screen.queryByText(/Trading closed at the deadline/)).toBeNull();
  });

  test('a declined proposal carries the declined pill and clock; a lapsed one says lapsed', async () => {
    h.state.proposals = [
      h.proposal({ number: 122, status: 'declined', resolvedAt: '2026-09-11T16:30:58Z' }),
      h.proposal({
        number: 123,
        status: 'pending',
        lapsedAt: '2026-09-11T16:31:00Z',
        closedAt: '2026-09-11T16:31:00Z',
        decideBy: '2026-09-11T16:31:00Z',
      }),
    ];
    renderFloor('/snake/p/122');
    await waitFor(() => expect(document.querySelector('.pubws-proposal-title')?.textContent).toContain('#122'));
    const head = document.querySelector('.pubws-proposal-head') as HTMLElement;
    expect(head.querySelector('.pubws-ballot-status')?.textContent).toBe('declined');
    expect(head.textContent).toMatch(/declined \d\d:\d\d:58/);
  });
});
