import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The floor wires the once-a-second prices (docs/ui-conventions.md, "The
 * floor's live poll"; owner ask 2026-09-12, "make sure the price refreshes
 * at least once per second"). The poll itself is pinned in
 * useFloorPrices.test.tsx and the overlay in price-overlay.test.ts; this
 * pins that the floor asks, that a new body reaches what it prints, and that
 * the board does not reorder when prices flip (a list replaced at a refresh
 * once opened the wrong proposal on a late click,
 * docs/reviews/2026-09-11-snake-design-critic-2.md).
 */

const h = vi.hoisted(() => {
  const pair = (id: string, approved: number, declined: number) => ({
    metricId: 'metric-rev',
    metricName: 'Revenue',
    targetDate: '2028',
    resolvesOn: '2029-01-01T00:00:00Z',
    approvedConsensus: approved,
    declinedConsensus: declined,
    delta: approved - declined,
    approvedMarketId: `${id}-a`,
    declinedMarketId: `${id}-d`,
    approvedProbability: approved / 100,
    approvedLiquidity: 200,
    declinedProbability: declined / 100,
    declinedLiquidity: 200,
    approvedPool: 100,
    declinedPool: 100,
    approvedTraders: 0,
    declinedTraders: 0,
    approvedVolume: 0,
    declinedVolume: 0,
    rangeMin: 0,
    rangeMax: 100,
  });
  const proposal = (id: string, n: number, title: string, approved: number, declined: number) => ({
    id,
    number: n,
    title,
    description: '',
    askUsd: 10,
    proposedByName: 'someone',
    proposedByHandle: 'someone',
    createdAt: `2026-09-1${n}T10:00:00Z`,
    decideBy: null,
    status: 'pending',
    marketPairCount: 1,
    markets: [pair(id, approved, declined)],
  });
  const workspace = () => ({
    workspaceId: 'ws-1',
    name: 'Floor',
    slug: 'floor',
    ownerId: null,
    ownerHandle: null,
    description: null,
    charter: null,
    liveViewUrl: null,
    liveFeed: null,
    visibility: 'public',
    proposalReward: 0,
    spamPenalty: 0,
    joinAs: 'trader' as const,
    signupCredits: 100,
    metricCount: 1,
    openMarketCount: 1,
    participantCount: 3,
    heroMetricId: 'metric-rev',
    heroMetricDescription: 'Revenue.',
    proposalStats: { total: 3, pending: 3, approved: 0, declined: 0 },
    markets: [
      {
        marketId: 'm-rev',
        metricId: 'metric-rev',
        metricName: 'Revenue',
        targetDate: '2028',
        resolvesOn: '2029-01-01T00:00:00Z',
        consensus: 40,
        probability: 0.4,
        liquidity: 200,
        rangeMin: 0,
        rangeMax: 100,
      },
    ],
    marketHistory: [],
    marketHistoryMarketId: 'm-rev',
    horizonHistories: [{ marketId: 'm-rev', periodStart: '2028-01-01', points: [], description: 'Revenue.' }],
    proposals: [
      proposal('p-1', 1, 'Alpha idea', 55, 50),
      proposal('p-2', 2, 'Beta idea', 60, 50),
      proposal('p-3', 3, 'Gamma idea', 52, 50),
    ],
  });
  return { workspace };
});

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../../components/MarketChart', () => ({
  GEOM: { wide: { W: 720, PAD_L: 46, PAD_R: 58, H: 260 }, compact: { W: 400, PAD_L: 40, PAD_R: 50, H: 300 } },
  MarketChart: ({ consensus }: { consensus: number | null }) => <div data-testid="call-chart">{String(consensus)}</div>,
}));
vi.mock('../../lib/api', () => {
  const explicit: Record<string, unknown> = {
    getMarketplaceWorkspace: vi.fn(async () => h.workspace()),
    getPublicMarketHistory: vi.fn(async () => []),
    getLeaderboard: vi.fn(async () => ({ participants: [] })),
    getMarketActivity: vi.fn(async () => ({ consensus: null, positions: [], trades: [] })),
    getFloorComments: vi.fn(async () => []),
    getFloorPrices: vi.fn(async () => ({ changed: false })),
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
const getFloorPrices = vi.mocked(api.getFloorPrices as unknown as (slug: string, etag?: string | null) => unknown);

function renderFloor() {
  return render(
    <MemoryRouter initialEntries={['/floor']}>
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
  Element.prototype.scrollIntoView = vi.fn();
  sessionStorage.clear();
});
afterEach(() => {
  vi.clearAllMocks();
});

const titlesInOrder = () => {
  const board = document.querySelector('.pubws-board') as HTMLElement;
  return within(board)
    .getAllByText(/(Alpha|Beta|Gamma) idea/)
    .map(el => el.textContent);
};

describe('the floor and its prices', () => {
  test('the floor asks for its prices by its own address', async () => {
    renderFloor();
    await waitFor(() => expect(getFloorPrices).toHaveBeenCalled());
    expect(getFloorPrices.mock.calls[0][0]).toBe('floor');
  });

  test('a new prices body reaches the numbers the floor prints', async () => {
    getFloorPrices.mockResolvedValue({
      changed: true,
      etag: '"v2"',
      prices: {
        asOf: '2026-09-12T12:00:00Z',
        version: 'v2',
        books: [{ marketId: 'm-rev', consensus: 77, probability: 0.77, pool: 100, tradeCount: 3 }],
      },
    });
    renderFloor();
    // The ticket at rest shows the market's own call in its value field.
    await waitFor(() =>
      expect((screen.getByLabelText(/Bet the market to this value/) as HTMLInputElement).value).toBe('77.0'),
    );
  });

  test('THE BOARD DOES NOT REORDER WHEN PRICES FLIP', async () => {
    renderFloor();
    await waitFor(() => expect(document.querySelector('.pubws-board')).toBeTruthy());
    const before = titlesInOrder();
    await act(async () => {
      getFloorPrices.mockResolvedValue({
        changed: true,
        etag: '"v3"',
        prices: {
          asOf: '2026-09-12T12:00:01Z',
          version: 'v3',
          books: [
            { marketId: 'p-3-a', consensus: 95, probability: 0.95, pool: 100, tradeCount: 9 },
            { marketId: 'p-2-a', consensus: 10, probability: 0.1, pool: 100, tradeCount: 9 },
          ],
        },
      });
    });
    await waitFor(() => expect(getFloorPrices.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 3000 });
    expect(titlesInOrder()).toEqual(before);
  });

  test('the payload poll keeps its cadence: prices ride their own poll (source pin)', () => {
    const src = readFileSync(join(__dirname, '..', 'TradePage.tsx'), 'utf8');
    expect(src).toMatch(/useFloorPrices\(idOrSlug/);
    expect(src).toMatch(/overlayFloorPrices\(/);
    expect(src).toMatch(/pollIntervalFor\(/);
  });
});
