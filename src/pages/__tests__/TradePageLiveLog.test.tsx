import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The live log on the floor (docs/ui-conventions.md, "The live log"): in the
 * plain market view the left column carries the Live block and the verbs are
 * followed by the folded strip, both from one read of the workspace's log;
 * a live feed's step reads it again at once; a selected proposal shows
 * neither.
 */

const h = vi.hoisted(() => {
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
    decisionMinutes: 1,
    heroMetricId: 'metric-len',
    heroMetricDescription: 'The length.',
    proposalStats: { total: 1, pending: 1, approved: 0, declined: 0 },
    markets: [
      {
        marketId: 'm-len',
        metricId: 'metric-len',
        metricName: 'Reached length',
        targetDate: '2099-12',
        resolvesOn: '2100-01-01T00:00:00Z',
        consensus: 3,
        probability: 0.5,
        liquidity: 200,
        rangeMin: 0,
        rangeMax: 36,
      },
    ],
    marketHistory: [],
    marketHistoryMarketId: 'm-len',
    horizonHistories: [{ marketId: 'm-len', periodStart: '2099-12-01', points: [], description: 'The length.' }],
    proposals: [
      {
        id: 'p-95',
        number: 95,
        title: 'Game 2, attempt 223, move 95',
        description: '',
        askUsd: null,
        proposedByName: 'snake',
        proposedByHandle: 'snake',
        createdAt: '2099-01-01T00:00:00Z',
        decideBy: '2099-01-01T00:01:00Z',
        status: 'pending',
        marketPairCount: 0,
        markets: [],
      },
    ],
  });
  const actions = () => ({
    generatedAt: '2026-09-12T20:22:00Z',
    kinds: [],
    workspaces: [{ slug: 'snake', name: 'Snake', hidden: true }],
    rows: [
      {
        id: 'trade:t95',
        at: '2026-09-12T20:21:06Z',
        kind: 'trade',
        workspace: { slug: 'snake', name: 'Snake' },
        actor: { id: 'v', handle: 'vi0' },
        text: 'bought 306.34 higher shares for 151.18 cr',
        detail: { side: 'buy', direction: 'higher', cost: 151.18, callBefore: 16.71, callAfter: 18.82 },
        href: '/snake#market=m&trade=t95',
      },
    ],
    next: null,
  });
  return { workspace, actions };
});

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../../components/MarketChart', () => ({
  GEOM: { wide: { W: 720, PAD_L: 46, PAD_R: 58, H: 260 }, compact: { W: 400, PAD_L: 40, PAD_R: 50, H: 300 } },
  MarketChart: () => <div data-testid="call-chart" />,
}));
vi.mock('../../components/live/LiveView', () => ({
  LiveView: ({ onStep }: { onStep?: (s: { step: number; decided: boolean }) => void }) => (
    <div data-testid="live-view">
      <button type="button" onClick={() => onStep?.({ step: 96, decided: false })}>
        feed-next-step
      </button>
    </div>
  ),
}));
vi.mock('../../lib/api', () => {
  const explicit: Record<string, unknown> = {
    getMarketplaceWorkspace: vi.fn(async () => h.workspace()),
    getActions: vi.fn(async () => h.actions()),
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
  return { api, setActiveWorkspace: vi.fn(), actionsQueryString: () => '' };
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
});
afterEach(() => {
  vi.clearAllMocks();
});

const actionCalls = () => vi.mocked(api.getActions as never as () => unknown).mock.calls;

describe('the live log on the floor', () => {
  test('the plain market view reads the workspace log once and draws the Live block in the left column and the strip under the verbs', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-rail--left .pubws-live')).toBeTruthy());
    expect(container.querySelector('.pubws-live-strip')).toBeTruthy();
    expect(actionCalls()[0][0]).toEqual({ workspace: 'snake', limit: '30' });
    // One read feeds both.
    expect(actionCalls()).toHaveLength(1);
    // A fast workspace (decisionMinutes 1): the trade stands alone since no proposal row is in the window.
    expect(container.querySelector('.pubws-rail--left .pubws-live')?.textContent).toContain('vi0');
  });

  test('a live feed step reads the log again at once', async () => {
    renderFloor();
    await waitFor(() => expect(screen.getByTestId('live-view')).toBeTruthy());
    await waitFor(() => expect(actionCalls().length).toBeGreaterThanOrEqual(1));
    const before = actionCalls().length;
    fireEvent.click(screen.getByText('feed-next-step'));
    await waitFor(() => expect(actionCalls().length).toBe(before + 1));
  });

  test('a selected proposal shows neither the block nor the strip', async () => {
    const { container } = renderFloor('/snake/p/95');
    await waitFor(() => expect(document.querySelector('.pubws-proposal-title')?.textContent).toContain('#95'));
    expect(container.querySelector('.pubws-live')).toBeNull();
    expect(container.querySelector('.pubws-live-strip')).toBeNull();
  });
});
