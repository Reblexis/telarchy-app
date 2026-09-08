import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The floor as a board (docs/ui-conventions.md, revised 2026-09-04): the
 * caption is two chips on one line, each a menu; the stat row is two cells
 * on hairlines with the caption line over the value; and the page ends on
 * a three-cell board that carries the owner sentence and the email field.
 *
 * A visitor here (useAuth: nobody signed in), so canManage stays false and
 * no "Manage ..." entry may appear. The owner's entries are pinned in
 * TradePageMetricsChip.test.tsx.
 */

const h = vi.hoisted(() => {
  const market = (
    id: string,
    metricId: string,
    metricName: string,
    targetDate: string,
    resolvesOn: string,
    metricOrder: number,
  ) => ({
    marketId: id,
    metricId,
    metricName,
    metricOrder,
    targetDate,
    resolvesOn,
    consensus: 6_850,
    probability: 0.5,
    liquidity: 200,
    rangeMin: 0,
    rangeMax: 50_000,
  });
  /** Two metrics, each on this week and on 30 Sep: a 2x2 grid. */
  const grid = () => ({
    workspaceId: 'ws-1',
    name: 'LookPilot',
    slug: 'lookpilot',
    ownerId: null,
    ownerHandle: null,
    description: 'Webcam head tracker for sims',
    charter: null,
    visibility: 'public',
    proposalReward: 0,
    spamPenalty: 0,
    joinAs: 'viewer' as const,
    signupCredits: 100,
    metricCount: 2,
    openMarketCount: 4,
    participantCount: 3,
    proposalStats: { total: 0, pending: 0, approved: 0, declined: 0 },
    markets: [
      market('rev-week', 'rev', 'LookPilot net revenue (USD)', '2026-W36', '2026-09-07T00:00:00Z', 0),
      market('rev-sep', 'rev', 'LookPilot net revenue (USD)', '2026-09', '2026-10-01T00:00:00Z', 0),
      market('rev-week-2', 'reviews', 'Steam reviews (count)', '2026-W36', '2026-09-07T00:00:00Z', 1),
      market('rev-sep-2', 'reviews', 'Steam reviews (count)', '2026-09', '2026-10-01T00:00:00Z', 1),
    ],
    marketHistory: [],
    marketHistoryMarketId: 'rev-sep',
    horizonHistories: [
      {
        marketId: 'rev-week',
        periodStart: '2026-08-31',
        points: [{ at: '2026-09-04T10:00:00Z', value: 7_674 }],
        description: 'Everything LookPilot earned in the last 30 days. Net of refunds.',
      },
      {
        marketId: 'rev-sep',
        periodStart: '2026-09-01',
        points: [{ at: '2026-09-04T10:00:00Z', value: 7_674 }],
        description: 'Everything LookPilot earned in the last 30 days. Net of refunds.',
      },
      { marketId: 'rev-week-2', periodStart: '2026-08-31', points: [], description: 'Reviews.' },
      { marketId: 'rev-sep-2', periodStart: '2026-09-01', points: [], description: 'Reviews.' },
    ],
    proposals: [],
  });
  /** One metric on one date: nothing to pick. */
  const single = () => {
    const ws = grid();
    ws.markets = [ws.markets[1]];
    ws.horizonHistories = [ws.horizonHistories[1]];
    ws.metricCount = 1;
    ws.openMarketCount = 1;
    return ws;
  };
  return { grid, single };
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
    getMarketplaceWorkspace: vi.fn(async () => h.grid()),
    joinWorkspace: vi.fn(async () => ({})),
    joinWaitlist: vi.fn(async () => ({ ok: true })),
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

function renderFloor(path = '/lookpilot') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/:slug" element={<TradePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-09-04T10:35:00Z') });
  vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(h.grid() as never);
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
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('the page ends on a three-cell board', () => {
  test('the page ends with three cells: New here? / Do the work / Your own numbers', async () => {
    const { container } = renderFloor();
    const end = await screen.findByLabelText('Next steps');
    expect(end.className).toContain('pubws-end');
    // Outside the floor grid (a sticky rail is constrained by the grid
    // container, so a board inside it had the rails sliding over it), in
    // its own full-width wrapper right after the floor's main.
    expect(end.parentElement?.className).toContain('pubws-end-wrap');
    expect(end.parentElement?.previousElementSibling?.className).toContain('pubws-main--floor');
    const cells = [...end.querySelectorAll('.pubws-end-cell')];
    expect(cells.length).toBe(3);
    expect(cells.map(c => c.querySelector('.pubws-end-label')?.textContent)).toEqual([
      'New here?',
      'Do the work',
      'Your own numbers',
    ]);
    expect(cells[0].querySelector('.pubws-end-line')?.textContent).toBe(
      'Telarchy prices what a decision does to a number before anyone commits.',
    );
    const how = within(cells[0] as HTMLElement).getByRole('link', { name: /how it works/i });
    expect(how.getAttribute('href')).toBe('/forecast');
    expect(how.querySelector('svg')).toBeTruthy();
    expect(cells[1].querySelector('.pubws-end-line')?.textContent).toBe(
      'Offer to do it and name your price. The owner pays in real money if the market says it clears.',
    );
    expect(within(cells[1] as HTMLElement).getByRole('button', { name: /offer a proposal/i })).toBeTruthy();
    // The third cell carries the owner sentence and the email field.
    expect(cells[2].querySelector('.pubws-end-line')?.textContent).toBe(
      'See what a decision does to your numbers before you say yes.',
    );
    expect(cells[2].querySelector('.pubws-setup-row input[type="email"]')).toBeTruthy();
    expect(within(cells[2] as HTMLElement).getByRole('button', { name: 'Get set up' })).toBeTruthy();
    // The old two-sentence block and the separate lead are gone.
    expect(container.querySelector('.pubws-close')).toBeNull();
    expect(container.querySelector('.pubws-close-line')).toBeNull();
    expect(container.querySelector('.pubws-setup-lead')).toBeNull();
    expect(container.querySelector('.pubws-door')).toBeNull();
    expect(container.textContent).not.toContain('Want this for your own numbers');
  });

  test('"Offer a proposal" scrolls to the proposal rail', async () => {
    const into = vi.fn();
    Element.prototype.scrollIntoView = into;
    const ws = h.grid();
    ws.joinAs = 'trader';
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    renderFloor();
    const end = await screen.findByLabelText('Next steps');
    fireEvent.click(within(end).getByRole('button', { name: /offer a proposal/i }));
    expect(into).toHaveBeenCalled();
  });

  test("submitting still posts to the waitlist with the floor's source", async () => {
    renderFloor();
    const end = await screen.findByLabelText('Next steps');
    fireEvent.change(within(end).getByLabelText('Your email'), { target: { value: 'ceo@example.com' } });
    fireEvent.click(within(end).getByRole('button', { name: 'Get set up' }));
    await waitFor(() =>
      expect(vi.mocked(api.joinWaitlist)).toHaveBeenCalledWith({ email: 'ceo@example.com', source: 'lookpilot' }),
    );
    await screen.findByText('Got it. We will get back to you within a few days.');
    // The sentence over the field stays; the field is what went.
    expect(end.querySelector('.pubws-setup-row')).toBeNull();
    expect(end.querySelector('.pubws-end-line')?.textContent).toContain('Telarchy prices');
  });

  test('a refused email keeps the field and shows the error line', async () => {
    vi.mocked(api.joinWaitlist).mockRejectedValueOnce(new Error('That address bounced'));
    renderFloor();
    const end = await screen.findByLabelText('Next steps');
    fireEvent.change(within(end).getByLabelText('Your email'), { target: { value: 'ceo@example.com' } });
    fireEvent.click(within(end).getByRole('button', { name: 'Get set up' }));
    await screen.findByText('That address bounced');
    expect(end.querySelector('.pubws-setup-err')).toBeTruthy();
    expect(end.querySelector('.pubws-setup-row input')).toBeTruthy();
  });
});

/**
 * The proposals board says what a row is to a trader (docs/ui-conventions.md,
 * "The proposals board").
 */
describe('the proposals board says what a row is', () => {
  test('one quiet line under the label', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-rail--right [aria-label="Proposals"]')).toBeTruthy());
    const rail = container.querySelector('.pubws-rail--right') as HTMLElement;
    const why = rail.querySelector('.pubws-ballot-why') as HTMLElement;
    expect(why.textContent).toBe(
      'Each one is a pair of books: the number if approved, the number if declined. Trade either.',
    );
    const label = within(rail).getByRole('heading', { name: 'Proposals' });
    expect(label.compareDocumentPosition(why) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

/**
 * What survives from the 2026-09-06 layout after the 2026-09-08 redesign
 * (docs/ui-conventions.md, "The rails"). The widths, the one-column order,
 * the question line, the numbers band, the settlement line and the verbs
 * are pinned by FloorFrame.test.tsx and FloorMarketColumn.test.tsx, in the
 * design they now have; what is left here is the standings and the season
 * advert, which the redesign moved but did not rewrite.
 */
describe('the standings and the season advert', () => {
  const traders = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `p${i + 1}`,
      nickname: `trader${i + 1}`,
      rank: i + 1,
      totalEarnings: 500 - i,
      totalTrades: 3,
      resolvedMarkets: 0,
      accuracy: null,
      calibration: null,
      lastTradeAt: null,
    }));
  const contractors = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `c${i + 1}`,
      name: `contractor${i + 1}`,
      impact: 50 - i,
      jobs: 1,
      pendingJobs: 1,
      pricedJobs: 1,
      earnedUsd: 0,
    }));
  /** A trader floor with a season running, counts on the hero, boards, and
   *  one announcement on the record. */
  const floor = () => {
    const ws = h.grid() as ReturnType<typeof h.grid> & {
      topContractors?: unknown[];
      announcementCount?: number;
      latestAnnouncement?: unknown;
    };
    ws.joinAs = 'trader';
    for (const m of ws.markets) Object.assign(m, { traderCount: 8, tradedVolume: 2_778 });
    ws.topContractors = contractors(5);
    ws.announcementCount = 1;
    ws.latestAnnouncement = {
      id: 'a1',
      body: 'Refunds ran high this week.',
      publishedAt: '2026-08-25T09:00:00.000Z',
      publishedBy: null,
    };
    return ws;
  };
  const season = {
    id: 's0',
    name: 'Season 0',
    status: 'running',
    startsAt: '2026-08-22T00:00:00.000Z',
    endsAt: '2026-10-01T00:00:00.000Z',
    settledAt: null,
    poolUsd: 1000,
    payoutMode: 'ladder',
    minPayoutUsd: 0,
    strictEligibility: false,
    ladder: [{ place: 1, prizeUsd: 500 }],
    rulesUrl: '/legal/season-0',
  };
  const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  beforeEach(() => {
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(floor() as never);
    vi.mocked(api.getLeaderboard).mockResolvedValue({ participants: traders(5) } as never);
    vi.mocked(api.getSeasons).mockResolvedValue({ seasons: [season] } as never);
  });

  test("no count strip anywhere: the book's facts row is the only place the counts appear", async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-standings')).toBeTruthy());
    expect(container.querySelector('.pubws-count')).toBeNull();
    expect(container.querySelector('.pubws-count-line')).toBeNull();
    expect(container.querySelector('.pubws-count-go')).toBeNull();
    expect(container.textContent).not.toMatch(/traded on this market/);
    // The facts row lives at the right end of the verbs panel's stake row.
    expect(container.querySelector('.pubws-verbs .pubws-facts')).toBeTruthy();
  });

  test('the standings sit under the Otto row, as their own grid item, and link out rather than open in place', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-standings')).toBeTruthy());
    const verbs = container.querySelector('.pubws-verbs') as HTMLElement;
    const otto = container.querySelector('.pubws-otto-row') as HTMLElement;
    const standings = container.querySelector('.pubws-standings') as HTMLElement;
    expect(verbs).toBeTruthy();
    expect(otto).toBeTruthy();
    expect(follows(verbs, otto)).toBe(true);
    expect(follows(otto, standings)).toBe(true);
    // A grid item of the floor, never inside a rail: on a phone the
    // proposals board stacks between the market and the standings.
    expect(standings.parentElement).toBe(container.querySelector('.pubws-main--floor'));
    expect(standings.closest('.pubws-rail')).toBeNull();
    expect(standings.querySelector('.pubws-standings-key')?.textContent).toBe(
      'IN = in the season · $ = prizes claimed',
    );
    const blocks = [...standings.querySelectorAll('.pubws-lb-block')];
    expect(blocks.map(b => b.querySelector('.pubws-h2')?.textContent)).toEqual(['Top traders', 'Top contractors']);
    expect(blocks[0].querySelectorAll('.pubws-lb-row')).toHaveLength(3);
    expect(blocks[1].querySelectorAll('.pubws-lb-row')).toHaveLength(3);
    expect(blocks[0].querySelector('.pubws-lb-meta')?.textContent).toBe('this market');
    const more = standings.querySelectorAll('.pubws-lb-more');
    expect(more).toHaveLength(1);
    expect(more[0].getAttribute('href')).toBe('/leaderboard');
    expect(more[0].textContent).toBe('Show full leaderboard');
  });

  test('the season block is an advert: three lines, no counts, no running sentence, and ONE of it', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-rail--left .pubws-season')).toBeTruthy());
    const advert = container.querySelector('.pubws-rail--left .pubws-season') as HTMLElement;
    const hero = advert.querySelector('.pubws-season-hero') as HTMLElement;
    const terms = advert.querySelector('.pubws-season-terms') as HTMLElement;
    expect(hero.textContent).toBe('$1,000 in prizes');
    // 2026-09-04 10:35Z to 2026-10-01 00:00Z: 26 days.
    expect(terms.textContent).toBe('Season 0 ends in 26 days. Free to enter.');
    const go = within(advert).getByRole('link', { name: 'Enter the season' });
    expect(go.getAttribute('href')).toBe('/season');
    expect(follows(hero, terms)).toBe(true);
    expect(follows(terms, go)).toBe(true);
    expect(advert.children).toHaveLength(3);
    expect(advert.textContent).not.toMatch(/traders/);
    expect(advert.textContent).not.toMatch(/traded/);
    expect(advert.textContent).not.toMatch(/ and /);
    // The one-line form under the stat row is not rendered any more
    // (2026-09-08): the block in the left rail is the only advert.
    expect(container.querySelectorAll('a[href="/season"]')).toHaveLength(1);
  });

  test('no season, no season block at all', async () => {
    vi.mocked(api.getSeasons).mockResolvedValue({ seasons: [] } as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-rail--left')).toBeTruthy());
    expect(container.querySelector('.pubws-season')).toBeNull();
    expect(container.querySelector('a[href="/season"]')).toBeNull();
  });

  test('the left rail is about THIS floor: the books, the season, the announcements, in that order', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-standings')).toBeTruthy());
    const left = container.querySelector('.pubws-main--floor .pubws-rail--left') as HTMLElement;
    expect(left).toBeTruthy();
    expect(left.getAttribute('aria-label')).toBe('This floor');
    expect(left.parentElement).toBe(container.querySelector('.pubws-main--floor'));
    const bookList = left.querySelector('.pubws-books') as HTMLElement;
    const advert = left.querySelector('.pubws-season') as HTMLElement;
    const ann = left.querySelector('[aria-label="Announcements"]') as HTMLElement;
    expect(bookList).toBeTruthy();
    expect(advert).toBeTruthy();
    expect(ann).toBeTruthy();
    expect(follows(bookList, advert)).toBe(true);
    expect(follows(advert, ann)).toBe(true);
    // The know block is gone: no "What is this market?" beside the market,
    // no second announcements line, no know column.
    expect(container.querySelector('[aria-label="What is this market"]')).toBeNull();
    expect(container.querySelector('.pubws-know-col')).toBeNull();
    expect(container.querySelectorAll('[aria-label="Announcements"]')).toHaveLength(1);
    // Two rails, the proposals first in the DOM (the phone order), the left
    // rail after; the leaders rail never came back.
    const rails = container.querySelectorAll('.pubws-main--floor .pubws-rail');
    expect(rails).toHaveLength(2);
    expect(rails[0].className).toContain('pubws-rail--right');
    expect(rails[0].getAttribute('aria-label')).toBe('Proposals');
    expect(rails[1].className).toContain('pubws-rail--left');
    expect(container.querySelector('[aria-label="Leaders"]')).toBeNull();
  });
});
