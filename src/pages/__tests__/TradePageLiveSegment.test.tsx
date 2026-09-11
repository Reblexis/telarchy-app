import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The live view is a segment of the chart slot (docs/ui-conventions.md,
 * "The live view is a segment of the chart slot", 2026-09-11): a floor whose
 * `liveFeed` names a feed gets a third segment, LIVE, beside VALUE and CALL,
 * and opens on it; a floor with no feed has the two segments it had; a
 * remembered LIVE on a floor with no feed falls back to VALUE; and the
 * deprecated iframe renders nothing once a feed is set.
 */

const h = vi.hoisted(() => {
  const state = {
    liveFeed: null as { kind: string; url: string } | null,
    liveViewUrl: null as string | null,
  };
  const workspace = () => ({
    workspaceId: 'ws-1',
    name: 'Snake',
    slug: 'snake',
    ownerId: null,
    ownerHandle: null,
    description: null,
    charter: null,
    liveViewUrl: state.liveViewUrl,
    liveFeed: state.liveFeed,
    visibility: 'public',
    proposalReward: 0,
    spamPenalty: 0,
    joinAs: 'trader' as const,
    signupCredits: 100,
    metricCount: 1,
    openMarketCount: 1,
    participantCount: 3,
    heroMetricId: 'metric-score',
    heroMetricDescription: 'The score definition.',
    proposalStats: { total: 0, pending: 0, approved: 0, declined: 0 },
    markets: [
      {
        marketId: 'm-score',
        metricId: 'metric-score',
        metricName: 'Score',
        targetDate: '2026-12',
        resolvesOn: '2027-01-01T00:00:00Z',
        consensus: 120,
        probability: 0.5,
        liquidity: 200,
        rangeMin: 0,
        rangeMax: 1000,
      },
    ],
    marketHistory: [],
    marketHistoryMarketId: 'm-score',
    horizonHistories: [
      { marketId: 'm-score', periodStart: '2026-01-01', points: [], description: 'The score definition.' },
    ],
    proposals: [],
  });
  return { state, workspace };
});

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));

vi.mock('../../components/MarketChart', () => ({
  GEOM: {
    wide: { W: 720, PAD_L: 46, PAD_R: 58, H: 260 },
    compact: { W: 400, PAD_L: 40, PAD_R: 50, H: 300 },
  },
  MarketChart: ({ corner }: { corner?: unknown }) => <div data-testid="call-chart">{corner as never}</div>,
}));

vi.mock('../../components/live/LiveView', () => ({
  LiveView: ({ kind, slug, corner }: { kind: string; slug: string; corner?: unknown }) => (
    <div data-testid="live-view" data-kind={kind} data-slug={slug}>
      {corner as never}
    </div>
  ),
}));

vi.mock('../../lib/api', () => {
  const explicit: Record<string, unknown> = {
    getMarketplaceWorkspace: vi.fn(async () => h.workspace()),
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
    <MemoryRouter initialEntries={['/snake']}>
      <Routes>
        <Route path="/:slug" element={<TradePage />} />
      </Routes>
    </MemoryRouter>,
  );
}
const mode = (name: string) => screen.getByRole('button', { name });
const FEED = { kind: 'snake', url: 'https://snake.example.com' };

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
  sessionStorage.clear();
});
afterEach(() => {
  h.state.liveFeed = null;
  h.state.liveViewUrl = null;
  vi.clearAllMocks();
});

describe('the Live segment of the chart slot', () => {
  test('a floor with no feed has two segments, Value and Call, and opens on Value', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.nchart')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Live' })).toBeNull();
    expect(mode('Value').getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('live-view')).toBeNull();
  });

  test('a floor with a feed has a third segment, Live, and opens on it', async () => {
    h.state.liveFeed = FEED;
    const { container } = renderFloor();
    await waitFor(() => expect(screen.getByTestId('live-view')).toBeTruthy());
    expect(mode('Live').getAttribute('aria-pressed')).toBe('true');
    expect(mode('Value').getAttribute('aria-pressed')).toBe('false');
    expect(mode('Call').getAttribute('aria-pressed')).toBe('false');
    // One view at a time: no number chart while the game is on screen.
    expect(container.querySelector('.nchart')).toBeNull();
    expect(screen.queryByTestId('call-chart')).toBeNull();
    const view = screen.getByTestId('live-view');
    expect(view.getAttribute('data-kind')).toBe('snake');
    expect(view.getAttribute('data-slug')).toBe('snake');
  });

  test('the segments sit in one group, Value, Call, Live', async () => {
    h.state.liveFeed = FEED;
    renderFloor();
    await waitFor(() => expect(screen.getByTestId('live-view')).toBeTruthy());
    const group = screen.getByRole('group', { name: 'Chart' });
    const labels = Array.from(group.querySelectorAll('button')).map(b => b.textContent);
    expect(labels).toEqual(['Value', 'Call', 'Live']);
  });

  test('Value and Call still swap the slot, and Live brings the game back', async () => {
    h.state.liveFeed = FEED;
    const { container } = renderFloor();
    await waitFor(() => expect(screen.getByTestId('live-view')).toBeTruthy());
    fireEvent.click(mode('Value'));
    await waitFor(() => expect(container.querySelector('.nchart')).toBeTruthy());
    expect(screen.queryByTestId('live-view')).toBeNull();
    fireEvent.click(mode('Call'));
    await waitFor(() => expect(screen.getByTestId('call-chart')).toBeTruthy());
    expect(screen.queryByTestId('live-view')).toBeNull();
    fireEvent.click(mode('Live'));
    await waitFor(() => expect(screen.getByTestId('live-view')).toBeTruthy());
    expect(screen.queryByTestId('call-chart')).toBeNull();
  });

  test('a mode remembered for the session wins over the feed default', async () => {
    h.state.liveFeed = FEED;
    sessionStorage.setItem('floorChartMode', 'call');
    renderFloor();
    await waitFor(() => expect(screen.getByTestId('call-chart')).toBeTruthy());
    expect(mode('Live').getAttribute('aria-pressed')).toBe('false');
  });

  test('a remembered Live on a floor with no feed falls back to Value', async () => {
    sessionStorage.setItem('floorChartMode', 'live');
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.nchart')).toBeTruthy());
    expect(mode('Value').getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('live-view')).toBeNull();
  });

  test('the deprecated iframe renders nothing once a feed is set', async () => {
    h.state.liveFeed = FEED;
    h.state.liveViewUrl = 'https://snake.example.com/board';
    const { container } = renderFloor();
    await waitFor(() => expect(screen.getByTestId('live-view')).toBeTruthy());
    await waitFor(() => {
      if (!container.querySelector('[aria-label="What is Snake"]')) throw new Error('floor not loaded');
    });
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('.pubws-live')).toBeNull();
  });

  test('the deprecated iframe still frames a floor that has only liveViewUrl', async () => {
    h.state.liveViewUrl = 'https://snake.example.com/board';
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('iframe.pubws-live-frame')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Live' })).toBeNull();
  });
});
