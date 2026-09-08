import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const caption = (container: HTMLElement) => container.querySelector('.pubws-instrument-label') as HTMLElement;
const metricChip = (container: HTMLElement) => container.querySelector('.pubws-chip--metric') as HTMLElement;
const dateChip = (container: HTMLElement) => container.querySelector('.pubws-chip--date') as HTMLElement;
const ask = (container: HTMLElement) => container.querySelector('.pubws-instrument-ask')?.textContent ?? '';

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

describe('the caption is two chips on one line', () => {
  test('the caption is two chips and no segmented row', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(metricChip(container)).toBeTruthy());
    // Both chips INSIDE the caption h2, which is a block child of
    // .pubws-center (the layout rule in "The question line").
    const cap = caption(container);
    expect(cap.tagName).toBe('H2');
    expect(cap.closest('.pubws-center')).toBeTruthy();
    // No flex wrapper between the heading and the column.
    expect(cap.parentElement?.className).toBe('pubws-instrument');
    expect(cap.contains(metricChip(container))).toBe(true);
    expect(cap.contains(dateChip(container))).toBe(true);
    // A middle dot between them, and the old rows are gone.
    expect(cap.textContent).toMatch(/net revenue\s*·\s*this month · settles 30 Sep/i);
    expect(container.querySelector('.pubws-seg')).toBeNull();
    expect(container.querySelector('.pubws-instrument-date')).toBeNull();
    expect(container.querySelector('[aria-label="Metrics"]')).toBeNull();
    expect(container.querySelector('[aria-label="The dates this metric is priced on"]')).toBeNull();
    // Each chip is a button that says whether its menu is open.
    expect(metricChip(container).tagName).toBe('BUTTON');
    expect(metricChip(container).getAttribute('aria-expanded')).toBe('false');
    expect(dateChip(container).tagName).toBe('BUTTON');
    expect(dateChip(container).getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.pubws-chip-menu')).toBeNull();
  });

  test('the metric menu lists metrics primary first and picking one keeps the date', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(metricChip(container)).toBeTruthy());
    // The floor opens on the primary: net revenue (order 0) on 30 Sep. Step
    // to this week first, so the date to keep is not the fallback.
    fireEvent.click(dateChip(container));
    fireEvent.click(screen.getByRole('option', { name: 'this week · 6 Sep' }));
    await waitFor(() => expect(ask(container)).toBe("What will be LookPilot's net revenue this week?"));

    fireEvent.click(metricChip(container));
    expect(metricChip(container).getAttribute('aria-expanded')).toBe('true');
    const menu = container.querySelector('.pubws-chip-menu') as HTMLElement;
    expect(menu.getAttribute('role')).toBe('listbox');
    const options = within(menu).getAllByRole('option');
    expect(options.map(o => o.textContent)).toEqual(['net revenue', 'Steam reviews']);
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    expect(options[1].getAttribute('aria-selected')).toBe('false');
    // No owner entry for a visitor.
    expect(within(menu).queryByRole('option', { name: /manage/i })).toBeNull();

    fireEvent.click(options[1]);
    // The pick closes the menu and keeps the date (cellOf).
    await waitFor(() => expect(ask(container)).toBe("What will be LookPilot's Steam reviews this week?"));
    expect(container.querySelector('.pubws-chip-menu')).toBeNull();
    expect(metricChip(container).getAttribute('aria-expanded')).toBe('false');
  });

  test('the date chip reads the clock and its settle day, and its menu lists dates soonest first', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(dateChip(container)).toBeTruthy());
    expect(dateChip(container).textContent).toBe('this month · settles 30 Sep');
    expect(dateChip(container).title).toMatch(/^settles /);
    fireEvent.click(dateChip(container));
    const menu = container.querySelector('.pubws-chip-menu') as HTMLElement;
    const options = within(menu).getAllByRole('option');
    // Labelled exactly as dateSegmentOf labels them, soonest first.
    expect(options.map(o => o.textContent)).toEqual(['this week · 6 Sep', 'this month · 30 Sep']);
    expect(options[1].getAttribute('aria-selected')).toBe('true');
    expect(within(menu).queryByRole('option', { name: /manage/i })).toBeNull();
    fireEvent.click(options[0]);
    await waitFor(() => expect(dateChip(container).textContent).toBe('this week · settles 6 Sep'));
    // Picking a date never changes the metric.
    expect(ask(container)).toBe("What will be LookPilot's net revenue this week?");
  });

  test('one metric means plain text, no menu; one date too, and the settle day stays', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(h.single() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(metricChip(container)).toBeTruthy());
    expect(metricChip(container).tagName).not.toBe('BUTTON');
    expect(metricChip(container).querySelector('svg')).toBeNull();
    expect(metricChip(container).textContent).toBe('net revenue');
    expect(dateChip(container).tagName).not.toBe('BUTTON');
    expect(dateChip(container).querySelector('svg')).toBeNull();
    expect(dateChip(container).textContent).toBe('this month · settles 30 Sep');
    fireEvent.click(metricChip(container));
    fireEvent.click(dateChip(container));
    expect(container.querySelector('.pubws-chip-menu')).toBeNull();
    expect(container.querySelector('[aria-expanded]')).toBeNull();
  });

  test('Escape and an outside click close the menu', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(metricChip(container)).toBeTruthy());
    fireEvent.click(metricChip(container));
    expect(container.querySelector('.pubws-chip-menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(container.querySelector('.pubws-chip-menu')).toBeNull());
    expect(metricChip(container).getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(dateChip(container));
    expect(container.querySelector('.pubws-chip-menu')).toBeTruthy();
    fireEvent.mouseDown(container.querySelector('.pubws-ws-name') as HTMLElement);
    await waitFor(() => expect(container.querySelector('.pubws-chip-menu')).toBeNull());
    expect(dateChip(container).getAttribute('aria-expanded')).toBe('false');
  });

  test('the cycle words in the question sentence are untouched', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(ask(container)).toBe("What will be LookPilot's net revenue this month?"));
    fireEvent.click(screen.getByRole('button', { name: /^Metric: / }));
    await waitFor(() => expect(ask(container)).toBe("What will be LookPilot's Steam reviews this month?"));
    fireEvent.click(screen.getByRole('button', { name: /^Date: / }));
    await waitFor(() => expect(ask(container)).toBe("What will be LookPilot's Steam reviews this week?"));
    // The chips follow the words.
    expect(metricChip(container).textContent).toBe('Steam reviews');
    expect(dateChip(container).textContent).toBe('this week · settles 6 Sep');
  });
});

