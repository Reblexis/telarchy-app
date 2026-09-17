import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Under the ticket, the door to a bot (docs/ui-conventions.md, "The rails,
 * and the standings under the verbs"; owner ask 2026-09-16: "a big button on
 * each worksapce floor saying something like add your own trading bot").
 *
 * The rules: EVERY floor carries the door, in the ticket rail, whether or
 * not a market is open; it opens the Agents page with this market preset; and it is
 * one pill with one caption, not a paragraph.
 */

const h = vi.hoisted(() => {
  const DAY_MS = 24 * 60 * 60 * 1000;
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
        description: 'Every credit LookPilot earned on Steam in the trailing 30 days.',
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
  return { workspace };
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
    getMarketActivity: vi.fn(async () => ({
      consensus: null,
      positions: [],
      trades: [],
    })),
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

vi.mock('../../components/live/LiveView', () => ({ LiveView: () => <div data-testid="live-view" /> }));

const { TradePage } = await import('../TradePage');

function renderFloor(path = '/lookpilot') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/marketplace/:workspaceId" element={<TradePage />} />
        <Route path="/:slug" element={<TradePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function withWorkspace(overrides: Record<string, unknown>) {
  const { api } = await import('../../lib/api');
  vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(h.workspace(overrides) as never);
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

describe('every floor carries the door to a bot, in the ticket rail', () => {
  test('the pill opens the Agents page with this market preset and sits in the right rail, under the ticket', async () => {
    const { container } = renderFloor();
    const door = await screen.findByRole('link', {
      name: /Add your own trading bot/,
    });
    expect(door).toHaveAttribute('href', '/agents?market=lookpilot#agent-setup');
    const rail = container.querySelector('.pubws-rail--right');
    expect(rail).toBeTruthy();
    expect(rail!.contains(door)).toBe(true);
    const ticket = container.querySelector('.pubws-ticket-inline');
    expect(ticket).toBeTruthy();
    expect(ticket!.compareDocumentPosition(door) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('one caption under it, and nothing else in the rail besides the ticket', async () => {
    const { container } = renderFloor();
    const door = await screen.findByRole('link', {
      name: /Add your own trading bot/,
    });
    const block = door.closest('.pubws-botdoor');
    expect(block).toBeTruthy();
    expect(block!.querySelectorAll('p').length).toBe(1);
    expect(container.querySelectorAll('.pubws-rail--right .pubws-botdoor').length).toBe(1);
  });

  test('THE DOOR IS THERE WITH NO MARKET OPEN: a bot is added to the floor, not to one book', async () => {
    await withWorkspace({
      markets: [],
      horizonHistories: [],
      marketHistory: [],
      marketHistoryMarketId: null,
    });
    const { container } = renderFloor();
    const door = await screen.findByRole('link', {
      name: /Add your own trading bot/,
    });
    expect(door).toHaveAttribute('href', '/agents?market=lookpilot#agent-setup');
    expect(container.querySelector('.pubws-rail--right')!.contains(door)).toBe(true);
  });

  test('on the id address the door still names the slug, so it opens the same market', async () => {
    renderFloor('/marketplace/ws-1');
    const door = await screen.findByRole('link', {
      name: /Add your own trading bot/,
    });
    await waitFor(() => expect(door).toHaveAttribute('href', '/agents?market=lookpilot#agent-setup'));
  });
});

/* Persona run 2026-09-17, the bot author: "I found a starter bot, but I still
   cannot tell it where to read the chess game." telarchy-chess docs/chess.md
   says the floor links to its trading guide, which names the feed. */
describe('a fed floor links to its own bot guide', () => {
  const GUIDE = 'https://github.com/Reblexis/telarchy-chess/blob/main/docs/trading.md';
  test('the chess floor carries "How to trade chess with a bot" under the door, opening the guide in a new tab', async () => {
    await withWorkspace({ liveFeed: { kind: 'chess', url: 'https://chess.example.com' } });
    renderFloor();
    const link = await screen.findByRole('link', {
      name: 'How to trade chess with a bot: the game feed, a dry run, a reference bot',
    });
    expect(link).toHaveAttribute('href', GUIDE);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toMatch(/noopener/);
    expect(link.closest('.pubws-botdoor')).toBeTruthy();
  });
  test('a floor with no feed, or a feed with no guide, carries no such link', async () => {
    renderFloor();
    await screen.findByRole('link', { name: /Add your own trading bot/ });
    expect(screen.queryByRole('link', { name: /How to trade/ })).toBeNull();
    await withWorkspace({ liveFeed: { kind: 'snake', url: 'https://snake.example.com' } });
    renderFloor();
    await waitFor(() => expect(screen.getAllByRole('link', { name: /Add your own trading bot/ }).length).toBe(2));
    expect(screen.queryByRole('link', { name: /How to trade/ })).toBeNull();
  });
});
