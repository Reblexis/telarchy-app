import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The bet ticket previews the trade the server will actually execute.
 *
 * The regression this pins (owner report 2026-08-30, "when i bet lower and
 * i have already bought higher the estimate doesn't match the actual new
 * value"): the sell rows were taken out of the bet ticket by handing it
 * `positions={[]}`, but that prop is also what the preview reads. Hiding
 * the rows is manageMode's job; the data belongs to the preview in both
 * modes.
 *
 * Since the redemption change later the same day (docs/ui-conventions.md,
 * "A trader holds ONE net side"), the held position no longer changes
 * where the bet LANDS: the buy runs against the live book and the matched
 * pairs are cashed at par afterwards, which moves no price. What the
 * position changes is the credits handed back, so this pins the landing
 * against the plain-buy arithmetic and leaves the money to the server
 * tests and amm-parity.
 *
 * Signed in and joined, which the sibling TradePage.test.tsx deliberately
 * is not: netting only exists for someone who holds a position.
 */

const h = vi.hoisted(() => ({
  // b = 200 across 0..500,000 at p = 0.5, so the arithmetic below is
  // checkable by hand.
  workspace: () => ({
    workspaceId: 'ws-1',
    name: 'LookPilot',
    slug: 'lookpilot',
    ownerId: null,
    ownerHandle: null,
    description: null,
    charter: null,
    visibility: 'public',
    proposalReward: 0,
    spamPenalty: 0,
    joinAs: 'trader' as const,
    maxPositionCostPerMarket: 0,
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
        consensus: 250_000,
        probability: 0.5,
        liquidity: 200,
        rangeMin: 0,
        rangeMax: 500_000,
      },
    ],
    marketHistory: [],
    marketHistoryMarketId: 'm-hero',
    horizonHistories: [],
    proposals: [],
  }),
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u-1', email: 'trader@example.com' }, loading: false }),
}));

vi.mock('../../components/MarketChart', () => ({
  // NumberChart (not mocked) imports the shared geometry from this module.
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
    getProfile: vi.fn(async () => ({ capabilities: ['read', 'trade'] })),
    getParticipant: vi.fn(async () => ({ balance: 500, id: 'agent-1' })),
    // The whole point: the trader is long 50 higher shares.
    getPositions: vi.fn(async () => [{ direction: 'higher', shares: 50, totalCost: 20 }]),
    getLimitOrders: vi.fn(async () => []),
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
    <MemoryRouter initialEntries={['/lookpilot']}>
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
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('the bet ticket nets against the held position', () => {
  test('New value shows the post-netting landing, and the sell rows stay out', async () => {
    const { container } = renderFloor();

    fireEvent.click(await screen.findByRole('button', { name: /Bet Lower/ }));
    await waitFor(() => expect(container.querySelector('.pubws-ticket-inline')).toBeTruthy());
    // Wait for the silent join to deliver the position, or the preview has
    // nothing to net against and this test would pass for the wrong reason.
    await waitFor(() => expect(container.querySelector('.ticket-slider')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Credits to spend'), { target: { value: '10' } });

    const shown = (container.querySelector('.ticket-newvalue') as HTMLInputElement).value;
    const landed = parseFloat(shown.replace(/,/g, ''));
    // By hand, b = 200 over 0..500,000 at p = 0.5: 10 credits of lower buys
    // 19.53 shares from [0,0] and lands ~237,800. The 50 held higher shares
    // pair off against it and are cashed at par, which takes the same
    // amount off both sides of the book and so moves the price by nothing.
    expect(landed).toBeGreaterThan(230_000);
    expect(landed).toBeLessThan(245_000);

    // Selling belongs to the position panel below the ticket (owner ask
    // 2026-08-28), so the rows stay out of the bet ticket even though its
    // preview now knows the position is there.
    expect(container.querySelector('.pubws-ticket-inline .ticket-pos')).toBeNull();
  });
});
