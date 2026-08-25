import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../lib/api', () => ({
  api: {
    getPublicWorkspaces: vi.fn(),
    getMarketplaceWorkspace: vi.fn(),
    getSeasons: vi.fn(),
    joinWaitlist: vi.fn(),
  },
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
// The top bar drags in the whole floor page; the marketplace grid is what
// this spec is about.
vi.mock('../TradePage', () => ({ TopBar: () => null }));

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
    { marketId: 'm-1', metricName: 'LookPilot revenue (monthly, USD)', consensus: 77315.69, targetDate: '2026-08' },
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
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.mocked(api.getPublicWorkspaces).mockResolvedValue([listing] as never);
  vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(payload as never);
  vi.mocked(api.getSeasons).mockResolvedValue({ seasons: [season] } as never);
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
    // Reworded and halved 2026-08-20 when this became the home page. The
    // three things the sentence has to carry are unchanged: one number, who
    // may propose, and that the market prices it BEFORE the owner decides.
    renderPage();
    // "someone", not "a company": individuals run personal goals here and are
    // first-class (AGENTS.md, dual scope). A listing like "My Utility /
    // Subjective health feeling" is not a company.
    expect(screen.getByText(/one number someone is trying to move/i)).toBeInTheDocument();
    expect(screen.getByText(/human or AI/i)).toBeInTheDocument();
    expect(screen.getByText(/prices the job before the owner decides/i)).toBeInTheDocument();
  });

  test('the season has a door here, because this is where recruiting lands', async () => {
    // The home page said nothing about the season until 2026-08-21, so every
    // post pointing at telarchy.com arrived at a page whose only calls to
    // action were owner-facing and a trader had nowhere to go.
    renderPage();
    expect(await screen.findByText('Season 0')).toBeInTheDocument();
    expect(screen.getByText(/\$1,000 in real money/)).toBeInTheDocument();
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
    await screen.findByText('settles 31 August 2026');
    expect(screen.getByText(/14 participants · 108 trades this week · 2 contracts priced now/)).toBeInTheDocument();
  });

  test('listing your own number is a cell of the grid, not a footnote', async () => {
    const { container } = renderPage();
    const tile = await screen.findByText('List your own number');
    const card = tile.closest('.mkt-card');
    expect(card).toHaveClass('mkt-card--new');
    expect(card?.parentElement).toHaveClass('mkt-grid');
    expect(container.querySelector('.mkt-new-mark')).toBeTruthy();
  });

  test('it leads straight to the setup conversation, asking for nothing', async () => {
    // It took an email in place while the owner side was a waitlist. There is
    // a door now (owner direction 2026-08-24), and asking for an address in
    // front of a door that opens turns someone ready to start into someone
    // waiting to be contacted.
    renderPage();
    const tile = await screen.findByText('List your own number');
    const card = tile.closest('a');
    expect(card).toHaveAttribute('href', '/manage');
    expect(screen.queryByLabelText('Your email')).toBeNull();
    expect(api.joinWaitlist).not.toHaveBeenCalled();
  });

  test('it says a floor is not only for companies', async () => {
    // Dual scope is load-bearing (AGENTS.md): this tile is where a visitor
    // decides which side of the market they are on, and a personal goal is as
    // welcome as a company.
    renderPage();
    expect(await screen.findByText(/something you are running yourself/i)).toBeInTheDocument();
  });

  test('the grid still renders its listing tile when nothing is listed yet', async () => {
    vi.mocked(api.getPublicWorkspaces).mockResolvedValue([] as never);
    renderPage();
    expect(await screen.findByText('List your own number')).toBeInTheDocument();
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
  test('the grid holds the market page motif until the listings land', async () => {
    let release: (v: unknown) => void = () => {};
    vi.mocked(api.getPublicWorkspaces).mockReturnValue(
      new Promise(r => {
        release = r;
      }) as never,
    );
    const { container } = renderPage();
    // Same element and class as a market page's loading screen, never a
    // blank page and never a spinner.
    expect(container.querySelector('.mkt-loading .pubws-loading-dot')).toBeTruthy();
    expect(container.querySelector('.mkt-grid')).toBeNull();
    release([listing]);
    await screen.findByText('LookPilot');
    expect(container.querySelector('.mkt-loading')).toBeNull();
  });

  test('a card whose number is still in flight ripples in the chart slot', async () => {
    let release: (v: unknown) => void = () => {};
    vi.mocked(api.getMarketplaceWorkspace).mockReturnValue(
      new Promise(r => {
        release = r;
      }) as never,
    );
    const { container } = renderPage();
    await screen.findByText('LookPilot');
    expect(container.querySelector('.mkt-card-loading .pubws-loading-dot')).toBeTruthy();
    release(payload);
    await waitFor(() => expect(container.querySelector('.mkt-spark')).toBeTruthy());
    expect(container.querySelector('.mkt-card-loading')).toBeNull();
  });
});

describe('the activity line', () => {
  test('never leaves a separator hanging while counts are still loading', async () => {
    let release: (v: unknown) => void = () => {};
    vi.mocked(api.getMarketplaceWorkspace).mockReturnValue(
      new Promise(r => {
        release = r;
      }) as never,
    );
    const { container } = renderPage();
    await screen.findByText('LookPilot');
    // Only the proposal count is known from the listing payload; the
    // participant and trade counts are still in flight.
    const line = container.querySelector('.mkt-card-activity')?.textContent ?? '';
    expect(line).toBe('2 contracts priced now');
    release(payload);
    await screen.findByText(/14 participants · 108 trades this week · 2 contracts priced now/);
  });
});

/**
 * A card leads with the workspace's DECISION number (owner direction
 * 2026-08-16). With two clocks running the same definition, the card had
 * been showing the soonest, so LookPilot advertised the few hundred dollars
 * this week had earned so far instead of the net 2026 it is judged on.
 */
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

    await waitFor(() => expect(container.querySelector('.mkt-card-price')?.textContent).toBeTruthy());
    expect(container.querySelector('.mkt-card-price')!.textContent).toBe('$78,571');
    expect(container.querySelector('.mkt-card-metric')!.textContent).toBe('LookPilot net 2026');
  });

  test('a single-market workspace still shows its one number', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelector('.mkt-card-price')?.textContent).toBeTruthy());
    expect(container.querySelector('.mkt-card-price')!.textContent).toBe('$77,316');
  });
});
