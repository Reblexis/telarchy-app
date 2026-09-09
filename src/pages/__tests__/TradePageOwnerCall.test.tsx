import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The owner's own call, beside the market's (docs/owner-on-the-floor.md, "The
 * owner's own call").
 *
 * A record, not a control: it moves no price and pays nobody. It exists to
 * put the owner on the same hook as the people they are asking to forecast,
 * so what is pinned here is that it appears beside the market's number rather
 * than instead of it, that a revised call says it was revised, and that a
 * floor without one looks exactly as it did.
 */
const h = vi.hoisted(() => {
  const workspace = (overrides: Record<string, unknown> = {}) => ({
    workspaceId: 'ws-1',
    name: 'Telarchy',
    slug: 'telarchy',
    ownerId: null,
    ownerHandle: null,
    description: null,
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
        metricName: 'Active traders',
        targetDate: '2026-09-30',
        resolvesOn: '2026-10-01',
        consensus: 12.4,
        probability: 0.24,
        liquidity: 200,
        pool: 139,
        traderCount: 9,
        tradedVolume: 4_242,
        rangeMin: 0,
        rangeMax: 50,
      },
    ],
    marketHistory: [],
    marketHistoryMarketId: 'm-hero',
    heroHistory: [{ at: '2026-09-08T00:00:00.000Z', value: 9 }],
    heroMetricId: 'metric-1',
    proposals: [],
    ...overrides,
  });
  return { workspace };
});

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u-1', email: 'owner@example.com' }, loading: false }),
}));

vi.mock('../../components/MarketChart', () => ({
  GEOM: {
    wide: { W: 720, PAD_L: 46, PAD_R: 58, H: 260 },
    compact: { W: 400, PAD_L: 40, PAD_R: 50, H: 300 },
  },
  MarketChart: () => <div data-testid="chart" />,
}));

vi.mock('../../lib/api', () => {
  const explicit: Record<string, unknown> = {
    getMarketplaceWorkspace: vi.fn(async () => h.workspace()),
    joinWorkspace: vi.fn(async () => ({})),
    getProfile: vi.fn(async () => ({ capabilities: ['read', 'trade', 'manage'] })),
    getParticipant: vi.fn(async () => ({ balance: 100, id: 'agent-1' })),
    getPublicMarketHistory: vi.fn(async () => []),
    getLeaderboard: vi.fn(async () => ({ participants: [] })),
    getMarketActivity: vi.fn(async () => ({ consensus: null, positions: [], trades: [] })),
    getPositions: vi.fn(async () => []),
    getLimitOrders: vi.fn(async () => []),
    getFloorComments: vi.fn(async () => []),
    setOwnerCall: vi.fn(async () => ({ ok: true })),
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
    <MemoryRouter initialEntries={['/telarchy']}>
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

const CALL = { metricId: 'metric-1', targetDate: '2026-09-30', value: 15, at: '2026-09-05T00:00:00Z', by: 'viktor' };

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

describe('the owner’s call sits beside the market’s', () => {
  test('a call on the metric and date on screen is a third cell, named for who made it', async () => {
    await withWorkspace({ ownerCalls: [{ ...CALL, revisions: 0 }] });
    renderFloor();
    const cell = await screen.findByLabelText("The owner's call");
    expect(cell.textContent).toContain('15');
    expect(cell.textContent).toContain('viktor');
  });

  test('the market’s call is still there: the owner’s is beside it, never instead of it', async () => {
    await withWorkspace({ ownerCalls: [{ ...CALL, revisions: 0 }] });
    renderFloor();
    await screen.findByLabelText("The owner's call");
    expect(screen.getAllByText(/market's call/).length).toBeGreaterThan(0);
  });

  test('a revised call says so, and how many stand behind it', async () => {
    await withWorkspace({ ownerCalls: [{ ...CALL, revisions: 2 }] });
    renderFloor();
    const cell = await screen.findByLabelText("The owner's call");
    expect(cell.textContent).toMatch(/revised/);
    expect(cell.textContent).toContain('2');
  });

  test('a call for another date is not this date’s call', async () => {
    await withWorkspace({ ownerCalls: [{ ...CALL, targetDate: '2026-10-31', revisions: 0 }] });
    renderFloor();
    await screen.findAllByText(/market's call/);
    expect(screen.queryByLabelText("The owner's call")).toBeNull();
  });

  test('a floor with no call looks exactly as it did', async () => {
    renderFloor();
    await screen.findAllByText(/market's call/);
    expect(screen.queryByLabelText("The owner's call")).toBeNull();
  });
});

describe('making one', () => {
  test('the owner has a field for it, and it posts the metric and date on screen', async () => {
    renderFloor();
    const input = await screen.findByLabelText('Your call for this date');
    fireEvent.change(input, { target: { value: '15' } });
    fireEvent.click(screen.getByText('Publish call'));
    const { api } = await import('../../lib/api');
    expect(api.setOwnerCall).toHaveBeenCalledWith('ws-1', {
      metricId: 'metric-1',
      targetDate: '2026-09-30',
      value: 15,
    });
  });
});
