import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../lib/api', () => ({
  api: {
    getHome: vi.fn(),
    getPublicWorkspaces: vi.fn(),
    getMarketplaceWorkspace: vi.fn(),
    getSeasons: vi.fn(),
    joinWaitlist: vi.fn(),
    createWorkspace: vi.fn(),
    listWorkspaces: vi.fn(),
  },
}));
let signedIn = false;
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: signedIn ? { id: 'u' } : null, loading: false }) }));
// The top bar drags in the whole floor page; the marketplace board is what
// this spec is about. The stand-in keeps the one prop this page drives.
vi.mock('../TradePage', () => ({
  TopBar: ({ busy }: { busy?: boolean }) => <nav data-testid="topbar" data-busy={String(!!busy)} />,
}));

// The featured card draws the floor's live board; the board itself has its
// own spec (components/live/__tests__/SnakeLive.test.tsx).
vi.mock('../../components/live/SnakeLive', () => ({
  SnakeLive: ({ slug, replay }: { slug: string; replay?: boolean }) => (
    <div data-testid="snake-live" data-slug={slug} data-replay={String(replay)} />
  ),
}));

// Labels and the card's hero come from lib/floor-horizons, the same model the
// floor page uses, so this spec asserts the real strings: a card and the floor
// it links to must never name the number differently.

import { api } from '../../lib/api';
import { FloorsPage, pickFeatured } from '../FloorsPage';

const listing = {
  workspaceId: 'ws1',
  slug: 'lookpilot',
  name: 'LookPilot',
  description: 'A real product, run in the open.',
  proposalStats: { total: 3, approved: 0, declined: 1, declinedSpam: 0, withdrawn: 0, pending: 2 },
};

const payload = {
  participantCount: 14,
  tradersThisWeek: 9,
  tradesThisWeek: 108,
  markets: [
    {
      marketId: 'm-1',
      metricName: 'LookPilot revenue (monthly, USD)',
      consensus: 77315.69,
      targetDate: '2026-08',
      pool: 1000,
    },
  ],
  // Shaped like the real payload: the inline price replay names its market.
  marketHistory: [
    { at: '2026-08-11T06:41:39.275Z', consensus: 73600 },
    { at: '2026-08-13T17:01:26.679Z', consensus: 78570.63 },
  ],
  marketHistoryMarketId: 'm-1',
};

const renderPage = () =>
  render(
    <MemoryRouter>
      <FloorsPage />
      {/* Where a navigate() landed, so the create flow's destination is
          assertable without mounting the floor. */}
      <LocationProbe />
    </MemoryRouter>,
  );

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

beforeEach(() => {
  signedIn = false;
  document.head.innerHTML = '';
  vi.clearAllMocks();
  vi.mocked(api.listWorkspaces).mockResolvedValue([] as never);
  vi.mocked(api.getPublicWorkspaces).mockResolvedValue([listing] as never);
  vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(payload as never);
  vi.mocked(api.getSeasons).mockResolvedValue({ seasons: [season] } as never);
  // The page makes ONE request (docs/ui-conventions.md, "While a page
  // loads"): the home payload carries the seasons and every public listing
  // with its floor payload. The stand-in composes it from the three older
  // mocks so each case below keeps varying the one thing it is about.
  vi.mocked(api.getHome).mockImplementation(async () => {
    const list = (await api.getPublicWorkspaces()) as Array<typeof listing>;
    const listings = await Promise.all(
      list.map(async w => ({
        ...w,
        floor: await (api.getMarketplaceWorkspace(w.slug || w.workspaceId) as Promise<unknown>).catch(() => null),
      })),
    );
    const { seasons } = await api.getSeasons();
    return { at: new Date().toISOString(), seasons, listings } as never;
  });
});

/** A draft season, the state the home page has to sell hardest. */
const season = {
  id: 's0',
  name: 'Season 0',
  status: 'draft',
  startsAt: '2026-08-22T00:00:00.000Z',
  endsAt: '2026-10-16T00:00:00.000Z',
  settledAt: null,
  poolUsd: 1000,
  ladder: [{ place: 1, prizeUsd: 500 }],
  rulesUrl: '/legal/season-0',
};

