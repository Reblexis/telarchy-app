import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Between games a fed floor is still that floor (docs/ui-conventions.md,
 * "The chess feed": "While no book is open..."). Found by the 2026-09-17
 * persona run: right after a chess game settled the floor showed "No number
 * here yet / Add your first metric" with no board and no replay.
 */

const h = vi.hoisted(() => {
  const state = {
    liveFeed: null as { kind: string; url: string } | null,
    noMarket: false,
    owner: false,
    liveViewUrl: null as string | null,
  };
  const workspace = () => ({
    workspaceId: 'ws-1',
    name: 'Snake',
    slug: 'snake',
    ownerId: state.owner ? 'owner-1' : null,
    canManage: state.owner,
    ownerHandle: null,
    description: null,
    charter: null,
    liveViewUrl: state.liveViewUrl,
    liveFeed: state.liveFeed,
    visibility: 'public',
    proposalReward: 0,
    spamPenalty: 0,
    joinAs: 'trader' as const,
    signupCredits: 100,
    metricCount: 1,
    openMarketCount: 1,
    participantCount: 3,
    heroMetricId: 'metric-score',
    heroMetricDescription: 'The score definition.',
    proposalStats: { total: 0, pending: 0, approved: 0, declined: 0 },
    markets: state.noMarket
      ? []
      : [
          {
            marketId: 'm-score',
            metricId: 'metric-score',
            metricName: 'Score',
            targetDate: '2026-12',
            resolvesOn: '2027-01-01T00:00:00Z',
            consensus: 120,
            probability: 0.5,
            liquidity: 200,
            rangeMin: 0,
            rangeMax: 1000,
          },
        ],
    marketHistory: [],
    marketHistoryMarketId: 'm-score',
    horizonHistories: [
      { marketId: 'm-score', periodStart: '2026-01-01', points: [], description: 'The score definition.' },
    ],
    proposals: [],
  });
  return { state, workspace };
});

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: h.state.owner ? { id: 'owner-1' } : null, loading: false }),
}));

vi.mock('../../components/MarketChart', () => ({
  GEOM: {
    wide: { W: 720, PAD_L: 46, PAD_R: 58, H: 260 },
    compact: { W: 400, PAD_L: 40, PAD_R: 50, H: 300 },
  },
  MarketChart: ({ corner }: { corner?: unknown }) => <div data-testid="call-chart">{corner as never}</div>,
}));

vi.mock('../../components/live/LiveView', () => ({
  LiveView: ({ kind, slug, corner }: { kind: string; slug: string; corner?: unknown }) => (
    <div data-testid="live-view" data-kind={kind} data-slug={slug}>
      {corner as never}
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

function renderFloor() {
  return render(
    <MemoryRouter initialEntries={['/snake']}>
      <Routes>
        <Route path="/:slug" element={<TradePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

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
  sessionStorage.clear();
});
afterEach(() => {
  h.state.liveFeed = null;
  h.state.noMarket = false;
  h.state.owner = false;
});

const FEED = { kind: 'chess', url: 'https://chess.example.com' };
const loaded = async (container: HTMLElement) =>
  waitFor(() => {
    if (!container.querySelector('[aria-label="What is Snake"]')) throw new Error('floor not loaded');
  });

describe('the chess floor has no board after a game settles', () => {
  test('a fed floor with no open book draws the live view, not the empty state', async () => {
    h.state.liveFeed = FEED;
    h.state.noMarket = true;
    const { container, findByTestId } = renderFloor();
    const live = await findByTestId('live-view');
    expect(live.getAttribute('data-kind')).toBe('chess');
    expect(container.textContent).not.toMatch(/Nothing is priced here yet/);
    expect(container.querySelector('[aria-label="No market yet"]')).toBeNull();
  });

  test('its owner is not told to add a first metric either', async () => {
    h.state.liveFeed = FEED;
    h.state.noMarket = true;
    h.state.owner = true;
    const { container, findByTestId } = renderFloor();
    await findByTestId('live-view');
    expect(container.textContent).not.toMatch(/Add your first metric/);
    expect(container.textContent).not.toMatch(/No number here yet/);
  });

  test('a floor with no feed and no book keeps the honest empty state', async () => {
    h.state.noMarket = true;
    const { container, queryByTestId } = renderFloor();
    await loaded(container);
    expect(queryByTestId('live-view')).toBeNull();
    expect(container.querySelector('[aria-label="No market yet"]')).not.toBeNull();
  });
});

describe('on the chess floor the ticket is the only bet surface where it is beside the chart', () => {
  const verbs = (c: HTMLElement) => c.querySelector('[role="group"][aria-label="Bet"]') as HTMLElement | null;

  test('THE CHESS FLOOR MARKS ITS BET VERBS AS RAIL-HIDDEN', async () => {
    h.state.liveFeed = FEED;
    const { container } = renderFloor();
    await waitFor(() => expect(verbs(container)).not.toBeNull());
    expect(verbs(container)).toHaveClass('pubws-bet--rail');
  });

  test('a snake floor and a floor with no feed keep their verbs at every width', async () => {
    h.state.liveFeed = { kind: 'snake', url: 'https://snake.example.com' };
    const snake = renderFloor();
    await waitFor(() => expect(verbs(snake.container)).not.toBeNull());
    expect(verbs(snake.container)).not.toHaveClass('pubws-bet--rail');
    snake.unmount();
    h.state.liveFeed = null;
    const plain = renderFloor();
    await waitFor(() => expect(verbs(plain.container)).not.toBeNull());
    expect(verbs(plain.container)).not.toHaveClass('pubws-bet--rail');
  });

  test('the marked verbs are hidden only from 1120px up, where the rail holds the ticket', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/style.css', 'utf8');
    const blocks = [...css.matchAll(/@media \(min-width: 1120px\) \{([\s\S]*?)\n\}/g)].map(m => m[1]);
    expect(blocks.filter(b => /\.pubws-bet--rail \{ display: none; \}/.test(b))).toHaveLength(1);
    expect(css.match(/\.pubws-bet--rail/g)).toHaveLength(1);
  });
});
