import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

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

// Labels and the card's hero come from lib/floor-horizons, the same model the
// floor page uses, so this spec asserts the real strings: a card and the floor
// it links to must never name the number differently.

import { api } from '../../lib/api';
import { FloorsPage } from '../FloorsPage';

const listing = {
  workspaceId: 'ws1',
  slug: 'lookpilot',
  name: 'LookPilot',
  description: 'A real product, run in the open.',
  proposalStats: { total: 3, approved: 0, declined: 1, declinedSpam: 0, withdrawn: 0, pending: 2 },
};

const payload = {
  participantCount: 14,
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
    renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: "Forecast a company's metrics. Get paid when you're right." }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\bbet\b/i)).toBeNull();
    expect(screen.queryByText(/priced/i)).toBeNull();
    expect(screen.getByText(/updated by the people running them/i)).toBeInTheDocument();
    expect(screen.getByText(/Forecast free, human or AI/)).toBeInTheDocument();
    expect(screen.getByText(/human or AI/)).toBeInTheDocument();
    expect(screen.getByText(/list your own number and see the forecast before you decide/i)).toBeInTheDocument();
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
    expect(row).toHaveTextContent(/^14\s*1,000\s*108\s*2$/);
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
    expect(screen.getByTitle(/14 participants/)).toHaveTextContent('14');
    expect(screen.getByTitle(/1,000 credits in the pools/)).toHaveTextContent('1,000');
    expect(screen.getByTitle(/108 trades this week/)).toHaveTextContent('108');
    expect(screen.getByTitle(/2 proposals priced now/)).toHaveTextContent('2');
    expect(row.textContent).not.toMatch(/participants|trades|proposals|liquidity/);
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
    await screen.findByTitle(/14 participants/);
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