describe('marketplace', () => {
  test('states the mechanism once, in plain words', async () => {
    // Rewritten 2026-08-28 with self-serve creation: the old "one number
    // someone is trying to move" was no longer true of a grid anyone can put
    // their own numbers on, and "one number" was never the pitch (owner rule
    // 2026-08-27). The duties the lead carries now: real numbers priced by
    // betting, being right pays, and BOTH sides addressed, the trader and
    // the person with numbers to put up. Dual scope stays first-class: "your
    // own goal" sits beside the company's revenue (AGENTS.md).
    // Rewritten again 2026-09-04 (Viktor picked hero B on the design
    // canvas, notes/decisions/ui-conventions.md): the headline says what the
    // cells under it are and what you do here in two verbs; the lead names
    // the metrics and addresses both sides, human or AI.
    // And again the same day: an approved proposal on the Telarchy floor
    // (Odoacre, "Replace the company slogan with plainer, less metaphorical
    // language") argued against "real numbers", "priced" and "bet", and
    // Viktor picked F: forecast, not bet.
    // Rewritten 2026-09-11 (Viktor): the subject is the decision, not the
    // metric, and the owner is not necessarily a company
    // (notes/decisions/ui-conventions.md).
    renderPage();
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: "Forecast a decision's impact before it's made. Get paid when you're right.",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\bbet\b/i)).toBeNull();
    expect(screen.queryByText(/priced/i)).toBeNull();
    expect(screen.queryByText(/company's metrics/i)).toBeNull();
    expect(screen.getByText(/updated by the people running them/i)).toBeInTheDocument();
    expect(screen.getByText(/Forecast how each open decision moves them, free, human or AI/)).toBeInTheDocument();
    expect(screen.getAllByText(/human or AI/)).toHaveLength(1);
    expect(document.querySelector('.mkt-lead')?.textContent).toMatch(
      /put your own decision up and read the forecast before you act/i,
    );
    // The owner's door is in the first paragraph: "put your own decision
    // up" links to /owners (Viktor, 2026-09-11: the customers are the
    // owners, the forecasters are the contractors).
    expect(screen.getByRole('link', { name: /put your own decision up/i })).toHaveAttribute('href', '/owners');
    expect(screen.queryByText(/one number/i)).toBeNull();
  });

  test('the season has a door here, because this is where recruiting lands', async () => {
    // The home page said nothing about the season until 2026-08-21, so every
    // post pointing at telarchy.com arrived at a page whose only calls to
    // action were owner-facing and a trader had nowhere to go.
    renderPage();
    expect(await screen.findByText('Season 0')).toBeInTheDocument();
    // The prize sentence keeps its operative words (the contest rules need
    // them on the page) in one line on hairlines.
    // The pool is split in proportion to profit (docs/seasons.md, amended
    // 2026-08-28); "whose profit grows the most" described the old ladder
    // (owner report 2026-09-04).
    expect(screen.getByText(/\$1,000 in real money/)).toHaveTextContent(
      'in real money, split among the traders in proportion to their profit. Free to enter, no purchase, no stake.',
    );
    const cta = screen.getByRole('link', { name: 'Enter the season' });
    expect(cta).toHaveAttribute('href', '/season');
  });

  test('no season means no strip, rather than an empty one', async () => {
    vi.mocked(api.getSeasons).mockResolvedValue({ seasons: [] } as never);
    const { container } = renderPage();
    await screen.findByText('LookPilot');
    expect(container.querySelector('.mkt-season')).toBeNull();
  });

  test('carries no page title, because the claim is the opening', async () => {
    // "Marketplace" labelled the furniture. A first-time visitor landing on
    // telarchy.com needs to know what any of this is, not what the page is
    // called (owner direction 2026-08-20).
    renderPage();
    expect(screen.queryByText(/^Marketplace$/)).toBeNull();
  });

  test('never says "floor" to a visitor', async () => {
    const { container } = renderPage();
    await screen.findByText('LookPilot');
    expect(container.textContent).not.toMatch(/floor/i);
  });

  test('a listing shows what it is, its number, and its market', async () => {
    const { container } = renderPage();
    await screen.findByText('LookPilot');
    await waitFor(() => expect(screen.getByText('$77,316')).toBeInTheDocument());
    expect(screen.getByText('A real product, run in the open.')).toBeInTheDocument();
    // The metric name loses its parenthetical unit tail.
    expect(screen.getByText('LookPilot revenue')).toBeInTheDocument();
    // The market itself: a spark drawn from the real trade history.
    expect(container.querySelector('.mkt-spark')).toBeTruthy();
    expect(container.querySelector('.mkt-spark-dot')).toBeTruthy();
  });

  test('the footer leads with settlement, then the activity behind it', async () => {
    renderPage();
    // The caption's short form; the full day is the hover title.
    expect(await screen.findByText('settles 31 Aug')).toHaveAttribute('title', 'settles 31 August 2026');
    const row = await screen.findByLabelText('Market facts');
    expect(row).toHaveTextContent(/^9\s*1,000\s*108\s*2$/);
  });

  test('listing your own number is a cell of the grid, not a footnote', async () => {
    const { container } = renderPage();
    const tile = await screen.findByText('See what a decision does to your numbers before you say yes.');
    const cell = tile.closest('.mkt-cell');
    expect(cell).toHaveClass('mkt-cell--new');
    expect(cell?.parentElement).toHaveClass('mkt-board');
    // Cell B (docs/ui-conventions.md, "The marketplace"): a mono label, the
    // owner's sentence, the mechanism in one line, then the door.
    const label = cell?.querySelector('.mkt-new-label');
    expect(label).toHaveTextContent('Your own numbers');
    expect(cell?.querySelector('.mkt-new-title')).toHaveTextContent(
      'See what a decision does to your numbers before you say yes.',
    );
    expect(cell?.querySelector('.mkt-new-sub')).toHaveTextContent(
      'List your metrics. Traders, people or bots, price each proposal against them, and you decide on the price.',
    );
    // Label, sentence, line, door: in that order.
    const kids = [...(cell?.children ?? [])];
    const order = ['.mkt-new-label', '.mkt-new-title', '.mkt-new-sub', '.mkt-new-cta'].map(sel =>
      kids.findIndex(k => k.matches(sel)),
    );
    expect(order.every(n => n >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(container.querySelector('.mkt-card')).toBeNull();
  });

  test('"Create your own" signed in opens the create dialog and lands on the new floor', async () => {
    // The email field of 2026-08-26 is superseded (owner ask 2026-08-28):
    // creation is self-serve, so the tile's promise is a floor in a minute,
    // not contact within days.
    signedIn = true;
    vi.mocked(api.createWorkspace).mockResolvedValue({
      id: 'ws-new',
      ownerHandle: 'viktor',
      slug: 'meridian',
    } as never);
    renderPage();
    await screen.findByText('See what a decision does to your numbers before you say yes.');
    fireEvent.click(screen.getByRole('button', { name: 'Create your own' }));
    fireEvent.change(screen.getByLabelText('Floor name'), { target: { value: 'Meridian' } });
    fireEvent.click(screen.getByText('Open my market'));
    await waitFor(() => expect(api.createWorkspace).toHaveBeenCalledWith({ name: 'Meridian' }));
    // The dialog said where it goes; the router got sent there.
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/marketplace/ws-new'));
  });

  test('a not-yet-public floor of yours is IN the grid, first, badged, linked by id', async () => {
    // Owner decision 2026-08-28: everything public by default, and what is
    // not public yet still shows in the grid to its own owner rather than in
    // a private side list.
    signedIn = true;
    vi.mocked(api.listWorkspaces).mockResolvedValue([
      { id: 'ws-mine', name: 'Meridian', visibility: 'unlisted' },
      { id: 'ws1', name: 'LookPilot', visibility: 'public' },
    ] as never);
    renderPage();
    const name = await screen.findByText('Meridian');
    const card = name.closest('a');
    expect(card?.getAttribute('href')).toBe('/marketplace/ws-mine');
    expect(card?.className).toContain('mkt-cell');
    expect(screen.getByText('Yours · not public yet')).toBeTruthy();
    // First among the others: the badge card precedes the public one.
    const grid = card?.parentElement;
    expect(grid?.firstElementChild).toBe(card);
    // The caller's PUBLIC floor is not duplicated: one LookPilot card only.
    expect(screen.getAllByText('LookPilot')).toHaveLength(1);
  });

  test('"Create your own" signed out is the door to signing up', async () => {
    signedIn = false;
    vi.mocked(api.createWorkspace).mockClear();
    renderPage();
    await screen.findByText('See what a decision does to your numbers before you say yes.');
    const cta = screen.getByText('Create your own');
    expect(cta.closest('a')?.getAttribute('href')).toBe('/signup');
    expect(api.createWorkspace).not.toHaveBeenCalled();
  });

  test('the tile never names the setup conversation while it is not the door', async () => {
    renderPage();
    const card = (await screen.findByText('See what a decision does to your numbers before you say yes.')).closest(
      '.mkt-cell--new',
    );
    expect(card?.textContent).not.toMatch(/otto/i);
  });

  test('it says a floor is not only for companies', async () => {
    // Dual scope is load-bearing (AGENTS.md): this tile is where a visitor
    // decides which side of the market they are on, and a personal goal is as
    // welcome as a company. The label says whose numbers ("Your own"), the
    // sentence speaks to a person deciding, and neither names a company.
    renderPage();
    const card = (await screen.findByText('See what a decision does to your numbers before you say yes.')).closest(
      '.mkt-cell--new',
    );
    expect(card?.querySelector('.mkt-new-label')).toHaveTextContent(/your own numbers/i);
    expect(card?.textContent).not.toMatch(/compan/i);
  });

  test('the listing cell carries the owner sentence and label: the approval is a price, people or bots', async () => {
    // The approval is priced and the proposer can be a person or a bot, said
    // once and plainly (AGENTS.md, revised 2026-09-04).
    renderPage();
    const card = (await screen.findByText('See what a decision does to your numbers before you say yes.')).closest(
      '.mkt-cell--new',
    );
    expect(card?.textContent).toMatch(/you decide on the price/);
    expect(card?.textContent).toMatch(/people or bots/);
    expect(card?.querySelector('.mkt-new-label')).toHaveTextContent('Your own numbers');
  });

  test('the grid still renders its listing tile when nothing is listed yet', async () => {
    vi.mocked(api.getPublicWorkspaces).mockResolvedValue([] as never);
    renderPage();
    expect(await screen.findByText('See what a decision does to your numbers before you say yes.')).toBeInTheDocument();
  });
});

describe('the market spark', () => {
  const yValuesOf = (container: HTMLElement): number[] => {
    const d = container.querySelector('.mkt-spark-line')?.getAttribute('d') ?? '';
    return [...d.matchAll(/[ML]\s*[\d.]+,([\d.]+)/g)].map(m => Number(m[1]));
  };

  test('one wild print does not flatten every real move (robust domain)', async () => {
    // 73,600 -> 78,570 is the real story; the 150,000 print is a market
    // briefly taken to the range ceiling and must not squash it.
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue({
      ...payload,
      markets: [{ marketId: 'm-1', metricName: 'revenue (USD)', consensus: 78570, targetDate: '2026-08' }],
      marketHistory: [
        { at: '2026-08-11T06:00:00Z', consensus: 73600 },
        { at: '2026-08-11T12:00:00Z', consensus: 150000 },
        { at: '2026-08-12T06:00:00Z', consensus: 74500 },
        { at: '2026-08-12T12:00:00Z', consensus: 76000 },
        { at: '2026-08-13T06:00:00Z', consensus: 77300 },
        { at: '2026-08-13T17:00:00Z', consensus: 78570 },
      ],
    } as never);
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelector('.mkt-spark-line')).toBeTruthy());
    const ys = yValuesOf(container);
    const spread = Math.max(...ys) - Math.min(...ys);
    // Without the robust domain the 150k print eats the whole box and the
    // rest of the series collapses into a few pixels at the bottom.
    expect(spread).toBeGreaterThan(20);
  });

  test('an untraded market draws one flat line, not an empty card', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue({
      ...payload,
      markets: [{ marketId: 'm-1', metricName: 'traders', consensus: 25, targetDate: '2026-08' }],
      marketHistory: [],
    } as never);
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelector('.mkt-spark-line')).toBeTruthy());
    const ys = yValuesOf(container);
    expect(ys.length).toBeGreaterThan(0);
    expect(Math.max(...ys) - Math.min(...ys)).toBe(0);
  });
});

