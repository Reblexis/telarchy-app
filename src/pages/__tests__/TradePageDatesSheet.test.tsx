import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The dates are rows on the metric's sheet, not a dialog of their own
 * (docs/owner-on-the-floor.md, dialog 2; owner decision 2026-09-04). The
 * floor's `dates` chip therefore opens the metrics dialog straight onto the
 * sheet of the metric on screen. And a proposal that spawned with nothing
 * behind it tells a manager who can fund it, with Inject beside the words.
 */

const h = vi.hoisted(() => {
  const workspace = (over: { unfunded?: boolean } = {}) => ({
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
    heroMetricId: 'metric-a',
    heroMetricDescription: 'A.',
    proposalStats: { total: 1, pending: 1, approved: 0, declined: 0 },
    markets: [
      {
        marketId: 'm-a',
        metricId: 'metric-a',
        metricName: 'Daily active users (count)',
        targetDate: '2026-12',
        resolvesOn: '2027-01-01T00:00:00Z',
        consensus: 100,
        probability: 0.5,
        liquidity: 200,
        rangeMin: 0,
        rangeMax: 1000,
      },
    ],
    marketHistory: [],
    marketHistoryMarketId: 'm-a',
    horizonHistories: [{ marketId: 'm-a', periodStart: '2026-01-01', points: [], description: 'A.' }],
    proposals: [
      {
        id: 'job-1',
        number: 1,
        title: 'Replace the company slogan',
        description: 'Plainer language.',
        askUsd: 400,
        status: 'pending' as const,
        proposedByName: 'Ada',
        createdAt: '2026-09-01T09:00:00.000Z',
        marketPairCount: 1,
        markets: [
          {
            metricName: 'Daily active users (count)',
            targetDate: '2026-12',
            resolvesOn: '2027-01-01T00:00:00Z',
            approvedConsensus: over.unfunded ? null : 120,
            declinedConsensus: over.unfunded ? null : 100,
            delta: over.unfunded ? 0 : 20,
            approvedMarketId: 'm-approved',
            declinedMarketId: 'm-declined',
            approvedProbability: 0.5,
            approvedLiquidity: over.unfunded ? 0 : 200,
            declinedProbability: 0.5,
            declinedLiquidity: over.unfunded ? 0 : 200,
            rangeMin: 0,
            rangeMax: 1000,
          },
        ],
      },
    ],
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
    getFloorComments: vi.fn(async () => []),
    getMetricsIn: vi.fn(async () => [
      {
        id: 'metric-a',
        name: 'Daily active users (count)',
        description: 'A.',
        value: 100,
        marketRangeMax: 1000,
        settlementLagMinutes: 0,
        liquidityCredits: null,
      },
    ]),
    getMetric: vi.fn(async () => ({
      id: 'metric-a',
      name: 'Daily active users (count)',
      liquidityCredits: null,
      timePreference: { enabled: false, halfLife: 1, customHorizons: ['2026-12'] },
    })),
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

describe('"Manage dates" in the date chip menu', () => {
  test('opens the metrics dialog straight onto the sheet of the metric on screen', async () => {
    const { container } = renderFloor();
    // The way in is the last entry of the date chip's menu (docs/ui-conventions.md,
    // "The question line"); the chip is a button once the page knows the
    // viewer can manage.
    await waitFor(() => expect(container.querySelector('.pubws-chip--date')?.tagName).toBe('BUTTON'));
    fireEvent.click(container.querySelector('.pubws-chip--date') as HTMLElement);
    const options = within(container.querySelector('.pubws-chip-menu') as HTMLElement).getAllByRole('option');
    fireEvent.click(options[options.length - 1]);
    // The sheet, not the list: the head names the metric and the rows table
    // is on it, with the metric's one date as a row.
    await waitFor(() =>
      expect(
        (document.querySelector('.floor-modal-overlay .ticket-label')?.textContent ?? '').replace(/\s+/g, ' '),
      ).toContain('Metrics · Daily active users'),
    );
    await waitFor(() => expect(document.querySelector('.metrics-dates-table')).toBeTruthy());
    expect(screen.getByLabelText('Book opens with, December 2026')).toBeTruthy();
    expect(screen.getByLabelText('Proposal opens with, December 2026')).toBeTruthy();
  });
});

describe('a proposal with nothing behind it', () => {
  test('tells a manager who can put credits behind it, with Inject', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(h.workspace({ unfunded: true }) as never);
    renderFloor();
    const row = await screen.findByTitle('Replace the company slogan');
    fireEvent.click(row);
    await waitFor(() =>
      expect(
        screen.getByText(
          'This proposal has no price yet. Nobody has put credits behind it: the proposer can, or you can, with Inject.',
        ),
      ).toBeTruthy(),
    );
    expect(screen.queryByRole('button', { name: /Bet Higher/ })).toBeNull();
    expect(screen.getByText('Inject')).toBeTruthy();
  });
});