describe('the stat row is two cells on hairlines', () => {
  test('the stat row prints the caption line above the value and the call stays amber', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-stats')).toBeTruthy());
    const now = container.querySelector('.pubws-stats .pubws-stat--now') as HTMLElement;
    const call = container.querySelector('.pubws-stats .pubws-stat--call') as HTMLElement;
    // The caption line FIRST, then the value under it, in both cells.
    const nowWhat = now.querySelector('.pubws-stat-what') as HTMLElement;
    const nowPrice = now.querySelector('.pubws-price') as HTMLElement;
    expect(nowWhat.compareDocumentPosition(nowPrice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nowWhat.textContent).toBe('now · read 35m ago');
    expect(nowPrice.textContent).toBe('$7,674');
    // The age keeps its exact instant on hover.
    const updated = now.querySelector('.pubws-updated') as HTMLElement;
    expect(updated.textContent).toBe('read 35m ago');
    expect(updated.title).toContain('2026');

    const callWhat = call.querySelector('.pubws-stat-what') as HTMLElement;
    const callPrice = call.querySelector('.pubws-price') as HTMLElement;
    expect(callWhat.compareDocumentPosition(callPrice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(callWhat.textContent).toMatch(/^market's call · for 30 Sep · settles in \S+$/);
    expect((call.querySelector('.pubws-settle-in') as HTMLElement).title).toMatch(/^settles /);
    expect(callPrice.textContent).toBe('$6,850');
    // The call is the amber cell: the class the stylesheet colours.
    expect(call.className).toContain('pubws-stat--call');
    // No right-aligned cell any more: both start on the same rhythm.
    expect(container.querySelectorAll('.pubws-stats .pubws-stat-block').length).toBe(2);
  });

  test('no reading yet: the caption line says "now" alone and the value says so', async () => {
    const ws = h.grid();
    ws.horizonHistories[1].points = [];
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-stats')).toBeTruthy());
    const now = container.querySelector('.pubws-stat--now') as HTMLElement;
    expect(now.querySelector('.pubws-stat-what')?.textContent).toBe('now');
    expect(now.querySelector('.pubws-updated')).toBeNull();
    expect(now.querySelector('.pubws-price')?.textContent).toBe('no reading yet');
  });
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
 * Three columns, and the standings under the verbs (docs/ui-conventions.md,
 * "The rails, and the standings under the verbs", revised 2026-09-06): a
 * narrow left column about THIS market (the definition, the season advert,
 * the announcements), the market in a wide centre column, the proposals
 * rail on the right. No count strip anywhere: the facts row is the only
 * place the counts appear. Under the facts row, the two three-row
 * standings footers, inside the centre column. Below 1120px the DOM order
 * is the stacking order: centre, the left column's content, the proposals,
 * then the remaining know block.
 */
describe('three columns, and the standings under the verbs', () => {
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
  const CSS = readFileSync(join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'style.css'), 'utf8');
  const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  beforeEach(() => {
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(floor() as never);
    vi.mocked(api.getLeaderboard).mockResolvedValue({ participants: traders(5) } as never);
    vi.mocked(api.getSeasons).mockResolvedValue({ seasons: [season] } as never);
  });

  test('the left column is about this market: definition, season advert, announcements, in that order', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-standings')).toBeTruthy());
    const left = container.querySelector('.pubws-main--floor .pubws-rail--left') as HTMLElement;
    expect(left).toBeTruthy();
    expect(left.getAttribute('aria-label')).toBe('About this market');
    expect(left.parentElement).toBe(container.querySelector('.pubws-main--floor'));
    const def = left.querySelector('[aria-label="What is this market"]') as HTMLElement;
    const advert = left.querySelector('.pubws-season') as HTMLElement;
    const ann = left.querySelector('[aria-label="Announcements"]') as HTMLElement;
    expect(def).toBeTruthy();
    expect(def.querySelector('.pubws-know-head')?.textContent).toContain('What is this market?');
    expect(def.querySelector('.pubws-know-what')?.textContent).toContain('Everything LookPilot earned');
    expect(advert).toBeTruthy();
    expect(ann).toBeTruthy();
    expect(ann.textContent).toContain('Refunds ran high');
    expect(follows(def, advert)).toBe(true);
    expect(follows(advert, ann)).toBe(true);
    // Moved, not copied: one definition and one announcements line on the page.
    expect(container.querySelectorAll('[aria-label="What is this market"]')).toHaveLength(1);
    expect(container.querySelectorAll('[aria-label="Announcements"]')).toHaveLength(1);
    // The remaining know block holds neither.
    const knowCol = container.querySelector('.pubws-know-col') as HTMLElement;
    expect(knowCol).toBeTruthy();
    expect(knowCol.querySelector('[aria-label="What is this market"]')).toBeNull();
    expect(knowCol.querySelector('[aria-label="Announcements"]')).toBeNull();
    expect(knowCol.querySelector('.pubws-season')).toBeNull();
    // Two rails, left and right, and the leaders rail never came back.
    const rails = container.querySelectorAll('.pubws-main--floor .pubws-rail');
    expect(rails).toHaveLength(2);
    expect(rails[0].className).toContain('pubws-rail--left');
    expect(rails[1].className).toContain('pubws-rail--right');
    expect(rails[1].getAttribute('aria-label')).toBe('Proposals');
    expect(container.querySelector('[aria-label="Leaders"]')).toBeNull();
  });

  test('no count strip anywhere: the facts row is the only place the counts appear', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-standings')).toBeTruthy());
    expect(container.querySelector('.pubws-count')).toBeNull();
    expect(container.querySelector('.pubws-count-line')).toBeNull();
    expect(container.querySelector('.pubws-count-go')).toBeNull();
    expect(container.textContent).not.toMatch(/traded on this market/);
    expect(container.querySelector('.pubws-facts')).toBeTruthy();
  });

  test('the standings sit under the facts row, inside the centre column', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-standings')).toBeTruthy());
    const bet = container.querySelector('.pubws-bet') as HTMLElement;
    const facts = container.querySelector('.pubws-facts') as HTMLElement;
    const standings = container.querySelector('.pubws-standings') as HTMLElement;
    expect(bet).toBeTruthy();
    expect(facts).toBeTruthy();
    expect(follows(bet, facts)).toBe(true);
    expect(follows(facts, standings)).toBe(true);
    expect(standings.closest('.pubws-center')).toBeTruthy();
    expect(standings.closest('.pubws-rail')).toBeNull();
    // Nothing between the facts row and the standings but the facts row's own block.
    expect(facts.compareDocumentPosition(standings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  test('the season block is an advert: three lines, no counts, no running sentence', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-season')).toBeTruthy());
    const advert = container.querySelector('.pubws-season') as HTMLElement;
    const hero = advert.querySelector('.pubws-season-hero') as HTMLElement;
    const terms = advert.querySelector('.pubws-season-terms') as HTMLElement;
    expect(hero.textContent).toBe('$1,000 in prizes');
    // 2026-09-04 10:35Z to 2026-10-01 00:00Z: 26 days.
    expect(terms.textContent).toBe('Season 0 ends in 26 days. Free to enter.');
    const go = within(advert).getByRole('link', { name: 'Enter the season' });
    expect(go.getAttribute('href')).toBe('/season');
    expect(follows(hero, terms)).toBe(true);
    expect(follows(terms, go)).toBe(true);
    // Three lines and nothing else.
    expect(advert.children).toHaveLength(3);
    expect(advert.textContent).not.toMatch(/traders/);
    expect(advert.textContent).not.toMatch(/traded/);
    expect(advert.textContent).not.toMatch(/ and /);
    // The control lives here and nowhere else on the floor.
    expect(container.querySelectorAll('a[href="/season"]')).toHaveLength(1);
  });

  test('no season, no season block', async () => {
    vi.mocked(api.getSeasons).mockResolvedValue({ seasons: [] } as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-rail--left')).toBeTruthy());
    expect(container.querySelector('.pubws-season')).toBeNull();
    expect(container.querySelector('a[href="/season"]')).toBeNull();
  });

  test('the phone order: centre, then the left column, then the proposals, then the know block', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-standings')).toBeTruthy());
    const center = container.querySelector('.pubws-center') as HTMLElement;
    const standings = container.querySelector('.pubws-standings') as HTMLElement;
    const left = container.querySelector('.pubws-rail--left') as HTMLElement;
    const rail = container.querySelector('.pubws-rail--right') as HTMLElement;
    const know = container.querySelector('.pubws-know-col') as HTMLElement;
    expect(center.contains(standings)).toBe(true);
    expect(follows(center, left)).toBe(true);
    expect(follows(left, rail)).toBe(true);
    expect(follows(rail, know)).toBe(true);
    // Each a grid item of the floor, so the DOM order IS the phone order and
    // the grid places them on desktop.
    const main = container.querySelector('.pubws-main--floor');
    expect(center.parentElement).toBe(main);
    expect(left.parentElement).toBe(main);
    expect(rail.parentElement).toBe(main);
    expect(know.parentElement).toBe(main);
    // What is left in the know block, in its order: the subject block (a
    // visitor sees no checklist).
    expect(know.querySelector('[aria-label="What is LookPilot"]')).toBeTruthy();
  });

  /** One pending proposal priced on the September revenue market, so the
   *  floor can be opened at `#proposal=job-1`. */
  const proposal = () => ({
    id: 'job-1',
    number: 1,
    title: '$80: rewrite the store page',
    description: 'A better store page.',
    askUsd: 80,
    status: 'pending' as const,
    proposedByName: 'Ada',
    createdAt: '2026-09-01T09:00:00.000Z',
    marketPairCount: 1,
    markets: [
      {
        metricName: 'LookPilot net revenue (USD)',
        targetDate: '2026-09',
        resolvesOn: '2026-10-01T00:00:00Z',
        approvedConsensus: 8_000,
        declinedConsensus: 6_850,
        delta: 1_150,
        approvedMarketId: 'm-approved',
        declinedMarketId: 'm-declined',
        approvedProbability: 0.5,
        approvedLiquidity: 200,
        declinedProbability: 0.5,
        declinedLiquidity: 200,
        rangeMin: 0,
        rangeMax: 50_000,
      },
    ],
  });
  const floorWithProposal = () => {
    const ws = floor() as ReturnType<typeof floor> & { proposals: unknown[] };
    ws.proposals = [proposal()];
    return ws;
  };

  /** The left column exists only in the plain market view (docs/ui-conventions.md,
   *  "The rails, and the standings under the verbs", Viktor 2026-09-06): a
   *  proposal's page is about the proposal and its two branches, not about
   *  the metric's definition. */
  test('with a proposal selected there is no left column: no definition, no season block, no announcements anywhere', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(floorWithProposal() as never);
    const { container } = renderFloor('/lookpilot#proposal=job-1');
    await waitFor(() => expect(container.querySelector('.pubws-pair-toggle, [aria-label="Proposals"]')).toBeTruthy());
    await waitFor(() => expect(container.querySelector('.pubws-question-task')).toBeTruthy());
    expect(container.querySelector('.pubws-rail--left')).toBeNull();
    expect(container.querySelector('.pubws-season')).toBeNull();
    expect(container.querySelector('a[href="/season"]')).toBeNull();
    expect(container.querySelector('[aria-label="What is this market"]')).toBeNull();
    expect(container.querySelector('[aria-label="Announcements"]')).toBeNull();
    expect(container.textContent).not.toMatch(/What is this market\?/);
    expect(container.textContent).not.toMatch(/Refunds ran high this week/);
    // The know block keeps only what it has now: the subject block.
    expect(container.querySelector('.pubws-know-col [aria-label="What is LookPilot"]')).toBeTruthy();
    // Two columns at every width: the floor root does not carry the context class.
    const main = container.querySelector('.pubws-main--floor') as HTMLElement;
    expect(main.classList.contains('pubws-main--context')).toBe(false);
    // The summary line under the question shows as before (its text node; the
    // "more" control follows it).
    expect(container.querySelector('.pubws-instrument-sum')?.childNodes[0].textContent).toBe(
      'Everything LookPilot earned in the last 30 days.',
    );
    // And the proposals rail is still there, beside the pair.
    expect(container.querySelector('.pubws-rail--right')).toBeTruthy();
  });

  test('the plain view carries the context class and keeps the summary line in the DOM (CSS hides it at width)', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-rail--left')).toBeTruthy());
    const main = container.querySelector('.pubws-main--floor') as HTMLElement;
    expect(main.classList.contains('pubws-main--context')).toBe(true);
    expect(container.querySelector('.pubws-instrument-sum')?.childNodes[0].textContent).toBe(
      'Everything LookPilot earned in the last 30 days.',
    );
  });

  test('the stylesheet hides the summary line under the context class from 1500px only', () => {
    // The definition is on screen once, never twice: when the left column
    // carries "What is this market?" (three columns, >=1500px) the summary
    // line under the question is hidden.
    const wide = CSS.match(/@media \(min-width: 1500px\) \{([\s\S]*?)\n\}/);
    expect(wide).toBeTruthy();
    expect(wide![1]).toMatch(/\.pubws-main--context \.pubws-instrument-sum \{[^}]*display:\s*none/);
    // At the two-column widths and on the phone the left column's content
    // stacks under the market, so the summary line shows.
    const mid = CSS.match(/@media \(min-width: 1120px\) \{([\s\S]*?)\n\}/);
    expect(mid![1]).not.toMatch(/pubws-instrument-sum/);
    const narrow = CSS.match(/@media \(max-width: 1119\.98px\) \{([\s\S]*?)\n\}/);
    expect(narrow![1]).not.toMatch(/pubws-instrument-sum/);
    // And nothing outside the 1500px block hides it either.
    const outside = CSS.replace(wide![0], '');
    expect(outside).not.toMatch(/\.pubws-instrument-sum[^{]*\{[^}]*display:\s*none/);
  });

  test('the loading ghosts draw three columns', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockReturnValue(new Promise(() => {}) as never);
    const { container } = renderFloor();
    const ghost = await waitFor(() => container.querySelector('.pubws-main--ghost') as HTMLElement);
    const asides = ghost.querySelectorAll('aside');
    expect(asides).toHaveLength(2);
    expect(asides[0].className).toContain('pubws-rail--left');
    expect(asides[1].className).toContain('pubws-rail--right');
    expect(ghost.querySelector('.pubws-center')).toBeTruthy();
    // Same DOM order as the loaded floor, so nothing moves when it lands.
    expect(follows(ghost.querySelector('.pubws-center')!, asides[0])).toBe(true);
    expect(follows(asides[0], asides[1])).toBe(true);
    // The standings' ghost sits in the market column, under the verbs.
    expect(ghost.querySelector('.pubws-center .pubws-ghost-standings')).toBeTruthy();
    expect(ghost.querySelector('.pubws-ghost-count')).toBeNull();
  });

  test('the stylesheet keeps the definition head and its Edit on one row in the left column', () => {
    // The Edit pill wrapped under the label in the narrow column (owner
    // screenshot 2026-09-07): the head is a row, label left, control right.
    const rule = CSS.match(/\.pubws-rail--left \.pubws-know-head \{([^}]*)\}/);
    expect(rule).toBeTruthy();
    expect(rule![1]).toMatch(/display:\s*flex/);
    expect(rule![1]).toMatch(/justify-content:\s*space-between/);
    expect(rule![1]).toMatch(/flex-wrap:\s*nowrap/);
  });

  test('the stylesheet lays the floor out as three columns only from 1500px, two from 1120px, with no count strip left', () => {
    expect(CSS).not.toMatch(/pubws-count/);
    // From 1500px: three tracks, the left column, the market at up to 960px, the rail at 320px.
    const wide = CSS.match(/@media \(min-width: 1500px\) \{([\s\S]*?)\n\}/);
    expect(wide).toBeTruthy();
    // ... and ONLY in the plain market view (the root's context class): a
    // selected proposal keeps the two tracks, centred, at every width, or the
    // pair sits beside an empty 280px track (preview, 2026-09-06).
    const grid = wide![1].match(/\.pubws-main--floor\.pubws-main--context \{([^}]*)\}/);
    expect(grid).toBeTruthy();
    expect(grid![1]).toMatch(/grid-template-columns:\s*\d+px minmax\(0, 960px\) 320px;/);
    expect(wide![1]).not.toMatch(/\.pubws-main\.pubws-main--floor \{/);
    expect(wide![1]).toMatch(/\.pubws-main--context \.pubws-rail--left \{[^}]*grid-column:\s*1/);
    expect(wide![1]).toMatch(/\.pubws-main--context \.pubws-center \{[^}]*grid-column:\s*2/);
    expect(wide![1]).toMatch(/\.pubws-main--context \.pubws-rail--right \{[^}]*grid-column:\s*3/);
    expect(wide![1]).toMatch(
      /\.pubws-main--context \.pubws-rail--left \{[^}]*border-right:\s*1px solid var\(--border-color\)/,
    );
    // From 1120px: two tracks, the market at up to 720px and the rail, the
    // left column's context stacked under the market (a 1280px laptop
    // squeezed the centre to 509px with three tracks, 2026-09-06).
    const mid = CSS.match(/@media \(min-width: 1120px\) \{([\s\S]*?)\n\}/);
    expect(mid).toBeTruthy();
    const midGrid = mid![1].match(/\.pubws-main\.pubws-main--floor \{([^}]*)\}/);
    expect(midGrid![1]).toMatch(/grid-template-columns:\s*minmax\(0, 720px\) 320px;/);
    expect(midGrid![1]).toMatch(/justify-content:\s*center/);
    expect(mid![1]).toMatch(/\.pubws-rail--left \{[^}]*grid-column:\s*1;\s*grid-row:\s*2/);
    expect(mid![1]).toMatch(/\.pubws-main--floor \.pubws-know-col \{[^}]*grid-row:\s*3/);
    expect(mid![1]).toMatch(/\.pubws-rail--right \{[^}]*border-left:\s*1px solid var\(--border-color\)/);
    // The standings: side by side on desktop, stacked on a phone.
    expect(mid![1]).toMatch(/\.pubws-standings-pair \{[^}]*grid-template-columns:\s*1fr 1fr/);
    const narrow = CSS.match(/@media \(max-width: 1119\.98px\) \{([\s\S]*?)\n\}/);
    expect(narrow![1]).toMatch(/\.pubws-standings-pair \{[^}]*grid-template-columns:\s*1fr;/);
    // The season advert is set left, in the mono numeral style.
    expect(CSS).toMatch(/\.pubws-season \{[^}]*text-align:\s*left/);
    expect(CSS).toMatch(/\.pubws-season-hero \{[^}]*JetBrains Mono/);
  });
});

