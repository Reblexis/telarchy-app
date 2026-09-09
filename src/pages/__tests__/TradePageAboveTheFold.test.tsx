import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * What stands between a reader and the trade (docs/ui-conventions.md,
 * "The price and the chart", "The rails, and the standings under the verbs";
 * record notes/decisions/ui-conventions.md, 2026-09-09).
 *
 * Three rules, each named after itself:
 *  - nothing about settlement stands between the question and the number:
 *    the rule the market settles on is ONE block under the trade;
 *  - the counts live in the chart's footer, two of them labelled, and
 *    nowhere else;
 *  - the market's call carries its own move since yesterday.
 */

const DAY = 24 * 60 * 60 * 1000;
const DEFINITION = 'Every credit LookPilot earned on Steam in the trailing 30 days, net of the cut.';

const h = vi.hoisted(() => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const DEF = 'Every credit LookPilot earned on Steam in the trailing 30 days, net of the cut.';
  const workspace = (overrides: Record<string, unknown> = {}) => ({
    workspaceId: 'ws-1',
    name: 'LookPilot',
    slug: 'lookpilot',
    ownerId: null,
    ownerHandle: null,
    description: 'Wallpapers that move.',
    charter: null,
    visibility: 'public',
    proposalReward: 0,
    spamPenalty: 0,
    joinAs: 'trader' as const,
    signupCredits: 100,
    metricCount: 1,
    openMarketCount: 1,
    participantCount: 3,
    proposalStats: { total: 0, pending: 0, approved: 0, declined: 0 },
    markets: [
      {
        marketId: 'm-hero',
        metricId: 'metric-1',
        metricName: 'LookPilot revenue (monthly, USD)',
        targetDate: '2026-12',
        resolvesOn: '2026-12-31',
        consensus: 12,
        probability: 0.24,
        liquidity: 200,
        pool: 42_000,
        traderCount: 23,
        tradedVolume: 30_000,
        rangeMin: 0,
        rangeMax: 50,
      },
    ],
    horizonHistories: [
      {
        marketId: 'm-hero',
        metricName: 'LookPilot revenue (monthly, USD)',
        targetDate: '2026-12',
        periodStart: '2026-01-01T00:00:00.000Z',
        periodEnd: '2026-12-31T00:00:00.000Z',
        resetsEvery: null,
        resolvesNaUntilMeasured: false,
        measured: true,
        description: DEF,
        points: [],
      },
    ],
    marketHistory: [
      { at: new Date(Date.now() - 3 * DAY_MS).toISOString(), consensus: 10 },
      { at: new Date(Date.now() - 60 * 1000).toISOString(), consensus: 12 },
    ],
    marketHistoryMarketId: 'm-hero',
    proposals: [],
    ...overrides,
  });
  return { workspace, DEF };
});

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

vi.mock('../../components/MarketChart', () => ({
  GEOM: {
    wide: { W: 720, PAD_L: 46, PAD_R: 58, H: 260 },
    compact: { W: 400, PAD_L: 40, PAD_R: 50, H: 300 },
  },
  MarketChart: () => <div data-testid="market-chart" />,
}));

