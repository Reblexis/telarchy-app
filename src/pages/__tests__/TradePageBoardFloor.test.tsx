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

function renderFloor() {
  return render(
    <MemoryRouter initialEntries={['/lookpilot']}>
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

  test('the menu words in the question sentence pick, and the chips follow', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(ask(container)).toBe("What will be LookPilot's net revenue this month?"));
    // Menu words (2026-09-04): the word opens a list, the pick selects.
    fireEvent.click(screen.getByRole('button', { name: /^Metric: / }));
    fireEvent.click(
      within(await screen.findByRole('listbox', { name: 'Metric' })).getByRole('option', { name: 'Steam reviews' }),
    );
    await waitFor(() => expect(ask(container)).toBe("What will be LookPilot's Steam reviews this month?"));
    fireEvent.click(screen.getByRole('button', { name: /^Date: / }));
    fireEvent.click(
      within(await screen.findByRole('listbox', { name: 'Date' })).getByRole('option', { name: 'this week' }),
    );
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
    expect(callWhat.textContent).toMatch(/^the market expects · for 30 Sep · settles in \S+$/);
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
