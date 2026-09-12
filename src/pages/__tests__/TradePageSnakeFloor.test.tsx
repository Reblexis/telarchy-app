import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * A snake floor asks in the game's unit, and its NOW caption names the
 * attempt (docs/ui-conventions.md, "The question line" and "The stat row",
 * 2026-09-11). The floor whose `liveFeed.kind` is `snake` reads "in 60
 * moves" where any other floor reads "at 15:53", and once the live feed has
 * been read the reading's caption says which attempt the length belongs
 * to. Nothing changes for a floor with no feed.
 */

const h = vi.hoisted(() => {
  /** The newest open cell, settling exactly 60 minutes from the request:
   *  the +60min horizon's cell, built per request so the count holds. */
  const workspace = (feed: { kind: string; url: string } | null, name = 'Snake') => {
    // The +60min cell of the current minute: it starts 60 minutes after the
    // current minute and ends a minute later (docs/ui-conventions.md, "The
    // question line": moves count from the current minute to the cell).
    const minuteStart = Math.floor(Date.now() / 60_000) * 60_000;
    const cellStart = new Date(minuteStart + 60 * 60_000);
    const targetDate = cellStart.toISOString().slice(0, 16);
    const resolvesOn = new Date(cellStart.getTime() + 60_000).toISOString();
    return {
      workspaceId: 'ws-1',
      name,
      slug: 'snake',
      ownerId: null,
      ownerHandle: null,
      description: null,
      charter: null,
      liveFeed: feed,
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
          marketId: 'len-60',
          metricId: 'len',
          metricName: 'Reached length',
          metricOrder: 0,
          targetDate,
          resolvesOn,
          consensus: 6,
          probability: 0.5,
          liquidity: 200,
          pool: 3000,
          traderCount: 2,
          tradedVolume: 40,
          rangeMin: 0,
          rangeMax: 144,
        },
      ],
      marketHistory: [],
      marketHistoryMarketId: 'len-60',
      horizonHistories: [
        {
          marketId: 'len-60',
          periodStart: targetDate,
          points: [{ at: new Date(Date.now() - 5_000).toISOString(), value: 3 }],
          description: 'The length reached.',
        },
      ],
      proposals: [],
    };
  };
  const live = () => ({
    game: {
      snake: [{ x: 1, y: 1 }],
      food: null,
      heading: 'right',
      length: 3,
      step: 41,
      deaths: 40,
      complete: false,
      size: 12,
      gameNumber: 2,
    },
    grid: 12,
    gameNumber: 2,
    next: { action: 'left', direction: 'up', decided: false, seconds: 31 },
    open: null,
  });
  const onState: { fn: ((s: unknown) => void) | null } = { fn: null };
  return { workspace, live, onState };
});

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));

vi.mock('../../components/MarketChart', () => ({
  GEOM: {
    wide: { W: 720, PAD_L: 46, PAD_R: 58, H: 260 },
    compact: { W: 400, PAD_L: 40, PAD_R: 50, H: 300 },
  },
  MarketChart: () => <div data-testid="call-chart" />,
}));

/* The live segment is stubbed; what the floor needs from it is the state
   it reports back, which the test feeds through `onState`. */
vi.mock('../../components/live/LiveView', () => ({
  LiveView: ({ onState }: { onState?: (s: unknown) => void }) => {
    h.onState.fn = onState ?? null;
    return <div data-testid="live-view" />;
  },
}));

vi.mock('../../lib/api', () => {
  const explicit: Record<string, unknown> = {
    getMarketplaceWorkspace: vi.fn(async () => h.workspace({ kind: 'snake', url: 'https://snake.example.com' })),
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
    <MemoryRouter initialEntries={['/snake']}>
      <Routes>
        <Route path="/:slug" element={<TradePage />} />
      </Routes>
    </MemoryRouter>,
  );
}
const words = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const ask = (container: HTMLElement) => words(container.querySelector('.pubws-instrument-ask'));
const nowCaption = (container: HTMLElement) => words(container.querySelector('.pubws-stat--now .pubws-stat-what'));

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
  h.onState.fn = null;
  vi.mocked(api.getMarketplaceWorkspace).mockImplementation(
    async () => h.workspace({ kind: 'snake', url: 'https://snake.example.com' }) as never,
  );
});
afterEach(() => vi.clearAllMocks());

describe('A SNAKE FLOOR ASKS IN MOVES, NOT AT A CLOCK TIME', () => {
  test('the headline reads "in 60 moves" for the cell 60 minutes out', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-instrument-ask')).toBeTruthy());
    expect(ask(container)).toBe("What will be Snake's reached length in 60 moves?");
    expect(ask(container)).not.toMatch(/\bat \d\d:\d\d/);
  });

  test('a floor with no feed still asks at the clock time', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => h.workspace(null, 'LookPilot') as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-instrument-ask')).toBeTruthy());
    expect(ask(container)).toMatch(/^What will be LookPilot's reached length at \d\d:\d\d\?$/);
    expect(ask(container)).not.toContain('moves');
  });
});

describe('THE NOW CAPTION NAMES THE ATTEMPT', () => {
  test('once the live feed is read the caption is "now · attempt 41" (deaths + 1), age kept', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(screen.getByTestId('live-view')).toBeTruthy());
    await waitFor(() => expect(h.onState.fn).toBeTruthy());
    act(() => h.onState.fn?.(h.live()));
    await waitFor(() => expect(nowCaption(container)).toMatch(/^now · attempt 41 · read /));
  });

  test('before the feed is read the caption is as on every floor', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-stat--now .pubws-stat-what')).toBeTruthy());
    expect(nowCaption(container)).toMatch(/^now · read /);
    expect(nowCaption(container)).not.toContain('attempt');
  });

  test('a floor with no feed never names an attempt', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => h.workspace(null, 'LookPilot') as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-stat--now .pubws-stat-what')).toBeTruthy());
    expect(screen.queryByTestId('live-view')).toBeNull();
    expect(nowCaption(container)).toMatch(/^now · read /);
    expect(nowCaption(container)).not.toContain('attempt');
  });
});

/**
 * A metric may carry the question in the owner's own words
 * (docs/ui-conventions.md, "The question line"; Viktor, 2026-09-12: "add
 * support for custom title of a market and then edit the title of the main
 * unconditional market"). When it does, the floor asks that and nothing
 * else; when it does not, the floor composes the question as it always has.
 */
describe('A CUSTOM TITLE IS THE QUESTION, VERBATIM', () => {
  const titled = (title: unknown, name = 'Snake') => {
    const ws = h.workspace({ kind: 'snake', url: 'https://snake.example.com' }, name);
    (ws.markets[0] as Record<string, unknown>).marketTitle = title;
    return ws;
  };

  test('the headline is the title the owner wrote, with no name, metric or date added', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation(
      async () => titled('What length will I reach on this attempt?') as never,
    );
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-instrument-ask')).toBeTruthy());
    expect(ask(container)).toBe('What length will I reach on this attempt?');
    expect(ask(container)).not.toContain("Snake's");
    expect(ask(container)).not.toContain('60 moves');
  });

  test('a blank title is no title: the composed question stands', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => titled('   ') as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-instrument-ask')).toBeTruthy());
    expect(ask(container)).toBe("What will be Snake's reached length in 60 moves?");
  });

  test('no title at all: the composed question stands', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => titled(null) as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-instrument-ask')).toBeTruthy());
    expect(ask(container)).toBe("What will be Snake's reached length in 60 moves?");
  });
});