vi.mock('../../lib/api', () => {
  const explicit: Record<string, unknown> = {
    getMarketplaceWorkspace: vi.fn(async () => h.workspace()),
    getProfile: vi.fn(async () => ({ capabilities: ['read'] })),
    getPublicMarketHistory: vi.fn(async () => []),
    getLeaderboard: vi.fn(async () => ({ participants: [] })),
    getMarketActivity: vi.fn(async () => ({ consensus: null, positions: [], trades: [] })),
    getPositions: vi.fn(async () => []),
    getLimitOrders: vi.fn(async () => []),
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
    <MemoryRouter initialEntries={['/lookpilot']}>
      <Routes>
        <Route path="/:slug" element={<TradePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function withWorkspace(overrides: Record<string, unknown>) {
  const { api } = await import('../../lib/api');
  vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(h.workspace(overrides) as never);
}

/** Where an element sits in reading order, so "under the trade" is testable. */
function order(a: Element, b: Element): number {
  const pos = a.compareDocumentPosition(b);
  return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
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
});
afterEach(async () => {
  vi.clearAllMocks();
  const { api } = await import('../../lib/api');
  vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => h.workspace() as never);
});

describe('nothing about settlement stands between the question and the number', () => {
  test('the definition is one block under the trade, headed "How this settles"', async () => {
    const { container } = renderFloor();
    const block = await screen.findByLabelText('How this settles');
    expect(block.textContent).toContain(DEFINITION);
    const verbs = container.querySelector('.pubws-bet');
    expect(verbs).toBeTruthy();
    expect(order(verbs as Element, block)).toBe(-1);
  });

  test('the summary line under the question is gone', async () => {
    const { container } = renderFloor();
    await screen.findByLabelText('How this settles');
    expect(container.querySelector('.pubws-instrument-sum')).toBeNull();
  });

  test('the definition prints exactly once, at every width', async () => {
    const { container } = renderFloor();
    await screen.findByLabelText('How this settles');
    const hits = Array.from(container.querySelectorAll('p, div')).filter(
      el => el.children.length === 0 && (el.textContent ?? '').includes(DEFINITION),
    );
    expect(hits).toHaveLength(1);
  });
});

describe('the counts live in the chart footer and nowhere else', () => {
  test('the pool and the volume take one word each, the traders keep their icon', async () => {
    const { container } = renderFloor();
    await screen.findByLabelText('How this settles');
    const foot = container.querySelector('.pubws-chartfoot');
    expect(foot).toBeTruthy();
    const text = (foot as Element).textContent ?? '';
    expect(text).toContain('42k pool');
    expect(text).toContain('30k volume');
    expect(text).toContain('23');
    // The trader count is a number beside a person, not a labelled one.
    expect(text).not.toContain('23 traders');
  });

  test('the tab row no longer carries the counts', async () => {
    const { container } = renderFloor();
    await screen.findByLabelText('How this settles');
    const tabsFacts = container.querySelector('.pubws-panel-tabs .pubws-facts');
    expect(tabsFacts?.textContent ?? '').not.toMatch(/42k|30k/);
  });

  test('the pool is on the page once', async () => {
    const { container } = renderFloor();
    await screen.findByLabelText('How this settles');
    const hits = Array.from(container.querySelectorAll('span, div')).filter(
      el => el.children.length === 0 && (el.textContent ?? '').trim() === '42k pool',
    );
    expect(hits).toHaveLength(1);
  });
});

describe("the market's call carries its own move", () => {
  test('a call 2 above its value a day ago prints a green +2', async () => {
    const { container } = renderFloor();
    const chip = await screen.findByTitle('since yesterday');
    expect(chip.textContent).toMatch(/▲ \+\$2/);
    expect(chip.className).toContain('is-up');
    expect(container.querySelector('.pubws-stat--call')?.contains(chip)).toBe(true);
  });

  test('a call below its value a day ago prints a red delta', async () => {
    await withWorkspace({
      marketHistory: [
        { at: new Date(Date.now() - 3 * DAY).toISOString(), consensus: 15 },
        { at: new Date(Date.now() - 60 * 1000).toISOString(), consensus: 12 },
      ],
    });
    renderFloor();
    const chip = await screen.findByTitle('since yesterday');
    expect(chip.textContent).toMatch(/3/);
    expect(chip.className).toContain('is-down');
  });

  test('no point older than a day means no chip, never a grey zero', async () => {
    await withWorkspace({
      marketHistory: [{ at: new Date(Date.now() - 60 * 1000).toISOString(), consensus: 12 }],
    });
    const { container } = renderFloor();
    await screen.findByLabelText('How this settles');
    await waitFor(() => expect(container.querySelector('.pubws-stats')).toBeTruthy());
    expect(screen.queryByTitle('since yesterday')).toBeNull();
  });

  test('a call that has not moved prints no chip', async () => {
    await withWorkspace({
      marketHistory: [
        { at: new Date(Date.now() - 3 * DAY).toISOString(), consensus: 12 },
        { at: new Date(Date.now() - 60 * 1000).toISOString(), consensus: 12 },
      ],
    });
    const { container } = renderFloor();
    await screen.findByLabelText('How this settles');
    await waitFor(() => expect(container.querySelector('.pubws-stats')).toBeTruthy());
    expect(screen.queryByTitle('since yesterday')).toBeNull();
  });
});
