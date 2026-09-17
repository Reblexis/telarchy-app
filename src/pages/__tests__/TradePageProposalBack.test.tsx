import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.setConfig({ testTimeout: 20_000 });

/**
 * Opening a proposal from the floor is one place in the history
 * (docs/ui-conventions.md, "A proposal has a number and an address"). Found
 * by the 2026-09-17 chess persona run: "Opening a move trapped me on its
 * page: neither repeated Alt+Left nor the browser Back button returned me to
 * the chess floor."
 */

const h = vi.hoisted(() => {
  const soon = new Date(Date.now() + 60 * 60_000);
  soon.setUTCSeconds(0, 0);
  const TARGET = soon.toISOString().slice(0, 16);
  const RESOLVES = new Date(soon.getTime() + 60_000).toISOString();
  const DECIDE_BY = new Date(Date.now() + 30 * 60_000).toISOString();
  const option = (id: string, label: string, consensus: number) => ({
    id,
    label,
    marketId: `m-${id}`,
    consensus,
    probability: 0.5,
    liquidity: 200,
    pool: 300,
    traders: 1,
    volume: 20,
    delta: null,
  });
  /* Continue forward leads, so "the leader" and "the arrow's option" are
     different worlds and the test can tell them apart. */
  const options = () => [
    option('forward', 'Continue forward', 8.9),
    option('left', 'Turn left', 5.1),
    option('right', 'Turn right', 5.0),
  ];
  const floor = () => ({
    workspaceId: 'ws-snake',
    name: 'Snake',
    slug: 'snake',
    ownerId: null,
    ownerHandle: null,
    description: 'A snake steered by markets',
    charter: null,
    liveFeed: { kind: 'snake', url: 'https://snake.example.com' },
    liveViewUrl: null,
    visibility: 'public',
    proposalReward: 0,
    spamPenalty: 0,
    joinAs: 'trader' as const,
    signupCredits: 100,
    metricCount: 1,
    openMarketCount: 1,
    participantCount: 3,
    decisionMinutes: 1,
    proposalStats: { total: 1, pending: 1, approved: 0, declined: 0 },
    markets: [
      {
        marketId: 'm-len',
        metricId: 'len',
        metricName: 'Reached length',
        metricOrder: 0,
        targetDate: TARGET,
        resolvesOn: RESOLVES,
        consensus: 6,
        probability: 0.5,
        liquidity: 200,
        pool: 3000,
        traderCount: 2,
        tradedVolume: 40,
        rangeMin: 0,
        rangeMax: 144,
      },
    ],
    marketHistory: [],
    marketHistoryMarketId: 'm-len',
    horizonHistories: [{ marketId: 'm-len', periodStart: '2026-09-11', points: [], description: 'The length.' }],
    proposals: [
      {
        id: 'job-uuid-1',
        number: 129,
        title: 'Game 1, attempt 59, move 17',
        description: 'The snake picks a direction.',
        askUsd: 0,
        status: 'pending' as const,
        decideBy: DECIDE_BY,
        closedAt: null,
        lapsedAt: null,
        proposedByName: 'snake-operator',
        createdAt: new Date(Date.now() - 60 * 60_000).toISOString(),
        options: [
          { id: 'forward', label: 'Continue forward' },
          { id: 'left', label: 'Turn left' },
          { id: 'right', label: 'Turn right' },
        ],
        decidedOption: null,
        marketPairCount: 1,
        markets: [
          {
            metricId: 'len',
            metricName: 'Reached length',
            targetDate: TARGET,
            resolvesOn: RESOLVES,
            approvedConsensus: null,
            declinedConsensus: null,
            delta: 1.7,
            approvedMarketId: null,
            declinedMarketId: null,
            approvedProbability: null,
            approvedLiquidity: null,
            declinedProbability: null,
            declinedLiquidity: null,
            approvedPool: null,
            declinedPool: null,
            approvedTraders: null,
            declinedTraders: null,
            approvedVolume: null,
            declinedVolume: null,
            options: options(),
            rangeMin: 0,
            rangeMax: 144,
          },
        ],
      },
    ],
  });
  return { floor };
});

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../../components/MarketChart', () => ({
  GEOM: { wide: { W: 720, PAD_L: 46, PAD_R: 58, H: 260 }, compact: { W: 400, PAD_L: 40, PAD_R: 50, H: 300 } },
  MarketChart: () => <div data-testid="call-chart" />,
}));
/* The LIVE segment stands in for the grid: one button per arrow, calling the
   page back exactly as a chevron does, with the proposal number and its
   option. */
