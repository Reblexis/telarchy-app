import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The rail is the ticket, and the proposals move under the trade
 * (docs/ui-conventions.md, "The rails, and the standings under the verbs",
 * revised 2026-09-09; record notes/decisions/ui-conventions.md).
 *
 * What a trader does is on screen from the moment the page opens instead of
 * waiting below the fold for a press, and the proposals get the full width
 * under the trade, which is what gives a row room for its own buttons. The
 * order under the trade is the same at every width, which is the phone rule
 * as well: the DOM order IS the stacking order.
 */

const h = vi.hoisted(() => {
  const market = (
    id: string,
    metricId: string,
    metricName: string,
    targetDate: string,
    resolvesOn: string,
    metricOrder: number,
    consensus: number | null,
  ) => ({
    marketId: id,
    metricId,
    metricName,
    metricOrder,
    targetDate,
    resolvesOn,
    consensus,
    probability: 0.5,
    liquidity: 200,
    pool: 3000,
    traderCount: 2,
    tradedVolume: 40,
    rangeMin: 0,
    rangeMax: 50_000,
  });
  /** Two metrics, each on this week and on 30 Sep: a 2x2 grid. */
  const grid = () => ({
    workspaceId: 'ws-1',
    name: 'LookPilot',
    slug: 'lookpilot',
    ownerId: null,
    ownerHandle: null,
    description: 'Webcam head tracker for sims',
    charter: null,
    visibility: 'public',
    proposalReward: 0,
    spamPenalty: 0,
    joinAs: 'trader' as const,
    signupCredits: 100,
    metricCount: 2,
    openMarketCount: 4,
    participantCount: 3,
    proposalStats: { total: 0, pending: 0, approved: 0, declined: 0 },
    markets: [
      market('rev-week', 'rev', 'LookPilot net revenue (USD)', '2026-W38', '2026-09-21T00:00:00Z', 0, 6_850),
      market('rev-sep', 'rev', 'LookPilot net revenue (USD)', '2026-10', '2026-11-01T00:00:00Z', 0, 7_100),
      market('rev-week-2', 'reviews', 'Steam reviews (count)', '2026-W38', '2026-09-21T00:00:00Z', 1, 41),
      market('rev-sep-2', 'reviews', 'Steam reviews (count)', '2026-10', '2026-11-01T00:00:00Z', 1, 55),
    ],
    marketHistory: [],
    marketHistoryMarketId: 'rev-sep',
    horizonHistories: [
      { marketId: 'rev-week', periodStart: '2026-08-31', points: [], description: 'Revenue.' },
      { marketId: 'rev-sep', periodStart: '2026-09-01', points: [], description: 'Revenue.' },
      { marketId: 'rev-week-2', periodStart: '2026-08-31', points: [], description: 'Reviews.' },
      { marketId: 'rev-sep-2', periodStart: '2026-09-01', points: [], description: 'Reviews.' },
    ],
    proposals: [
      {
        id: 'job-1',
        number: 7,
        title: '$80: rewrite the store page',
        description: 'A better store page.',
        askUsd: 80,
        status: 'pending' as const,
        decideBy: '2026-09-20T00:00:00Z',
        closedAt: null,
        lapsedAt: null,
        proposedByName: 'Ada',
        createdAt: '2026-08-12T09:00:00.000Z',
        marketPairCount: 1,
        markets: [
          {
            metricId: 'rev',
            metricName: 'LookPilot net revenue (USD)',
            targetDate: '2026-10',
            resolvesOn: '2026-11-01T00:00:00Z',
            approvedConsensus: 7_400,
            declinedConsensus: 7_100,
            delta: 300,
            approvedMarketId: 'm-approved',
            declinedMarketId: 'm-declined',
            approvedProbability: 0.5,
            approvedLiquidity: 200,
            declinedProbability: 0.5,
            declinedLiquidity: 200,
            approvedPool: 3_000,
            declinedPool: 3_000,
            approvedTraders: 1,
            declinedTraders: 0,
            approvedVolume: 50,
            declinedVolume: 0,
            rangeMin: 0,
            rangeMax: 50_000,
          },
        ],
      },
    ],
  });
  const single = () => {
    const ws = grid();
    ws.markets = [ws.markets[1]];
    ws.horizonHistories = [ws.horizonHistories[1]];
    ws.metricCount = 1;
    ws.openMarketCount = 1;
    return ws;
  };
  return { grid, single };
});

// A visitor: the anonymous poster is where the ticket has to be visible
// from the first screen, because signing up IS the intent signal.
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));