/**
 * The definition is on screen once at every width (docs/ui-conventions.md,
 * "The price and the chart", critics' round 2026-09-08): below 1500px the
 * summary line carries a "more" that expands the full definition in place,
 * and the "What is this market?" block is not shown there. From 1500px the
 * left column carries it and the summary line is hidden, as before.
 */
describe('the definition once at every width', () => {
  const CSS = readFileSync(join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'style.css'), 'utf8');

  test('"more" under the summary expands the full definition in place, left-aligned, and "less" folds it', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-instrument-sum')).toBeTruthy());
    expect(container.querySelector('.pubws-instrument-more')).toBeNull();
    const sum = container.querySelector('.pubws-instrument-sum') as HTMLElement;
    const more = within(sum).getByRole('button', { name: 'more' });
    fireEvent.click(more);
    await waitFor(() => expect(container.querySelector('.pubws-instrument-more')).toBeTruthy());
    const full = container.querySelector('.pubws-instrument-more') as HTMLElement;
    // The same words as the definition, the whole of it.
    expect(full.textContent).toContain('Everything LookPilot earned in the last 30 days. Net of refunds.');
    // Directly under the summary line, before the numbers.
    expect(sum.nextElementSibling).toBe(full);
    // A visitor gets no Edit control in it.
    expect(within(full).queryByRole('button', { name: 'Edit' })).toBeNull();
    fireEvent.click(within(sum).getByRole('button', { name: 'less' }));
    await waitFor(() => expect(container.querySelector('.pubws-instrument-more')).toBeNull());
  });

  test('a one-sentence definition offers no "more": there is nothing more to show', async () => {
    const ws = h.grid();
    for (const hh of ws.horizonHistories) hh.description = 'Everything LookPilot earned in the last 30 days.';
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-instrument-sum')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'more' })).toBeNull();
  });

  test('the stylesheet: the know block is hidden below 1500px, the expander hidden from 1500px in the plain view', () => {
    const narrow = CSS.match(/@media \(max-width: 1499\.98px\) \{([\s\S]*?)\n\}/);
    expect(narrow).toBeTruthy();
    expect(narrow![1]).toMatch(/\.pubws-rail--left \.pubws-know \{[^}]*display:\s*none/);
    const wide = CSS.match(/@media \(min-width: 1500px\) \{([\s\S]*?)\n\}/);
    expect(wide![1]).toMatch(/\.pubws-main--context \.pubws-instrument-more \{[^}]*display:\s*none/);
    // The expander is a left-aligned block.
    expect(CSS).toMatch(/\.pubws-instrument-more \{[^}]*text-align:\s*left/);
  });
});

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
 * Each bet verb says what a stake pays (docs/ui-conventions.md, "Each bet
 * verb says what a stake pays"): the example at the ticket's default stake,
 * from the same AMM preview the ticket uses; the liquidity cap lives in the
 * ticket.
 */
describe('each bet verb says what a stake pays', () => {
  test("the example under each verb, from the ticket's own preview at its default stake", async () => {
    const { previewTrade } = await import('../../lib/amm');
    const { DEFAULT_STAKE } = await import('../../components/TradeTicket');
    const ws = h.grid();
    ws.joinAs = 'trader';
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    renderFloor();
    const higher = await screen.findByRole('button', { name: /Bet Higher/ });
    const lower = screen.getByRole('button', { name: /Bet Lower/ });
    const up = Math.round(previewTrade(0.5, 200, 'higher', DEFAULT_STAKE).shares);
    const down = Math.round(previewTrade(0.5, 200, 'lower', DEFAULT_STAKE).shares);
    expect(higher.querySelector('.pubws-bet-eg')?.textContent).toBe(`${DEFAULT_STAKE} cr pays ${up} cr at $50,000`);
    expect(lower.querySelector('.pubws-bet-eg')?.textContent).toBe(`${DEFAULT_STAKE} cr pays ${down} cr at $0`);
    // The cap is no longer on the verbs.
    expect(higher.textContent).not.toContain('up to');
    expect(lower.textContent).not.toContain('up to');
  });

  test('the cap is in the ticket', async () => {
    const ws = h.grid();
    ws.joinAs = 'trader';
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    const { container } = renderFloor();
    fireEvent.click(await screen.findByRole('button', { name: /Bet Higher/ }));
    await waitFor(() => expect(container.querySelector('.pubws-ticket-inline')).toBeTruthy());
    const ticket = container.querySelector('.pubws-ticket-inline') as HTMLElement;
    expect(ticket.textContent).toMatch(/up to \S+ cr/);
  });
});
