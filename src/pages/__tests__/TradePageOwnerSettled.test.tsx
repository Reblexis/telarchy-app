import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * A book on a date that settles when the owner settles it, on the floor
 * (docs/ui-conventions.md, "The question line" and "The stat row";
 * docs/market-integrity.md, "A date with no clock"). The caption names who
 * settles it and prints no day and no countdown, and a titled date reads
 * as its title in the question.
 */

const FAR = '9999-12-31T00:00:00.000Z';

const h = vi.hoisted(() => {
  const workspace = (over: { marketTitle?: string | null; dateTitle?: string | null; withWeek?: boolean } = {}) => {
    const open = {
      marketId: 'len-open',
      metricId: 'len',
      metricName: 'Reached length',
      metricOrder: 0,
      marketTitle: over.marketTitle ?? null,
      dateTitle: over.dateTitle === undefined ? 'this attempt' : over.dateTitle,
      targetDate: 'until-settled',
      resolvesOn: '9999-12-31T00:00:00.000Z',
      consensus: 27.4,
      probability: 0.5,
      liquidity: 200,
      pool: 3000,
      traderCount: 4,
      tradedVolume: 412,
      rangeMin: 0,
      rangeMax: 64,
    };
    const week = {
      ...open,
      marketId: 'len-week',
      dateTitle: null,
      targetDate: '2099-W01',
      resolvesOn: '2099-01-05T00:00:00.000Z',
      consensus: 23.1,
    };
    return {
      workspaceId: 'ws-1',
      name: 'Snake',
      slug: 'snake',
      ownerId: null,
      ownerHandle: null,
      description: null,
      charter: null,
      liveFeed: null,
      visibility: 'public',
      proposalReward: 0,
      spamPenalty: 0,
      joinAs: 'trader' as const,
      signupCredits: 100,
      metricCount: 1,
      openMarketCount: over.withWeek ? 2 : 1,
      participantCount: 3,
      proposalStats: { total: 0, pending: 0, approved: 0, declined: 0 },
      markets: over.withWeek ? [week, open] : [open],
      marketHistory: [],
      marketHistoryMarketId: 'len-open',
      horizonHistories: [
        {
          marketId: 'len-open',
          periodStart: '1970-01-01T00:00:00.000Z',
          points: [{ at: new Date(Date.now() - 5_000).toISOString(), value: 26 }],
          description: 'The length the current attempt has reached.',
        },
      ],
      proposals: [],
    };
  };
  return { workspace };
});

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));

vi.mock('../../components/MarketChart', () => ({
  GEOM: {
    wide: { W: 720, PAD_L: 46, PAD_R: 58, H: 260 },
    compact: { W: 400, PAD_L: 40, PAD_R: 50, H: 300 },
  },
  MarketChart: () => <div data-testid="call-chart" />,
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
const ask = (c: HTMLElement) => words(c.querySelector('.pubws-instrument-ask'));
const callCaption = (c: HTMLElement) => words(c.querySelector('.pubws-stat--call .pubws-stat-what'));

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
  vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => h.workspace() as never);
});
afterEach(() => vi.clearAllMocks());

describe('A BOOK THE OWNER SETTLES NAMES NO CLOCK', () => {
  test('the call caption says the owner settles it, with no day and no countdown', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-stat--call .pubws-stat-what')).toBeTruthy());
    expect(callCaption(container)).toBe("market's call · settles this attempt");
    expect(callCaption(container)).not.toMatch(/settles in|for \d|9999|Dec/);
  });

  test('its hover says when it settles in words, never the far instant', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-settle-in')).toBeTruthy());
    expect(container.querySelector('.pubws-settle-in')?.getAttribute('title')).toBe('settles this attempt');
    // What a reader can see or hover, not the markup: an SVG coordinate such
    // as x1="656.8841199999999" contains "9999" whenever the clock makes it so.
    const readable = [
      container.textContent ?? '',
      ...[...container.querySelectorAll('[title]')].map(e => e.getAttribute('title') ?? ''),
    ];
    for (const text of readable) expect(text).not.toContain('9999');
  });
});

describe("THE VALUE CHART OF AN OWNER-SETTLED DATE DRAWS THE MARKET'S CALL RIGHT OF NOW", () => {
  test('the call the stat row names is the level the chart draws, in a strip with no date', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.nchart-call-label')).toBeTruthy());
    const price = container.querySelector('.pubws-stat--call .pubws-price')?.textContent;
    expect(container.querySelector('.nchart-call-label')?.textContent).toBe(`${price} market's call`);
    expect(container.querySelector('.nchart-strip-cap')?.textContent).toBe('until it settles');
    expect(container.querySelector('.nchart-legend')?.textContent).toContain("market's call");
    // Still no dot at a far instant: the dated marker vocabulary stays off.
    expect(container.querySelector('.nchart-marker')).toBeNull();
  });
});

describe('A TITLED DATE READS AS ITS TITLE', () => {
  test('the question ends with the title, no lead word', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-instrument-ask')).toBeTruthy());
    expect(ask(container)).toBe("What will be Snake's reached length this attempt?");
  });

  test("the metric's own question still replaces the whole sentence", async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation(
      async () => h.workspace({ marketTitle: 'What length will I reach on this attempt?' }) as never,
    );
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-instrument-ask')).toBeTruthy());
    expect(ask(container)).toBe('What length will I reach on this attempt?');
  });

  test('untitled, it reads "until settled"', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => h.workspace({ dateTitle: null }) as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-instrument-ask')).toBeTruthy());
    expect(ask(container)).toBe("What will be Snake's reached length until settled?");
    expect(callCaption(container)).toBe("market's call · settled by the owner");
  });

  test('on the date strip its tab is the title, after the dated book', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => h.workspace({ withWeek: true }) as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-strip--date')).toBeTruthy());
    const tabs = Array.from(container.querySelectorAll('.pubws-strip--date .pubws-strip-name')).map(words);
    expect(tabs[tabs.length - 1]).toBe('this attempt');
    expect(tabs).toHaveLength(2);
  });
});

void FAR;