vi.mock('../../components/MarketChart', () => ({
  GEOM: {
    wide: { W: 720, PAD_L: 46, PAD_R: 58, H: 260 },
    compact: { W: 400, PAD_L: 40, PAD_R: 50, H: 300 },
  },
  MarketChart: ({ corner }: { corner?: unknown }) => <div data-testid="call-chart">{corner as never}</div>,
}));

vi.mock('../../lib/api', () => {
  const explicit: Record<string, unknown> = {
    getMarketplaceWorkspace: vi.fn(async () => h.grid()),
    getPublicMarketHistory: vi.fn(async () => []),
    getLeaderboard: vi.fn(async () => ({ participants: [] })),
    getMarketActivity: vi.fn(async () => ({ consensus: null, positions: [], trades: [] })),
    getFloorComments: vi.fn(async () => []),
    getProfile: vi.fn(async () => ({ capabilities: ['read', 'trade'] })),
    getParticipant: vi.fn(async () => ({ balance: 500, id: 'agent-1' })),
    getPositions: vi.fn(async () => []),
    getLimitOrders: vi.fn(async () => []),
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

function renderFloor() {
  return render(
    <MemoryRouter initialEntries={['/lookpilot']}>
      <Routes>
        <Route path="/:slug" element={<TradePage />} />
      </Routes>
    </MemoryRouter>,
  );
}
const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
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
  vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => h.grid() as never);
  sessionStorage.clear();
});
afterEach(() => vi.clearAllMocks());

describe('the rail is the ticket', () => {
  test('the right rail holds the trade ticket and nothing else', async () => {
    const { container } = renderFloor();
    // Past the loading ghosts, which draw their own rail.
    await waitFor(() => expect(container.querySelector('.pubws-stats')).toBeTruthy());
    const rail = container.querySelector('.pubws-rail--right') as HTMLElement;
    expect(rail.getAttribute('aria-label')).toBe('Your trade');
    await waitFor(() => expect(rail.querySelector('.ticket')).toBeTruthy());
    // The proposals it used to hold are not in it any more.
    expect(rail.querySelector('.pubws-ballot')).toBeNull();
    expect(container.querySelectorAll('.ticket')).toHaveLength(1);
  });

  test('the ticket names the market it is pointed at', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-stats')).toBeTruthy());
    const rail = container.querySelector('.pubws-rail--right') as HTMLElement;
    expect(rail.textContent).toMatch(/net revenue/i);
  });

  test('a bet verb seeds the side without moving the ticket', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-bet')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Bet Higher/ }));
    const rail = container.querySelector('.pubws-rail--right') as HTMLElement;
    expect(rail.getAttribute('aria-label')).toBe('Your trade');
    await waitFor(() => expect(rail.querySelector('.ticket.is-open')).toBeTruthy());
    expect(container.querySelectorAll('.ticket')).toHaveLength(1);
  });
});

describe('the order under the trade is the same at every width', () => {
  test('verbs, ticket, proposals, propose, settles', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-ballot')).toBeTruthy());
    const bet = container.querySelector('.pubws-bet') as HTMLElement;
    const ticket = container.querySelector('.pubws-rail--right') as HTMLElement;
    const board = container.querySelector('.pubws-ballot') as HTMLElement;
    const propose = container.querySelector('.pubws-propose') as HTMLElement;
    const settles = container.querySelector('.pubws-settles') as HTMLElement;
    for (const [name, el] of Object.entries({ bet, ticket, board, propose, settles })) {
      expect(el, name).toBeTruthy();
    }
    expect(follows(bet, ticket)).toBe(true);
    expect(follows(ticket, board)).toBe(true);
    expect(follows(board, propose)).toBe(true);
    expect(follows(propose, settles)).toBe(true);
    // The standings are signed-in only; where they sit is pinned in
    // TradePageBoardFloor.test.tsx.
  });

  test('the proposals are under the trade, in the page column, not in a rail', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-ballot')).toBeTruthy());
    const board = container.querySelector('.pubws-ballot') as HTMLElement;
    expect(board.closest('.pubws-rail')).toBeNull();
    expect(board.closest('.pubws-tail')).toBeTruthy();
  });

  test('each grid item is a child of the floor, so the DOM order is the phone order', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-ballot')).toBeTruthy());
    const main = container.querySelector('.pubws-main--floor');
    const items = [...(main?.children ?? [])].map(el => el.className.split(' ')[1] ?? el.className);
    expect(items).toEqual(['pubws-center', 'pubws-rail--right', 'pubws-tail', 'pubws-rail--left', 'pubws-know-col']);
  });
});