describe('loading', () => {
  test('the board is drawn at once as ghost cells in the real geometry, never a dot', async () => {
    let release: (v: unknown) => void = () => {};
    vi.mocked(api.getHome).mockReturnValue(
      new Promise(r => {
        release = r;
      }) as never,
    );
    const { container } = renderPage();
    // Grey bars in the shape of what is coming (docs/ui-conventions.md,
    // "While a page loads"); the old rippling dot is gone from every page.
    const ghosts = container.querySelectorAll('.mkt-board .mkt-ghost');
    expect(ghosts.length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector('[role="status"][aria-label="Loading"]')).toBeTruthy();
    expect(container.querySelector('.pubws-loading-dot')).toBeNull();
    expect(container.querySelector('.mkt-cell')).toBeNull();
    // The top bar runs its progress hairline while anything is pending.
    expect(screen.getByTestId('topbar')).toHaveAttribute('data-busy', 'true');
    release({ at: new Date().toISOString(), seasons: [season], listings: [{ ...listing, floor: payload }] });
    await screen.findByText('LookPilot');
    expect(container.querySelector('.mkt-ghost')).toBeNull();
    expect(screen.getByTestId('topbar')).toHaveAttribute('data-busy', 'false');
  });

  test('one request for the whole page, never one per listing', async () => {
    // A direct payload here, not the composing stand-in, so the three older
    // endpoints can be shown untouched.
    vi.mocked(api.getHome).mockResolvedValue({
      at: new Date().toISOString(),
      seasons: [season],
      listings: [{ ...listing, floor: payload }],
    } as never);
    renderPage();
    await screen.findByText('LookPilot');
    await screen.findByText('$77,316');
    expect(api.getHome).toHaveBeenCalledTimes(1);
    expect(api.getMarketplaceWorkspace).not.toHaveBeenCalled();
    expect(api.getSeasons).not.toHaveBeenCalled();
    expect(api.getPublicWorkspaces).not.toHaveBeenCalled();
  });

  test('cells rise in, in order, once the payload lands', async () => {
    vi.mocked(api.getPublicWorkspaces).mockResolvedValue([
      { ...listing, workspaceId: 'a', slug: 'a', name: 'Alpha' },
      { ...listing, workspaceId: 'b', slug: 'b', name: 'Beta' },
    ] as never);
    renderPage();
    const alpha = (await screen.findByText('Alpha')).closest('.mkt-cell') as HTMLElement;
    const beta = (await screen.findByText('Beta')).closest('.mkt-cell') as HTMLElement;
    expect(alpha).toHaveClass('pubws-rise');
    expect(beta).toHaveClass('pubws-rise');
    expect(alpha.style.animationDelay).toBe('0ms');
    expect(beta.style.animationDelay).toBe('60ms');
  });

  test('a listing whose floor payload failed on the server keeps its name and a ghost in the chart slot', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockRejectedValue(new Error('boom'));
    const { container } = renderPage();
    await screen.findByText('LookPilot');
    expect(container.querySelector('.mkt-cell .mkt-spark-ghost')).toBeTruthy();
    expect(container.querySelector('.pubws-loading-dot')).toBeNull();
    // Only the proposal count is known from the listing itself.
    const row = screen.getByLabelText('Market facts');
    expect(row.querySelectorAll('svg').length).toBe(1);
  });

  test('an own not-yet-public floor fetches on its own and shows a ghost spark until it lands', async () => {
    signedIn = true;
    vi.mocked(api.listWorkspaces).mockResolvedValue([{ id: 'ws-mine', name: 'Mine', visibility: 'unlisted' }] as never);
    let release: (v: unknown) => void = () => {};
    vi.mocked(api.getMarketplaceWorkspace).mockReturnValue(
      new Promise(r => {
        release = r;
      }) as never,
    );
    renderPage();
    const mine = (await screen.findByText('Mine')).closest('.mkt-cell') as HTMLElement;
    expect(mine.querySelector('.mkt-spark-ghost')).toBeTruthy();
    release(payload);
    await waitFor(() => expect(mine.querySelector('.mkt-spark')).toBeTruthy());
    expect(mine.querySelector('.mkt-spark-ghost')).toBeNull();
  });
});

