import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * There is ONE chart, and how the call moved is a mode of it
 * (docs/ui-conventions.md, "The price and the chart", revised 2026-09-09;
 * record notes/decisions/ui-conventions.md).
 *
 * Two charts stacked cost 340px of the first screen and pushed the two bet
 * verbs to 1035px on a 1000px viewport, below the fold, which is the one
 * thing a trading page may not do. And the open dates in the settlement band
 * are the date control: a reader who can see them priced differently and
 * cannot press them is being shown a control that is not one.
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
    joinAs: 'viewer' as const,
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
    proposals: [],
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
const mode = (name: string) => screen.getByRole('button', { name });

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

describe('one chart, and how the call moved is a mode of it', () => {
  test('the floor opens on the value, with no second chart under it', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.nchart')).toBeTruthy());
    expect(container.querySelector('.pubws-callhist')).toBeNull();
    expect(screen.queryByTestId('call-chart')).toBeNull();
    expect(mode('Value').getAttribute('aria-pressed')).toBe('true');
    expect(mode('Call').getAttribute('aria-pressed')).toBe('false');
  });

  test('Call swaps the one chart for the price replay, and back', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.nchart')).toBeTruthy());
    fireEvent.click(mode('Call'));
    await waitFor(() => expect(screen.getByTestId('call-chart')).toBeTruthy());
    // One chart at a time: the number view is gone while the call is on screen.
    expect(container.querySelector('.nchart')).toBeNull();
    expect(mode('Call').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(mode('Value'));
    await waitFor(() => expect(container.querySelector('.nchart')).toBeTruthy());
    expect(screen.queryByTestId('call-chart')).toBeNull();
  });

  test('the mode survives a change of date', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.nchart')).toBeTruthy());
    fireEvent.click(mode('Call'));
    await waitFor(() => expect(screen.getByTestId('call-chart')).toBeTruthy());
    const dates = screen.getByLabelText('Dates');
    fireEvent.click(dates.querySelectorAll('[role="tab"]')[0] as HTMLElement);
    await waitFor(() => {
      expect((dates.querySelectorAll('[role="tab"]')[0] as HTMLElement).getAttribute('aria-selected')).toBe('true');
    });
    expect(screen.getByTestId('call-chart')).toBeTruthy();
  });

  test('the counts sit under the chart in both modes', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-chartfoot')).toBeTruthy());
    fireEvent.click(mode('Call'));
    await waitFor(() => expect(screen.getByTestId('call-chart')).toBeTruthy());
    expect(container.querySelector('.pubws-chartfoot .pubws-money')).toBeTruthy();
  });
});

describe('the open dates in the band are the date control', () => {
  test('pressing another date\u2019s marker selects it, and the strip follows', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.nchart')).toBeTruthy());
    const dates = () => screen.getByLabelText('Dates');
    // The floor opens on the furthest-resolving market: September.
    expect((dates().querySelectorAll('[role="tab"]')[1] as HTMLElement).getAttribute('aria-selected')).toBe('true');
    const week = container.querySelector('.nchart-marker[data-market="rev-week"]') as SVGGElement;
    expect(week.getAttribute('role')).toBe('button');
    fireEvent.click(week);
    await waitFor(() => {
      expect((dates().querySelectorAll('[role="tab"]')[0] as HTMLElement).getAttribute('aria-selected')).toBe('true');
    });
    // Pressing a marker is the same act as pressing its tab: the question moved.
    expect(container.querySelector('.pubws-instrument-ask')?.textContent ?? '').toMatch(/20 Sep/);
  });

  test('the selected date is not pressable, because it is where you are', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.nchart')).toBeTruthy());
    const selected = container.querySelector('.nchart-marker.is-selected') as SVGGElement;
    expect(selected.getAttribute('role')).toBeNull();
  });
});