vi.mock('../../components/live/LiveView', () => ({
  LiveView: ({ onPickProposal }: { onPickProposal?: (n: number, option?: string) => void }) => (
    <div data-testid="live-view">
      <button type="button" onClick={() => onPickProposal?.(129, 'left')}>
        arrow-left
      </button>
      <button type="button" onClick={() => onPickProposal?.(129, 'right')}>
        arrow-right
      </button>
    </div>
  ),
}));
vi.mock('../../lib/api', () => {
  const explicit: Record<string, unknown> = {
    getMarketplaceWorkspace: vi.fn(async () => h.floor()),
    getPublicMarketHistory: vi.fn(async () => []),
    getLeaderboard: vi.fn(async () => ({ participants: [] })),
    getMarketActivity: vi.fn(async () => ({ consensus: null, positions: [], trades: [] })),
    getFloorComments: vi.fn(async () => []),
    getProfile: vi.fn(async () => ({ capabilities: ['read', 'trade'] })),
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

const head = (c: HTMLElement) => c.querySelector('.pubws-proposal-head');

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/snake');
});

describe('Back from a proposal returns to the floor', () => {
  test('opening a proposal from the floor pushes exactly one history entry', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(screen.getByTestId('live-view')).toBeTruthy());
    const push = vi.spyOn(window.history, 'pushState');
    fireEvent.click(screen.getByText('arrow-left'));
    await waitFor(() => expect(head(container)).toBeTruthy());
    await waitFor(() => expect(window.location.pathname).toBe('/snake/p/129'));
    expect(push).toHaveBeenCalledTimes(1);
  });

  test('stepping to another option of the open proposal pushes nothing more', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(screen.getByTestId('live-view')).toBeTruthy());
    fireEvent.click(screen.getByText('arrow-left'));
    await waitFor(() => expect(window.location.pathname).toBe('/snake/p/129'));
    const push = vi.spyOn(window.history, 'pushState');
    fireEvent.click(screen.getByText('arrow-right'));
    await waitFor(() => expect(head(container)).toBeTruthy());
    expect(push).not.toHaveBeenCalled();
  });

  test('arriving on the proposal address pushes nothing', async () => {
    window.history.replaceState(null, '', '/snake/p/129');
    const push = vi.spyOn(window.history, 'pushState');
    const { container } = renderFloor('/snake/p/129');
    await waitFor(() => expect(head(container)).toBeTruthy());
    expect(push).not.toHaveBeenCalled();
  });

  test('Back closes the proposal and shows the floor', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(screen.getByTestId('live-view')).toBeTruthy());
    fireEvent.click(screen.getByText('arrow-left'));
    await waitFor(() => expect(window.location.pathname).toBe('/snake/p/129'));
    /* What the browser does on Back: the address is the floor's again and
       popstate fires. */
    window.history.replaceState(null, '', '/snake');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await waitFor(() => expect(head(container)).toBeNull());
    expect(window.location.pathname).toBe('/snake');
  });

  test('Forward opens it again', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(screen.getByTestId('live-view')).toBeTruthy());
    window.history.replaceState(null, '', '/snake/p/129');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await waitFor(() => expect(head(container)).toBeTruthy());
  });
});