describe('the payload in the HTML', () => {
  // Inserted as markup, the way the server plants it: jsdom would try to
  // RUN a script element created through the DOM, JSON or not.
  function plant(body: unknown) {
    const json = JSON.stringify(body).replace(/<\//g, '<\\/');
    document.head.insertAdjacentHTML(
      'beforeend',
      `<script id="telarchy-home" type="application/json">${json}</script>`,
    );
  }

  test('a full document load paints the board from the inlined payload without a request', async () => {
    plant({ at: new Date().toISOString(), seasons: [season], listings: [{ ...listing, floor: payload }] });
    const { container } = renderPage();
    // Synchronously, on the first render: no ghosts, no request.
    expect(screen.getByText('LookPilot')).toBeInTheDocument();
    expect(screen.getByText('$77,316')).toBeInTheDocument();
    expect(screen.getByText('Season 0')).toBeInTheDocument();
    expect(container.querySelector('.mkt-ghost')).toBeNull();
    expect(api.getHome).not.toHaveBeenCalled();
  });

  test('the inlined payload is read once: the element is gone after mount', async () => {
    plant({ at: new Date().toISOString(), seasons: [], listings: [{ ...listing, floor: payload }] });
    renderPage();
    await waitFor(() => expect(document.getElementById('telarchy-home')).toBeNull());
  });

  test('a stale inlined payload (a restored tab) is ignored and the page fetches', async () => {
    plant({ at: new Date(Date.now() - 10 * 60_000).toISOString(), seasons: [], listings: [] });
    renderPage();
    await screen.findByText('LookPilot');
    expect(api.getHome).toHaveBeenCalledTimes(1);
  });
});

describe('the facts row', () => {
  test("is icons and bare numbers with the meaning on hover, the market page's row", async () => {
    renderPage();
    const row = await screen.findByLabelText('Market facts');
    await waitFor(() => expect(row.querySelectorAll('svg').length).toBe(4));
    expect(screen.getByTitle(/9 traders this week/)).toHaveTextContent('9');
    expect(screen.getByTitle(/1,000 credits in the pools/)).toHaveTextContent('1,000');
    expect(screen.getByTitle(/108 trades this week/)).toHaveTextContent('108');
    expect(screen.getByTitle(/2 proposals priced now/)).toHaveTextContent('2');
    expect(row.textContent).not.toMatch(/participants|trades|proposals|liquidity/);
  });

  // Owner report 2026-09-14: Snake's card said 26 people when 16 had traded
  // it, because the count was the members of its permission groups.
  test('the people fact counts who traded this week, never the members', async () => {
    renderPage();
    const row = await screen.findByLabelText('Market facts');
    await waitFor(() => expect(row.querySelectorAll('svg').length).toBe(4));
    expect(screen.queryByTitle(/participant/)).toBeNull();
    expect(row.textContent).not.toMatch(/\b14\b/);
    expect(screen.getByTitle('9 traders this week')).toHaveTextContent('9');
  });

  test('one trader is singular', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue({ ...payload, tradersThisWeek: 1 } as never);
    renderPage();
    expect(await screen.findByTitle('1 trader this week')).toHaveTextContent('1');
  });

  test('a floor nobody traded this week says 0 traders, not its member count', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue({ ...payload, tradersThisWeek: 0 } as never);
    renderPage();
    expect(await screen.findByTitle('0 traders this week')).toHaveTextContent('0');
  });

  test('shows only the facts that exist when the floor payload is missing', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockRejectedValue(new Error('down'));
    renderPage();
    await screen.findByText('LookPilot');
    // Only the proposal count is known from the listing itself; the
    // participant, pool and trade counts live in the floor payload.
    const row = screen.getByLabelText('Market facts');
    expect(row.querySelectorAll('svg').length).toBe(1);
    expect(row).toHaveTextContent(/^2$/);
  });

  test('no proposals means no proposals cell rather than a zero', async () => {
    vi.mocked(api.getPublicWorkspaces).mockResolvedValue([
      { ...listing, proposalStats: { ...listing.proposalStats, pending: 0 } },
    ] as never);
    renderPage();
    const row = await screen.findByLabelText('Market facts');
    await waitFor(() => expect(row.querySelectorAll('svg').length).toBe(3));
    expect(screen.queryByTitle(/proposals priced now/)).toBeNull();
  });
});

/**
 * A card leads with the workspace's DECISION number (owner direction
 * 2026-08-16). With two clocks running the same definition, the card had
 * been showing the soonest, so LookPilot advertised the few hundred dollars
 * this week had earned so far instead of the net 2026 it is judged on.
 */
