import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * A PICKER WITH ONE OPTION IS NOT RENDERED (docs/ui-conventions.md, "The
 * question line: the pickers, and the sentence", 2026-09-11; Viktor: "if
 * there is only one metric or one date dont put the selector of that type
 * there"). For the owner too: the manager's entry moves to the owner row
 * under the strips, so the rule hides a picker, never an owner action.
 */

const h = vi.hoisted(() => {
  const market = (id: string, metricId: string, metricName: string, order: number, targetDate: string) => ({
    marketId: id,
    metricId,
    metricName,
    metricOrder: order,
    targetDate,
    resolvesOn: targetDate === '2026-09' ? '2026-10-01T00:00:00Z' : '2026-09-07T00:00:00Z',
    consensus: 12,
    probability: 0.5,
    liquidity: 200,
    pool: 3000,
    traderCount: 2,
    tradedVolume: 40,
    rangeMin: 0,
    rangeMax: 1000,
  });
  const base = () => ({
    workspaceId: 'ws-1',
    name: 'Telarchy',
    slug: 'telarchy',
    ownerId: 'u-1',
    ownerHandle: 'viktor',
    description: null,
    charter: null,
    visibility: 'public',
    proposalReward: 0,
    spamPenalty: 0,
    joinAs: 'trader' as const,
    signupCredits: 100,
    participantCount: 3,
    proposalStats: { total: 0, pending: 0, approved: 0, declined: 0 },
    marketHistory: [],
    proposals: [],
  });
  /** One metric on one date: neither axis has a choice. */
  const oneByOne = () => ({
    ...base(),
    metricCount: 1,
    openMarketCount: 1,
    markets: [market('a-sep', 'a', 'Active traders', 0, '2026-09')],
    marketHistoryMarketId: 'a-sep',
    horizonHistories: [{ marketId: 'a-sep', periodStart: '2026-09-01', points: [], description: 'A.' }],
  });
  /** Two metrics, each on one date: a metric choice, no date choice. */
  const twoByOne = () => ({
    ...base(),
    metricCount: 2,
    openMarketCount: 2,
    markets: [market('a-sep', 'a', 'Active traders', 0, '2026-09'), market('r-sep', 'r', 'Revenue', 1, '2026-09')],
    marketHistoryMarketId: 'a-sep',
    horizonHistories: [
      { marketId: 'a-sep', periodStart: '2026-09-01', points: [], description: 'A.' },
      { marketId: 'r-sep', periodStart: '2026-09-01', points: [], description: 'R.' },
    ],
  });
  /** One metric on two dates: a date choice, no metric choice. */
  const oneByTwo = () => ({
    ...base(),
    metricCount: 1,
    openMarketCount: 2,
    markets: [
      market('a-week', 'a', 'Active traders', 0, '2026-W36'),
      market('a-sep', 'a', 'Active traders', 0, '2026-09'),
    ],
    marketHistoryMarketId: 'a-sep',
    horizonHistories: [
      { marketId: 'a-week', periodStart: '2026-08-31', points: [], description: 'A.' },
      { marketId: 'a-sep', periodStart: '2026-09-01', points: [], description: 'A.' },
    ],
  });
  /** Two by two: both pickers have a choice. */
  const twoByTwo = () => ({
    ...base(),
    metricCount: 2,
    openMarketCount: 4,
    markets: [
      market('a-week', 'a', 'Active traders', 0, '2026-W36'),
      market('a-sep', 'a', 'Active traders', 0, '2026-09'),
      market('r-week', 'r', 'Revenue', 1, '2026-W36'),
      market('r-sep', 'r', 'Revenue', 1, '2026-09'),
    ],
    marketHistoryMarketId: 'a-sep',
    horizonHistories: [
      { marketId: 'a-week', periodStart: '2026-08-31', points: [], description: 'A.' },
      { marketId: 'a-sep', periodStart: '2026-09-01', points: [], description: 'A.' },
      { marketId: 'r-week', periodStart: '2026-08-31', points: [], description: 'R.' },
      { marketId: 'r-sep', periodStart: '2026-09-01', points: [], description: 'R.' },
    ],
  });
  const auth = { user: { id: 'u-1', email: 'owner@example.com' } as { id: string; email: string } | null };
  return { oneByOne, twoByOne, oneByTwo, twoByTwo, auth };
});

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: h.auth.user, loading: false }) }));

