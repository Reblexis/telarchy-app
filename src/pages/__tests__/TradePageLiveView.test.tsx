import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';

/**
 * The live view on the floor (docs/ui-conventions.md, "The live view"):
 * when the workspace carries `liveViewUrl`, the floor embeds it as a
 * sandboxed iframe in the owner-prose column directly above "What is
 * <name>?", with a left-aligned caption and a link out; when it is null,
 * nothing is rendered and nothing else moves.
 */

const h = vi.hoisted(() => {
  const state = { liveViewUrl: null as string | null };
  const workspace = () => ({
    workspaceId: 'ws-1',
    name: 'Snake',
    slug: 'snake',
    ownerId: null,
    ownerHandle: null,
    description: null,
    charter: null,
    liveViewUrl: state.liveViewUrl,
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
  MarketChart: () => <div data-testid="chart" />,
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

afterEach(() => {
  h.state.liveViewUrl = null;
});

const URL = 'https://snake.example.com/board';

describe('the live view on the floor', () => {
  test('renders a sandboxed iframe of the URL when the workspace names one', async () => {
    h.state.liveViewUrl = URL;
    const { container } = renderFloor();
    const frame = await waitFor(() => {
      const el = container.querySelector('iframe.pubws-live-frame') as HTMLIFrameElement | null;
      if (!el) throw new Error('no live view frame yet');
      return el;
    });
    expect(frame.getAttribute('src')).toBe(URL);
    // The whole sandbox rule: scripts and same-origin so the page runs, and
    // nothing else (no forms, no popups, no top navigation).
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(frame.getAttribute('loading')).toBe('lazy');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.getAttribute('title')).toMatch(/live view/i);
  });

  test('carries the caption and a link that opens the URL in a new tab', async () => {
    h.state.liveViewUrl = URL;
    const { container } = renderFloor();
    await waitFor(() => {
      if (!container.querySelector('iframe.pubws-live-frame')) throw new Error('not yet');
    });
    const caption = container.querySelector('.pubws-live-caption') as HTMLElement;
    expect(caption.textContent).toMatch(/^Live view, published by the owner/);
    const link = caption.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(URL);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toMatch(/noopener/);
    expect(link.getAttribute('rel')).toMatch(/noreferrer/);
  });

  test('sits in the owner-prose column directly above "What is <name>?"', async () => {
    h.state.liveViewUrl = URL;
    const { container } = renderFloor();
    await waitFor(() => {
      if (!container.querySelector('iframe.pubws-live-frame')) throw new Error('not yet');
    });
    const col = container.querySelector('.pubws-know-col') as HTMLElement;
    const sections = Array.from(col.querySelectorAll(':scope > section')).map(s => s.getAttribute('aria-label'));
    const at = sections.indexOf('Live view');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(sections[at + 1]).toBe('What is Snake');
  });

  test('renders nothing when the URL is null', async () => {
    h.state.liveViewUrl = null;
    const { container } = renderFloor();
    await waitFor(() => {
      if (!container.querySelector('[aria-label="What is Snake"]')) throw new Error('floor not loaded');
    });
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('.pubws-live')).toBeNull();
    expect(container.textContent).not.toMatch(/Live view/);
  });
});