describe('liquidity on the cell', () => {
  test('the drop counts the credits in the pools, never the LMSR parameter', async () => {
    // Two open markets: 1,000 and 3,200 credits in their pools. `liquidity`
    // beside `pool` is b = pool / ln 2 and must never reach the screen
    // (owner report 2026-08-30).
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue({
      ...payload,
      markets: [
        { ...payload.markets[0], pool: 1000, liquidity: 1442.7 },
        {
          marketId: 'm-2',
          metricName: 'LookPilot revenue (monthly, USD)',
          consensus: 80000,
          targetDate: '2026-09',
          pool: 3200,
          liquidity: 4616.6,
        },
      ],
    } as never);
    renderPage();
    expect(await screen.findByTitle(/4,200 credits in the pools/)).toHaveTextContent('4,200');
    expect(screen.queryByText(/6,059|1,443|4,617/)).toBeNull();
  });

  // The drop counts every open book on the floor, not only the baseline
  // markets: both branches of every proposal still on the ballot are books a
  // trader can win from too (owner ask 2026-09-11, docs/ui-conventions.md,
  // "The marketplace").
  const pair = (approvedPool: number | null, declinedPool: number | null) => ({
    metricId: 'met-1',
    metricName: 'LookPilot revenue (monthly, USD)',
    targetDate: '2026-08',
    approvedPool,
    declinedPool,
  });
  const proposal = (id: string, extra: Record<string, unknown>) => ({
    id,
    number: 1,
    title: 'Ship the thing',
    description: '',
    proposedByName: 'ann',
    createdAt: '2026-09-01T00:00:00.000Z',
    marketPairCount: 1,
    ...extra,
  });

  test('the drop counts the branch pools of every proposal on the ballot as well as the baseline markets', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue({
      ...payload,
      markets: [{ ...payload.markets[0], pool: 1000 }],
      proposals: [
        proposal('p-1', { status: 'pending', closedAt: null, markets: [pair(300, 200)] }),
        proposal('p-2', { status: 'pending', closedAt: null, markets: [pair(50, 50), pair(100, 0)] }),
      ],
    } as never);
    renderPage();
    expect(await screen.findByTitle(/1,700 credits in the pools/)).toHaveTextContent('1,700');
    expect(screen.queryByTitle(/^1,000 credits in the pools/)).toBeNull();
  });

  test('a proposal without a status is on the ballot and counts', async () => {
    // Older payloads carry no status on a pending proposal.
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue({
      ...payload,
      markets: [{ ...payload.markets[0], pool: 1000 }],
      proposals: [proposal('p-1', { markets: [pair(300, 200)] })],
    } as never);
    renderPage();
    expect(await screen.findByTitle(/1,500 credits in the pools/)).toHaveTextContent('1,500');
  });

  test('a decided, lapsed or closed proposal counts nothing', async () => {
    // Settled or voided books hold nothing a trader can still win; a pending
    // proposal whose trading has closed is on its way to the same place.
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue({
      ...payload,
      markets: [{ ...payload.markets[0], pool: 1000 }],
      proposals: [
        proposal('p-1', { status: 'approved', closedAt: '2026-09-02T00:00:00.000Z', markets: [pair(300, 200)] }),
        proposal('p-2', { status: 'declined', closedAt: '2026-09-02T00:00:00.000Z', markets: [pair(300, 200)] }),
        proposal('p-3', { status: 'lapsed', lapsedAt: '2026-09-02T00:00:00.000Z', markets: [pair(300, 200)] }),
        proposal('p-4', { status: 'pending', closedAt: '2026-09-02T00:00:00.000Z', markets: [pair(300, 200)] }),
      ],
    } as never);
    renderPage();
    expect(await screen.findByTitle(/^1,000 credits in the pools/)).toHaveTextContent('1,000');
  });

  test('a branch with no book yet counts nothing rather than breaking the sum', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue({
      ...payload,
      markets: [{ ...payload.markets[0], pool: 1000 }],
      proposals: [proposal('p-1', { status: 'pending', closedAt: null, markets: [pair(null, null), pair(250, null)] })],
    } as never);
    renderPage();
    expect(await screen.findByTitle(/1,250 credits in the pools/)).toHaveTextContent('1,250');
  });

  test('a floor with no baseline market but a live proposal still shows the drop', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue({
      ...payload,
      markets: [],
      proposals: [proposal('p-1', { status: 'pending', closedAt: null, markets: [pair(300, 200)] })],
    } as never);
    renderPage();
    expect(await screen.findByTitle(/^500 credits in the pools/)).toHaveTextContent('500');
  });

  test('the grid orders on the total including proposal pools', async () => {
    vi.mocked(api.getPublicWorkspaces).mockResolvedValue([
      { ...listing, workspaceId: 'ws-base', slug: 'base', name: 'Base' },
      { ...listing, workspaceId: 'ws-ballot', slug: 'ballot', name: 'Ballot' },
    ] as never);
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async key => {
      if (key === 'base') return { ...payload, markets: [{ ...payload.markets[0], pool: 900 }] } as never;
      return {
        ...payload,
        markets: [{ ...payload.markets[0], pool: 100 }],
        proposals: [proposal('p-1', { status: 'pending', closedAt: null, markets: [pair(600, 600)] })],
      } as never;
    });
    renderPage();
    await screen.findByTitle(/1,300 credits in the pools/);
    await screen.findByTitle(/^900 credits in the pools/);
    const cells = screen.getAllByTitle(/credits in the pools/);
    expect(cells[0]).toHaveTextContent('1,300');
    expect(cells[1]).toHaveTextContent('900');
  });

  test('a deep pool takes the short form the market page uses', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue({
      ...payload,
      markets: [{ ...payload.markets[0], pool: 24600 }],
    } as never);
    renderPage();
    expect(await screen.findByTitle(/25k credits in the pools/)).toHaveTextContent('25k');
  });

  test('a workspace with no open markets says nothing about liquidity rather than zero', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue({ ...payload, markets: [] } as never);
    renderPage();
    await screen.findByTitle(/9 traders this week/);
    expect(screen.queryByTitle(/credits in the pools/)).toBeNull();
  });

  test('the grid is ordered by liquidity, deepest first', async () => {
    vi.mocked(api.getPublicWorkspaces).mockResolvedValue([
      { ...listing, workspaceId: 'ws-shallow', slug: 'shallow', name: 'Shallow' },
      { ...listing, workspaceId: 'ws-deep', slug: 'deep', name: 'Deep' },
      { ...listing, workspaceId: 'ws-mid', slug: 'mid', name: 'Mid' },
    ] as never);
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async (key: string) => {
      const pool = { shallow: 50, deep: 9000, mid: 700 }[key] ?? 0;
      return { ...payload, markets: [{ ...payload.markets[0], pool }] } as never;
    });
    renderPage();
    await screen.findByTitle(/9,000 credits in the pools/);
    await screen.findByTitle(/^50 credits in the pools/);
    await screen.findByTitle(/700 credits in the pools/);
    const names = Array.from(document.querySelectorAll('.mkt-cell-name')).map(n => n.textContent);
    expect(names).toEqual(['Deep', 'Mid', 'Shallow']);
  });

  test("the owner's own not-public card takes the same order rather than pinning to the front", async () => {
    signedIn = true;
    vi.mocked(api.listWorkspaces).mockResolvedValue([{ id: 'ws-mine', name: 'Mine', visibility: 'private' }] as never);
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async (key: string) => {
      const pool = key === 'ws-mine' ? 10 : 5000;
      return { ...payload, markets: [{ ...payload.markets[0], pool }] } as never;
    });
    renderPage();
    await screen.findByTitle(/5,000 credits in the pools/);
    await screen.findByTitle(/^10 credits in the pools/);
    const names = Array.from(document.querySelectorAll('.mkt-cell-name')).map(n => n.textContent);
    expect(names).toEqual(['LookPilot', 'Mine']);
  });

  test('cells without a liquidity figure keep their arrival order', async () => {
    vi.mocked(api.getPublicWorkspaces).mockResolvedValue([
      { ...listing, workspaceId: 'a', slug: 'a', name: 'Alpha' },
      { ...listing, workspaceId: 'b', slug: 'b', name: 'Beta' },
    ] as never);
    vi.mocked(api.getMarketplaceWorkspace).mockRejectedValue(new Error('down'));
    renderPage();
    await screen.findByText('Alpha');
    const names = Array.from(document.querySelectorAll('.mkt-cell-name')).map(n => n.textContent);
    expect(names).toEqual(['Alpha', 'Beta']);
  });
});

describe('which number a card shows', () => {
  test('the furthest-resolving market, not the soonest', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue({
      ...payload,
      markets: [
        { metricName: 'LookPilot revenue this week (USD)', consensus: 213, targetDate: '2026-W34' },
        { metricName: 'LookPilot net 2026 (USD)', consensus: 78_571, targetDate: '2026-12' },
      ],
    } as never);
    const { container } = renderPage();

    await waitFor(() => expect(container.querySelector('.mkt-cell-price')?.textContent).toBeTruthy());
    expect(container.querySelector('.mkt-cell-price')!.textContent).toBe('$78,571');
    expect(container.querySelector('.mkt-cell-metric')!.textContent).toBe('LookPilot net 2026');
  });

  test('a single-market workspace still shows its one number', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelector('.mkt-cell-price')?.textContent).toBeTruthy());
    expect(container.querySelector('.mkt-cell-price')!.textContent).toBe('$77,316');
  });
});

describe('liquidity on the cell, with a proposal with options', () => {
  // A proposal with options has no approved or declined book: its books are
  // its options' (docs/guides/proposals.md, "More than two options"), and
  // the drop counts every one of them (docs/ui-conventions.md, "The
  // marketplace").
  const optionRow = (pools: Array<number | null>) => ({
    metricId: 'met-1',
    metricName: 'LookPilot revenue (monthly, USD)',
    targetDate: '2026-08',
    approvedPool: null,
    declinedPool: null,
    options: pools.map((pool, i) => ({ id: `o${i}`, label: `Option ${i}`, marketId: `m-o${i}`, pool })),
  });
  test('the drop sums the option pools of every proposal on the ballot, never NaN', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue({
      ...payload,
      markets: [{ ...payload.markets[0], pool: 1000 }],
      proposals: [
        {
          id: 'p-opts',
          number: 9,
          title: 'Which way?',
          description: '',
          proposedByName: 'ann',
          createdAt: '2026-09-01T00:00:00.000Z',
          status: 'pending',
          closedAt: null,
          options: [
            { id: 'o0', label: 'Option 0' },
            { id: 'o1', label: 'Option 1' },
            { id: 'o2', label: 'Option 2' },
          ],
          marketPairCount: 1,
          markets: [optionRow([300, 200, null])],
        },
      ],
    } as never);
    renderPage();
    expect(await screen.findByTitle(/1,500 credits in the pools/)).toHaveTextContent('1,500');
    expect(document.body.textContent).not.toMatch(/NaN/);
  });
});