vi.mock('../../components/MarketChart', () => ({
  GEOM: {
    wide: { W: 720, PAD_L: 46, PAD_R: 58, H: 260 },
    compact: { W: 400, PAD_L: 40, PAD_R: 50, H: 300 },
  },
  MarketChart: () => <div data-testid="chart" />,
}));

vi.mock('../../lib/api', () => {
  const explicit: Record<string, unknown> = {
    getMarketplaceWorkspace: vi.fn(async () => h.oneByOne()),
    getProfile: vi.fn(async () => ({ capabilities: ['read', 'trade', 'manage'] })),
    getParticipant: vi.fn(async () => ({ balance: 100, id: 'agent-1' })),
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
    <MemoryRouter initialEntries={['/telarchy']}>
      <Routes>
        <Route path="/:slug" element={<TradePage />} />
      </Routes>
    </MemoryRouter>,
  );
}
const stripOf = (label: string) => screen.queryByRole('tablist', { name: label });
const ownerRow = (container: HTMLElement) => container.querySelector('.pubws-strip-owner') as HTMLElement | null;
const ownerWords = (container: HTMLElement) =>
  [...(ownerRow(container)?.querySelectorAll('button') ?? [])].map(b => (b.textContent ?? '').trim());

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
  h.auth.user = { id: 'u-1', email: 'owner@example.com' };
  vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => h.oneByOne() as never);
});
afterEach(() => vi.clearAllMocks());

describe('A PICKER WITH ONE OPTION IS NOT RENDERED', () => {
  test('one metric, one date: neither strip, for the owner either', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-stats')).toBeTruthy());
    // The owner is recognised before the assertion: the owner row is theirs.
    await waitFor(() => expect(ownerRow(container)).toBeTruthy());
    expect(stripOf('Metrics')).toBeNull();
    expect(stripOf('Dates')).toBeNull();
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0);
  });

  test("the owner's entries stay reachable in the owner row, and open their dialogs", async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(ownerRow(container)).toBeTruthy());
    expect(ownerWords(container)).toEqual(['Manage metrics', 'Manage dates']);
    fireEvent.click(screen.getByText('Manage metrics'));
    await waitFor(() => expect(screen.getByRole('dialog', { name: /metrics/i })).toBeTruthy());
  });

  test('two metrics, one date: the metric strip renders, the date strip does not, the row carries only dates', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => h.twoByOne() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(stripOf('Metrics')).toBeTruthy());
    await waitFor(() => expect(ownerRow(container)).toBeTruthy());
    expect(stripOf('Dates')).toBeNull();
    // The metric strip keeps its own entry as its last tab, as before.
    const metricTabs = [...(stripOf('Metrics')?.querySelectorAll('button') ?? [])].map(b => b.textContent?.trim());
    expect(metricTabs).toEqual(['Active traders', 'Revenue', 'Manage metrics']);
    expect(ownerWords(container)).toEqual(['Manage dates']);
  });

  test('one metric, two dates: the date strip renders, the metric strip does not, the row carries only metrics', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => h.oneByTwo() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(stripOf('Dates')).toBeTruthy());
    await waitFor(() => expect(ownerRow(container)).toBeTruthy());
    expect(stripOf('Metrics')).toBeNull();
    expect(ownerWords(container)).toEqual(['Manage metrics']);
  });

  test('two options on both axes: both strips render and there is no owner row', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => h.twoByTwo() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(stripOf('Metrics')).toBeTruthy());
    expect(stripOf('Dates')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Manage dates')).toBeTruthy());
    expect(ownerRow(container)).toBeNull();
  });

  test('a visitor sees no owner row and no strips on a one-by-one floor', async () => {
    h.auth.user = null;
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-stats')).toBeTruthy());
    expect(ownerRow(container)).toBeNull();
    expect(stripOf('Metrics')).toBeNull();
    expect(stripOf('Dates')).toBeNull();
    expect(screen.queryByText('Manage metrics')).toBeNull();
  });
});
