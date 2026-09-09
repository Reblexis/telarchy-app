import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Both axes of the grid are strips, and every tab carries its call
 * (docs/ui-conventions.md, "The question line: the pickers, and the
 * sentence", revised 2026-09-09; record notes/decisions/ui-conventions.md).
 *
 * A dropdown hides how many books a floor prices and what they say. The rule
 * this file protects: the top of the floor is the scoreboard of everything
 * the floor prices, readable without pressing anything.
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
      market('rev-week', 'rev', 'LookPilot net revenue (USD)', '2026-W36', '2026-09-07T00:00:00Z', 0, 6_850),
      market('rev-sep', 'rev', 'LookPilot net revenue (USD)', '2026-09', '2026-10-01T00:00:00Z', 0, 7_100),
      market('rev-week-2', 'reviews', 'Steam reviews (count)', '2026-W36', '2026-09-07T00:00:00Z', 1, 41),
      market('rev-sep-2', 'reviews', 'Steam reviews (count)', '2026-09', '2026-10-01T00:00:00Z', 1, 55),
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
  MarketChart: () => <div data-testid="chart" />,
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
const tabs = (strip: HTMLElement) => [...strip.querySelectorAll('[role="tab"]')] as HTMLElement[];
const words = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

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
});
afterEach(() => vi.clearAllMocks());

describe('both axes of the grid are strips, and every tab carries its call', () => {
  test('the metrics are a strip, each tab its name over its call for the date on screen', async () => {
    renderFloor();
    const strip = await screen.findByLabelText('Metrics');
    const names = tabs(strip).map(t => words(t));
    // Stepper order, primary first; the workspace name is stripped from the label.
    expect(names[0]).toMatch(/^net revenue/i);
    expect(names[1]).toMatch(/^steam reviews/i);
    // The call for the SELECTED date (30 Sep), so the strip compares like with like.
    expect(names[0]).toContain('$7,100');
    expect(names[1]).toContain('55');
  });

  test('the dates are a strip under it, soonest first, each tab its clock over its call', async () => {
    renderFloor();
    const metrics = await screen.findByLabelText('Metrics');
    const dates = await screen.findByLabelText('Dates');
    expect(metrics.compareDocumentPosition(dates) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const names = tabs(dates).map(t => words(t));
    // Soonest first: the week market before the September one.
    expect(names[0]).toMatch(/^week to 6 Sep/i);
    expect(names[0]).toContain('$6,850');
    expect(names[1]).toContain('$7,100');
    // The settle day is said once, in the stat row's caption, not on the tab.
    expect(names.join(' ')).not.toMatch(/settles/i);
  });

  test('the selected tab is the one marked, on both strips', async () => {
    renderFloor();
    const metrics = await screen.findByLabelText('Metrics');
    const dates = await screen.findByLabelText('Dates');
    expect(tabs(metrics).map(t => t.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    expect(tabs(dates).map(t => t.getAttribute('aria-selected'))).toEqual(['false', 'true']);
  });

  test('picking a metric keeps the date, and picking a date keeps the metric', async () => {
    const { container } = renderFloor();
    const question = () => words(container.querySelector('.pubws-instrument-ask') as HTMLElement);
    const metrics = await screen.findByLabelText('Metrics');
    fireEvent.click(tabs(metrics)[1]);
    await waitFor(() => {
      const dates = screen.getByLabelText('Dates');
      expect(tabs(dates)[1].getAttribute('aria-selected')).toBe('true');
    });
    expect(question()).toMatch(/steam reviews/i);
    fireEvent.click(tabs(screen.getByLabelText('Dates'))[0]);
    await waitFor(() => {
      expect(tabs(screen.getByLabelText('Metrics'))[1].getAttribute('aria-selected')).toBe('true');
    });
    // The metric survived the date pick, and the question moved to the week.
    expect(question()).toMatch(/steam reviews/i);
    expect(question()).toMatch(/6 Sep/i);
  });

  test('a tab with no price prints a dash, never a borrowed number', async () => {
    const ws = h.grid();
    ws.markets[3].consensus = null;
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    renderFloor();
    const strip = await screen.findByLabelText('Metrics');
    const reviews = tabs(strip)[1];
    expect(within(reviews).getByText('-')).toBeTruthy();
    expect(words(reviews)).not.toContain('41');
  });

  test('a strip of one is a label: one metric and one date draw no strips', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(h.single() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-stats')).toBeTruthy());
    expect(screen.queryByLabelText('Metrics')).toBeNull();
    expect(screen.queryByLabelText('Dates')).toBeNull();
  });

  test('the chips they replaced are gone', async () => {
    const { container } = renderFloor();
    await screen.findByLabelText('Metrics');
    expect(container.querySelector('.pubws-chip--metric')).toBeNull();
    expect(container.querySelector('.pubws-chip--date')).toBeNull();
  });

  test('a visitor is offered no owner entry', async () => {
    renderFloor();
    await screen.findByLabelText('Metrics');
    expect(screen.queryByText('Manage metrics')).toBeNull();
    expect(screen.queryByText('Manage dates')).toBeNull();
  });
});
