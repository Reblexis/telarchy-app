import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The owner's way into the metrics and the dates is the last entry of each
 * caption chip's menu, "Manage metrics" and "Manage dates"
 * (docs/ui-conventions.md "The question line", revised 2026-09-04; the
 * dialogs themselves are docs/owner-on-the-floor.md). The old `metrics` and
 * `dates` chips beside the segmented rows are gone with the rows, and the
 * older `+ metric` button stays gone: a control that vanished without a
 * trace read as a control that never existed (owner report 2026-09-03).
 * A visitor never sees either entry (TradePageBoardFloor.test.tsx).
 */

const h = vi.hoisted(() => {
  const market = (id: string, metricId: string, metricName: string, targetDate: string, resolvesOn: string) => ({
    marketId: id,
    metricId,
    metricName,
    targetDate,
    resolvesOn,
    consensus: 100,
    probability: 0.5,
    liquidity: 200,
    rangeMin: 0,
    rangeMax: 1000,
  });
  const workspace = (metricCount: number) => ({
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
    metricCount,
    openMarketCount: metricCount,
    participantCount: 3,
    heroMetricId: 'metric-a',
    heroMetricDescription: 'A.',
    proposalStats: { total: 0, pending: 0, approved: 0, declined: 0 },
    markets: [
      market('m-a', 'metric-a', 'Signups (count)', '2026-12', '2027-01-01T00:00:00Z'),
      ...(metricCount > 1 ? [market('m-b', 'metric-b', 'Revenue (USD)', '2026-09', '2026-10-01T00:00:00Z')] : []),
    ],
    marketHistory: [],
    marketHistoryMarketId: 'm-a',
    horizonHistories: [
      { marketId: 'm-a', periodStart: '2026-01-01', points: [], description: 'A.' },
      ...(metricCount > 1 ? [{ marketId: 'm-b', periodStart: '2026-09-01', points: [], description: 'B.' }] : []),
    ],
    proposals: [],
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
    getMarketplaceWorkspace: vi.fn(async () => h.workspace(2)),
    joinWorkspace: vi.fn(async () => ({})),
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

describe("the owner's entries in the caption menus", () => {
  test('the owner sees "Manage metrics" last in the metric menu, opening the metrics dialog', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-chip--metric')).toBeTruthy());
    // The old chips are gone with the segmented rows.
    expect(container.querySelector('[aria-label="Metrics"]')).toBeNull();
    expect(container.querySelector('[aria-label="Add a metric"]')).toBeNull();
    expect(container.textContent).not.toContain('+ metric');
    fireEvent.click(container.querySelector('.pubws-chip--metric') as HTMLElement);
    const menu = container.querySelector('.pubws-chip-menu') as HTMLElement;
    const options = within(menu).getAllByRole('option');
    expect(options.map(o => o.textContent)).toEqual(['Signups', 'Revenue', 'Manage metrics']);
    fireEvent.click(options[2]);
    await waitFor(() => expect(screen.getByRole('dialog', { name: /metrics/i })).toBeTruthy());
    expect(container.querySelector('.pubws-chip-menu')).toBeNull();
  });

  test('the owner sees "Manage dates" last in the date menu, opening the metric sheet with its date rows', async () => {
    const { container } = renderFloor();
    // One date on this floor, so the chip is a menu only once the page
    // knows the viewer can manage (the profile read lands after the floor).
    await waitFor(() => expect(container.querySelector('.pubws-chip--date')?.tagName).toBe('BUTTON'));
    expect(container.querySelector('[aria-label="The dates this metric is priced on"]')).toBeNull();
    fireEvent.click(container.querySelector('.pubws-chip--date') as HTMLElement);
    const menu = container.querySelector('.pubws-chip-menu') as HTMLElement;
    const options = within(menu).getAllByRole('option');
    expect(options.map(o => o.textContent)).toEqual(['31 Dec', 'Manage dates']);
    fireEvent.click(options[1]);
    // The dates are rows on the metric's sheet, not a dialog of their own
    // (docs/owner-on-the-floor.md, dialog 2; owner decision 2026-09-04).
    // The sheet itself, rows included, is TradePageDatesSheet.test.tsx.
    await waitFor(() => expect(screen.getByRole('dialog', { name: /metric/i })).toBeTruthy());
    expect(container.querySelector('.pubws-chip-menu')).toBeNull();
  });

  test('with one metric the owner still has the menu, because it is the way into the metrics', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(h.workspace(1) as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-chip--metric')?.tagName).toBe('BUTTON'));
    fireEvent.click(container.querySelector('.pubws-chip--metric') as HTMLElement);
    const options = within(container.querySelector('.pubws-chip-menu') as HTMLElement).getAllByRole('option');
    expect(options.map(o => o.textContent)).toEqual(['Signups', 'Manage metrics']);
  });
});
