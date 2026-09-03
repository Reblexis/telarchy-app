import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The owner's way into the metrics is a `metrics` chip at the end of the
 * metric picker row, the twin of the `dates` chip under it
 * (docs/owner-on-the-floor.md, dialog 1). The old `+ metric` button, which
 * only added, is gone: a control that vanished without a trace read as a
 * control that never existed (owner report 2026-09-03).
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

describe('the metrics chip', () => {
  test('with two metrics, the picker row ends in "metrics", and "+ metric" is gone', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('[aria-label="Metrics"]')).toBeTruthy());
    const chip = container.querySelector('[aria-label="Metrics"]') as HTMLButtonElement;
    expect(chip.textContent).toBe('metrics');
    expect(chip.className).toContain('pubws-date-add');
    expect(container.querySelector('[aria-label="Add a metric"]')).toBeNull();
    expect(container.textContent).not.toContain('+ metric');
  });

  test('with one metric, the caption still carries the chip', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(h.workspace(1) as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('[aria-label="Metrics"]')).toBeTruthy());
    expect(container.querySelector('[aria-label="Add a metric"]')).toBeNull();
    expect(container.textContent).not.toContain('+ metric');
  });
});