/**
 * THE MOST TRADED FLOOR IS FEATURED ABOVE THE BOARD (docs/ui-conventions.md,
 * "The marketplace"; Viktor 2026-09-13: "lets make the snake the primary
 * workspace the most highglighted one.. on the landing page.. right now its
 * the last one"). The busiest floor by credits traded per hour over the last
 * 24 hours gets one full-width card between the season strip and the board,
 * and is not repeated in the board.
 */
describe('THE MOST TRADED FLOOR IS FEATURED ABOVE THE BOARD', () => {
  const snakeRow = {
    workspaceId: 'ws-snake',
    slug: 'snake',
    name: 'Snake',
    description: 'A snake game steered by this market.',
    proposalStats: { total: 0, approved: 0, declined: 0, declinedSpam: 0, withdrawn: 0, pending: 0 },
  };
  const snakeFloor = {
    participantCount: 23,
    tradesThisWeek: 2548,
    liveFeed: { kind: 'snake', url: 'https://snake.telarchy.com' },
    markets: [
      {
        marketId: 'm-snake',
        metricName: 'Reached length',
        marketTitle: 'What length will I reach on this attempt?',
        consensus: 30,
        targetDate: '2026-12',
        pool: 3000,
      },
    ],
    marketHistory: [],
    marketHistoryMarketId: 'm-snake',
  };
  function withRows(rows: Array<Record<string, unknown>>, floors: Record<string, unknown> = {}) {
    vi.mocked(api.getPublicWorkspaces).mockResolvedValue(rows as never);
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation(
      async (slug: string) => (floors[slug] ?? (slug === 'snake' ? snakeFloor : payload)) as never,
    );
  }
  const boardNames = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('.mkt-board .mkt-cell-name')).map(n => n.textContent);

  test('Snake was the last card although it trades the most (2026-09-13): the busiest floor by volume an hour is featured, not repeated in the board', async () => {
    withRows([
      { ...listing, volumePerHour: 1 },
      { ...snakeRow, volumePerHour: 15_369 },
    ]);
    const { container } = renderPage();
    const card = await screen.findByRole('region', { name: /most traded now/i });
    expect(within(card).getByText('Snake')).toBeInTheDocument();
    expect(within(card).getByText(/most traded now/i)).toBeInTheDocument();
    expect(within(card).getByText('15k cr an hour')).toBeInTheDocument();
    expect(within(card).getByText('What length will I reach on this attempt?')).toBeInTheDocument();
    await waitFor(() => expect(boardNames(container)).toEqual(['LookPilot']));
  });

  test('the card sits between the season strip and the board', async () => {
    withRows([
      { ...listing, volumePerHour: 1 },
      { ...snakeRow, volumePerHour: 15_369 },
    ]);
    const { container } = renderPage();
    const card = await screen.findByRole('region', { name: /most traded now/i });
    await screen.findByText('Season 0');
    const season = container.querySelector('.mkt-season') as HTMLElement;
    const board = container.querySelector('.mkt-board') as HTMLElement;
    expect(season.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('its two buttons are the hero market on its page, and the page still never says bet or floor', async () => {
    withRows([
      { ...listing, volumePerHour: 1 },
      { ...snakeRow, volumePerHour: 15_369 },
    ]);
    const { container } = renderPage();
    const card = await screen.findByRole('region', { name: /most traded now/i });
    expect(within(card).getByRole('link', { name: /higher/i })).toHaveAttribute('href', '/snake#market=m-snake');
    expect(within(card).getByRole('link', { name: /lower/i })).toHaveAttribute('href', '/snake#market=m-snake');
    expect(container.textContent).not.toMatch(/\bbet\b/i);
    expect(container.textContent).not.toMatch(/floor/i);
  });

  test('a floor with a live feed shows its live board without the replay row', async () => {
    withRows([
      { ...listing, volumePerHour: 1 },
      { ...snakeRow, volumePerHour: 15_369 },
    ]);
    renderPage();
    const card = await screen.findByRole('region', { name: /most traded now/i });
    const live = await within(card).findByTestId('snake-live');
    expect(live).toHaveAttribute('data-slug', 'snake');
    expect(live).toHaveAttribute('data-replay', 'false');
  });

  test('a featured floor without a live feed shows its market spark instead', async () => {
    withRows([
      { ...listing, volumePerHour: 40 },
      { ...snakeRow, volumePerHour: 2 },
    ]);
    const { container } = renderPage();
    const card = await screen.findByRole('region', { name: /most traded now/i });
    expect(within(card).getByText('LookPilot')).toBeInTheDocument();
    await waitFor(() => expect(card.querySelector('.mkt-spark')).toBeTruthy());
    expect(within(card).queryByTestId('snake-live')).toBeNull();
    await waitFor(() => expect(boardNames(container)).toEqual(['Snake']));
  });

  test('a tie goes to the deeper liquidity', async () => {
    withRows([
      { ...listing, volumePerHour: 10 },
      { ...snakeRow, volumePerHour: 10 },
    ]);
    renderPage();
    const card = await screen.findByRole('region', { name: /most traded now/i });
    // Snake's pool is 3,000 against LookPilot's 1,000.
    await waitFor(() => expect(within(card).getByText('Snake')).toBeInTheDocument());
  });

  test('when no floor traded in 24 hours there is no card and the board is unchanged', async () => {
    withRows([
      { ...listing, volumePerHour: 0 },
      { ...snakeRow, volumePerHour: 0 },
    ]);
    const { container } = renderPage();
    await screen.findByText('LookPilot');
    await waitFor(() => expect(boardNames(container).sort()).toEqual(['LookPilot', 'Snake']));
    expect(screen.queryByRole('region', { name: /most traded now/i })).toBeNull();
  });

  test('an older payload without the number features nothing', async () => {
    withRows([listing, snakeRow]);
    const { container } = renderPage();
    await screen.findByText('LookPilot');
    await waitFor(() => expect(boardNames(container).length).toBe(2));
    expect(container.querySelector('.mkt-featured')).toBeNull();
  });

  test("the caller's own not-yet-public floor is never featured", () => {
    const base = {
      slug: null,
      description: null,
      pendingJobs: 0,
      hero: null,
      traders: null,
      tradesThisWeek: null,
    };
    const mine = {
      ...base,
      workspaceId: 'mine',
      name: 'Mine',
      liquidity: 9_999,
      volumePerHour: 9_999,
      mineVisibility: 'private',
    };
    const pub = { ...base, workspaceId: 'pub', name: 'Pub', liquidity: 1, volumePerHour: 1 };
    expect(pickFeatured([mine, pub] as never)?.workspaceId).toBe('pub');
    expect(pickFeatured([mine] as never)).toBeNull();
  });
});

/**
 * THE HOME PAGE'S NUMBERS ARE NEVER OLDER THAN 15 SECONDS (docs/ui-conventions.md,
 * "The marketplace"). Viktor 2026-09-13: the Snake card said 2.1 while the
 * market was at 8.1; the server had the right number, the page had read once
 * and never again.
 */
describe("THE HOME PAGE'S NUMBERS ARE NEVER OLDER THAN 15 SECONDS", () => {
  const setVisibility = (state: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  const moved = { ...payload, markets: [{ ...payload.markets[0], consensus: 81_000 }] };

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });

  test('the Snake card said 2.1 while the market was at 8.1 (2026-09-13): a visible page re-reads the payload every 15 seconds and shows the new number', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPage();
    await screen.findByText('$77,316');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(moved as never);
    const before = vi.mocked(api.getHome).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await waitFor(() => expect(screen.getByText('$81,000')).toBeInTheDocument());
    expect(vi.mocked(api.getHome).mock.calls.length).toBe(before + 1);
  });

  test('a hidden tab does not read, and reads at once when it comes back into view', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPage();
    await screen.findByText('$77,316');
    setVisibility('hidden');
    const before = vi.mocked(api.getHome).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(vi.mocked(api.getHome).mock.calls.length).toBe(before);
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(moved as never);
    await act(async () => {
      setVisibility('visible');
    });
    await waitFor(() => expect(screen.getByText('$81,000')).toBeInTheDocument());
    expect(vi.mocked(api.getHome).mock.calls.length).toBe(before + 1);
  });

  test('a failed re-read keeps the numbers on screen', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPage();
    await screen.findByText('$77,316');
    vi.mocked(api.getHome).mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(screen.getByText('$77,316')).toBeInTheDocument();
    expect(screen.getByText('LookPilot')).toBeInTheDocument();
  });
});

/**
 * THE BOARD NEVER ENDS ON AN EMPTY SLOT (docs/ui-conventions.md, "The
 * marketplace"). Viktor 2026-09-13: with Snake featured above, two floors
 * were left and the listing cell, spanning two columns, wrapped to its own
 * row and left a large empty block beside the floors. jsdom lays out no
 * grid, so this reads the stylesheet: explicit column counts per width and a
 * listing cell that fills whatever its row has left.
 */
describe('THE BOARD NEVER ENDS ON AN EMPTY SLOT', () => {
  const CSS = readFileSync(join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'style.css'), 'utf8');
  const squash = (s: string) => s.replace(/\s+/g, ' ');
  const css = squash(CSS);

  test('the board has explicit columns: one, two from 640px, three from 1000px', () => {
    expect(css).toMatch(/\.mkt-board \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
    expect(css).toMatch(
      /@media \(min-width: 640px\) \{[^@]*\.mkt-board \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/,
    );
    expect(css).toMatch(
      /@media \(min-width: 1000px\) \{[^@]*\.mkt-board \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/,
    );
    expect(css).not.toMatch(/\.mkt-board \{[^}]*auto-fill/);
  });

  test('Two floors left an empty block beside the listing cell (2026-09-13): at three columns it fills one, two or three slots, whatever its row has left', () => {
    const wide = css.slice(css.indexOf('@media (min-width: 1000px)'));
    expect(wide).toMatch(/\.mkt-cell--new:nth-child\(3n\+1\) \{ grid-column: 1 \/ -1; \}/);
    expect(wide).toMatch(/\.mkt-cell--new:nth-child\(3n\+2\) \{ grid-column: span 2; \}/);
    expect(wide).toMatch(/\.mkt-cell--new:nth-child\(3n\) \{ grid-column: span 1; \}/);
  });

  test('at two columns it takes the last slot beside an odd floor, else the whole row', () => {
    const mid = css.slice(css.indexOf('@media (min-width: 640px)'));
    expect(mid).toMatch(/\.mkt-cell--new:nth-child\(odd\) \{ grid-column: 1 \/ -1; \}/);
    expect(css).not.toMatch(/\.mkt-cell--new \{ grid-column: span 2; \}/);
  });

  test('the listing cell is the last child of the board, which the nth-child rules count on', async () => {
    const { container } = renderPage();
    await screen.findByText('LookPilot');
    await waitFor(() => expect(container.querySelector('.mkt-board > .mkt-cell--new')).toBeTruthy());
    const board = container.querySelector('.mkt-board') as HTMLElement;
    expect(board.lastElementChild).toHaveClass('mkt-cell--new');
  });
});

/**
 * THE FEATURED CARD SHOWS ITS MOST TRADED OPEN PROPOSAL (docs/ui-conventions.md,
 * "The marketplace"; Viktor 2026-09-13 picked direction 1: "show the current
 * proposals for the latest move as well.. to demonstrate the mechanism", in
 * general "the most volumed proposal or whatever that is active").
 */
describe('THE FEATURED CARD SHOWS ITS MOST TRADED OPEN PROPOSAL', () => {
  const inSeconds = (s: number) => new Date(Date.now() + s * 1000).toISOString();
  const optionProposal = (over: Record<string, unknown> = {}) => ({
    id: 'p-move-90',
    number: 6791,
    title: 'Game 3, attempt 1, move 90',
    status: 'pending',
    decideBy: inSeconds(24),
    closedAt: null,
    createdAt: new Date(Date.now() - 36_000).toISOString(),
    options: [
      { id: 'forward', label: 'Continue forward' },
      { id: 'left', label: 'Turn left' },
      { id: 'right', label: 'Turn right' },
    ],
    markets: [
      {
        metricName: 'Reached length',
        targetDate: '2026-12',
        approvedConsensus: null,
        declinedConsensus: null,
        delta: 2.98,
        options: [
          {
            id: 'forward',
            label: 'Continue forward',
            marketId: 'mf',
            consensus: 14.02,
            liquidity: 800,
            pool: 1250,
            traders: 1,
            volume: 250,
            delta: -2.98,
          },
          {
            id: 'left',
            label: 'Turn left',
            marketId: 'ml',
            consensus: 17,
            liquidity: 800,
            pool: 1091,
            traders: 1,
            volume: 91,
            delta: 2.98,
          },
          {
            id: 'right',
            label: 'Turn right',
            marketId: 'mr',
            consensus: 14.02,
            liquidity: 800,
            pool: 1250,
            traders: 1,
            volume: 250,
            delta: -2.98,
          },
        ],
      },
    ],
    ...over,
  });
  const snakeRow = {
    workspaceId: 'ws-snake',
    slug: 'snake',
    name: 'Snake',
    description: 'A snake game.',
    proposalStats: { pending: 1 },
    volumePerHour: 15_000,
  };
  const snakeFloorWith = (proposals: unknown[]) => ({
    participantCount: 23,
    tradesThisWeek: 2548,
    liveFeed: { kind: 'snake', url: 'https://snake.telarchy.com' },
    markets: [
      {
        marketId: 'm-snake',
        metricName: 'Reached length',
        marketTitle: 'What length will I reach on this attempt?',
        consensus: 30,
        targetDate: '2026-12',
        pool: 3000,
      },
    ],
    marketHistory: [],
    marketHistoryMarketId: 'm-snake',
    proposals,
  });
  const serve = (rows: unknown[], floors: Record<string, unknown>) => {
    vi.mocked(api.getPublicWorkspaces).mockResolvedValue(rows as never);
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation(
      async (slug: string) => (floors[slug] ?? payload) as never,
    );
  };
  const deciding = async () => {
    const card = await screen.findByRole('region', { name: /most traded now/i });
    return within(card).findByRole('group', { name: /deciding now/i });
  };

  test("the snake's current move shows under the number: each option with its price and impact, the leader marked, rows linking to the proposal", async () => {
    serve([{ ...listing, volumePerHour: 1 }, snakeRow], { snake: snakeFloorWith([optionProposal()]) });
    renderPage();
    const block = await deciding();
    expect(within(block).getByText(/deciding now/i)).toBeInTheDocument();
    expect(within(block).getByText('Game 3, attempt 1, move 90')).toBeInTheDocument();
    expect(within(block).getByText('#6791')).toBeInTheDocument();
    const rows = within(block).getAllByRole('link');
    expect(rows.map(r => r.textContent)).toEqual([
      expect.stringMatching(/Continue forward.*14\.0.*-3\.0/),
      expect.stringMatching(/Turn left.*leads.*17\.0.*\+3\.0/),
      expect.stringMatching(/Turn right.*14\.0.*-3\.0/),
    ]);
    expect(rows[1]).toHaveClass('is-leader');
    expect(rows[0]).not.toHaveClass('is-leader');
    for (const r of rows) expect(r).toHaveAttribute('href', '/snake#proposal=p-move-90');
    expect(
      within(block).getByText(/Each option is priced by what traders forecast it does to Reached length\./),
    ).toBeInTheDocument();
  });

  test('the countdown to the decision ticks beside the label', async () => {
    serve([{ ...listing, volumePerHour: 1 }, snakeRow], { snake: snakeFloorWith([optionProposal()]) });
    renderPage();
    const block = await deciding();
    expect(within(block).getByText(/decides in 0:2\d/)).toBeInTheDocument();
  });

  test('a tie at the top marks no one', async () => {
    const tied = optionProposal();
    (tied.markets[0].options as Array<{ consensus: number }>)[1].consensus = 14.02;
    serve([{ ...listing, volumePerHour: 1 }, snakeRow], { snake: snakeFloorWith([tied]) });
    renderPage();
    const block = await deciding();
    expect(within(block).queryByText('leads')).toBeNull();
    expect(block.querySelector('.is-leader')).toBeNull();
  });

  test('the most traded open proposal wins over a newer quieter one, and a decided or closed one never shows', async () => {
    const busy = optionProposal({
      id: 'p-busy',
      number: 1,
      title: 'Busy one',
      createdAt: new Date(Date.now() - 600_000).toISOString(),
    });
    const quiet = optionProposal({ id: 'p-quiet', number: 2, title: 'Quiet newer one' });
    (quiet.markets[0].options as Array<{ volume: number }>).forEach(o => {
      o.volume = 1;
    });
    const decided = optionProposal({ id: 'p-done', number: 3, title: 'Decided one', status: 'approved' });
    (decided.markets[0].options as Array<{ volume: number }>).forEach(o => {
      o.volume = 99_999;
    });
    const closed = optionProposal({
      id: 'p-closed',
      number: 4,
      title: 'Closed one',
      closedAt: new Date().toISOString(),
    });
    (closed.markets[0].options as Array<{ volume: number }>).forEach(o => {
      o.volume = 99_999;
    });
    serve([{ ...listing, volumePerHour: 1 }, snakeRow], { snake: snakeFloorWith([decided, closed, quiet, busy]) });
    renderPage();
    const block = await deciding();
    expect(within(block).getByText('Busy one')).toBeInTheDocument();
  });

  test('equal volume goes to the newest', async () => {
    const older = optionProposal({
      id: 'p-old',
      number: 1,
      title: 'Older',
      createdAt: new Date(Date.now() - 600_000).toISOString(),
    });
    const newer = optionProposal({
      id: 'p-new',
      number: 2,
      title: 'Newer',
      createdAt: new Date(Date.now() - 1_000).toISOString(),
    });
    serve([{ ...listing, volumePerHour: 1 }, snakeRow], { snake: snakeFloorWith([older, newer]) });
    renderPage();
    const block = await deciding();
    expect(within(block).getByText('Newer')).toBeInTheDocument();
  });

  test('an approve or decline proposal shows If approved and If declined with the impact of approving', async () => {
    const pairFloor = {
      ...payload,
      proposals: [
        {
          id: 'p-reviews',
          number: 12,
          title: 'Answer every negative Steam review',
          status: 'pending',
          decideBy: inSeconds(2 * 86_400 + 6 * 3_600 + 30),
          closedAt: null,
          createdAt: new Date().toISOString(),
          options: null,
          markets: [
            {
              metricName: 'LookPilot revenue (monthly, USD)',
              targetDate: '2026-09',
              approvedConsensus: 8507.76,
              declinedConsensus: 6668.79,
              delta: 1838.97,
              options: null,
              approvedVolume: 56,
              declinedVolume: 0,
            },
          ],
        },
      ],
    };
    serve(
      [
        { ...listing, volumePerHour: 40 },
        { ...snakeRow, volumePerHour: 1 },
      ],
      { lookpilot: pairFloor, snake: snakeFloorWith([]) },
    );
    renderPage();
    const block = await deciding();
    const rows = within(block).getAllByRole('link');
    expect(rows.map(r => r.textContent)).toEqual([
      expect.stringMatching(/If approved.*\$8,508/),
      expect.stringMatching(/If declined.*\$6,669/),
    ]);
    expect(rows[0]).toHaveClass('is-leader');
    expect(within(block).getByText('+$1,839')).toBeInTheDocument();
    expect(within(block).getByText(/decides in 2d 6h/)).toBeInTheDocument();
    for (const r of rows) expect(r).toHaveAttribute('href', '/lookpilot#proposal=p-reviews');
  });

  test('a featured floor with no open proposal shows no deciding block', async () => {
    serve([{ ...listing, volumePerHour: 1 }, snakeRow], {
      snake: snakeFloorWith([optionProposal({ status: 'declined' })]),
    });
    renderPage();
    const card = await screen.findByRole('region', { name: /most traded now/i });
    await waitFor(() => expect(within(card).getByText('Snake')).toBeInTheDocument());
    expect(within(card).queryByRole('group', { name: /deciding now/i })).toBeNull();
  });

  test('the card still never says bet or floor', async () => {
    serve([{ ...listing, volumePerHour: 1 }, snakeRow], { snake: snakeFloorWith([optionProposal()]) });
    const { container } = renderPage();
    await deciding();
    expect(container.textContent).not.toMatch(/\bbet\b/i);
    expect(container.textContent).not.toMatch(/floor/i);
  });
});
