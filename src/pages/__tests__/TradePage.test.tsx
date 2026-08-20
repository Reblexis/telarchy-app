import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

/**
 * The floor's live poll must not touch what the viewer is looking at.
 *
 * The page reloads the workspace every fifteen seconds. That reload used to be a
 * dependency of the effect that resets the branch toggle and blanks the branch
 * histories, so five seconds after opening the "if declined" world the page
 * snapped back to "if approved" and the chart remounted with an empty series
 * (owner report 2026-08-13). These tests pin both halves: the toggle survives
 * a poll, and the chart never sees a blanked series while a job is selected.
 */

const h = vi.hoisted(() => {
  const historyFor = (marketId: string) => [
    { at: '2026-08-12T10:00:00.000Z', consensus: marketId === 'm-declined' ? 70_000 : 80_000 },
    { at: '2026-08-12T12:00:00.000Z', consensus: marketId === 'm-declined' ? 71_000 : 82_000 },
  ];
  // A fresh object per call, exactly like a real fetch: the bug was a
  // dependency on that identity, so a shared frozen fixture would hide it.
  const workspace = () => ({
    workspaceId: 'ws-1',
    name: 'LookPilot',
    slug: 'lookpilot',
    ownerId: null,
    ownerHandle: null,
    description: null,
    charter: null,
    visibility: 'public',
    proposalReward: 0,
    spamPenalty: 0,
    joinAs: 'viewer' as const,
    maxPositionCostPerMarket: 0,
    signupCredits: 100,
    metricCount: 1,
    openMarketCount: 1,
    participantCount: 3,
    proposalStats: { total: 1, pending: 1, approved: 0, declined: 0 },
    markets: [{
      marketId: 'm-hero',
      metricId: 'metric-1',
      metricName: 'LookPilot revenue (monthly, USD)',
      targetDate: '2026-12',
      resolvesOn: '2026-12-31',
      consensus: 80_000,
      probability: 0.5,
      liquidity: 200,
      rangeMin: 0,
      rangeMax: 500_000,
    }],
    marketHistory: historyFor('m-hero'),
    // The payload names the market its inline replay belongs to, so the page
    // never has to guess which chart it fits.
    marketHistoryMarketId: 'm-hero',
    proposals: [{
      id: 'job-1',
      title: '$80: rewrite the store page',
      description: 'A better store page.',
      askUsd: 80,
      status: 'pending' as const,
      proposedByName: 'Ada',
      createdAt: '2026-08-12T09:00:00.000Z',
      marketPairCount: 1,
      markets: [{
        metricName: 'LookPilot revenue (monthly, USD)',
        targetDate: '2026-12',
        resolvesOn: '2026-12-31',
        approvedConsensus: 82_000,
        declinedConsensus: 71_000,
        delta: 11_000,
        approvedMarketId: 'm-approved',
        declinedMarketId: 'm-declined',
        approvedProbability: 0.5,
        approvedLiquidity: 200,
        declinedProbability: 0.5,
        declinedLiquidity: 200,
        rangeMin: 0,
        rangeMax: 500_000,
      }],
    }],
  });
  return { historyFor, workspace, chartRenders: [] as Array<{ marketId: string; seriesLen: number }> };
});

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));

// The chart itself is covered elsewhere; here it is a probe that records what
// the page handed it on every render.
vi.mock('../../components/MarketChart', () => ({
  MarketChart: (props: { series: Array<{ consensus: number | null }>; consensus: number }) => {
    h.chartRenders.push({ marketId: 'current', seriesLen: props.series.length });
    return (
      <div
        data-testid="chart"
        data-series-len={props.series.length}
        // What the page actually handed the chart. A series belongs to ONE
        // market; plotting another market's is the bug these expose.
        data-series={props.series.map(p => p.consensus ?? '').join(',')}
      />
    );
  },
}));

vi.mock('../../lib/api', () => {
  const explicit: Record<string, unknown> = {
    getMarketplaceWorkspace: vi.fn(async () => h.workspace()),
    getPublicMarketHistory: vi.fn(async (_slug: string, marketId: string) => h.historyFor(marketId)),
    getLeaderboard: vi.fn(async () => ({ participants: [] })),
    getProfile: vi.fn(async () => ({ authRole: 'user' })),
    getParticipant: vi.fn(async () => ({ balance: 0 })),
    // Shaped like the real payload: the proxy below answers unknown methods
    // with [], which is wrong for an object-returning endpoint.
    getMarketActivity: vi.fn(async () => ({ consensus: null, positions: [], trades: [] })),
    getFloorComments: vi.fn(async () => []),
  };
  // Anything else the floor's sub-components call resolves empty rather than
  // throwing, so this test stays about the poll and not about their fixtures.
  const api = new Proxy(explicit, {
    get(target, prop: string) {
      if (!(prop in target)) target[prop] = vi.fn(async () => []);
      return target[prop];
    },
  });
  return { api, setActiveWorkspace: vi.fn() };
});

function renderFloor(entries: string[] = ['/lookpilot']) {
  return render(
    <MemoryRouter initialEntries={entries}>
      <Routes><Route path="/:slug" element={<TradePage />} /></Routes>
      <BellStandIn />
    </MemoryRouter>,
  );
}

/**
 * What the notifications bell does when the reader is already standing on the
 * floor: a ROUTER push to a hash on the same path. That is the case the first
 * version got wrong, because pushState fires no hashchange event.
 */
function BellStandIn() {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate('/lookpilot#contract=job-1&comment=c-2')}>
      stand-in notification
    </button>
  );
}

// Imported after the mocks so the page picks them up.
const { TradePage } = await import('../TradePage');
const { settleDayOf } = await import('../../lib/floor-horizons');

beforeEach(() => {
  h.chartRenders.length = 0;
  globalThis.IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
    root = null; rootMargin = ''; thresholds = [];
  } as unknown as typeof IntersectionObserver;
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => { vi.useRealTimers(); });

/** Let the fifteen-second poll fire and its fetches settle. */
async function poll() {
  await act(async () => { await vi.advanceTimersByTimeAsync(15_200); });
}

describe('the poll cadence is 15 seconds', () => {
  // Pinned deliberately (2026-08-20): each tick is ~5 endpoints, so the old
  // 5s cadence made one open tab 60 requests a minute against the database
  // that ran out of connections that evening. Speeding it back up is a
  // decision about database load, not a frontend tweak; see the comment on
  // the poll effect in TradePage.tsx.
  test('nothing refetches at the old 5s mark; everything does by 15s', async () => {
    renderFloor();
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    const { api } = await import('../../lib/api');
    const loads = api.getMarketplaceWorkspace as ReturnType<typeof vi.fn>;
    const afterMount = loads.mock.calls.length;

    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(loads.mock.calls.length).toBe(afterMount);   // old cadence: silent

    await act(async () => { await vi.advanceTimersByTimeAsync(9_500); });
    expect(loads.mock.calls.length).toBeGreaterThan(afterMount);
  });
});

describe('the live poll leaves the view alone', () => {
  test('the declined branch stays open across a poll', async () => {
    renderFloor();
    const row = await screen.findByTitle('rewrite the store page');
    fireEvent.click(row);
    const declined = await screen.findByRole('button', { name: 'if declined' });
    fireEvent.click(declined);
    expect(declined.getAttribute('aria-pressed')).toBe('true');

    await poll();
    await poll();

    expect(screen.getByRole('button', { name: 'if declined' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'if approved' }).getAttribute('aria-pressed')).toBe('false');
  });

  test('the chart is never handed a blanked series while a job is selected', async () => {
    renderFloor();
    fireEvent.click(await screen.findByTitle('rewrite the store page'));
    await waitFor(() => expect(screen.getByTestId('chart').getAttribute('data-series-len')).toBe('2'));

    h.chartRenders.length = 0;
    await poll();
    await poll();

    // A blank would show up as the one-point fallback the page substitutes
    // for an empty history: that single point IS the flash.
    expect(h.chartRenders.length).toBeGreaterThan(0);
    expect(h.chartRenders.every(r => r.seriesLen === 2)).toBe(true);
  });
});

/**
 * A branch market can exist with no liquidity at all (nobody funded the
 * subsidy and the workspace owner could not cover the auto-fund either). It
 * then has no price, and the server refuses every trade against it. The floor
 * used to borrow the baseline's liquidity for display, which made such a
 * branch look tradeable: the owner composed a bet on the Telarchy floor and
 * met "Market has no liquidity. Admin must inject liquidity before trading"
 * at submit (2026-08-15).
 */
describe('an unfunded market does not offer a bet it cannot take', () => {
  const unfundedJob = () => {
    const ws = h.workspace();
    ws.joinAs = 'trader';
    ws.proposals[0].markets[0].approvedLiquidity = 0;
    ws.proposals[0].markets[0].declinedLiquidity = 0;
    ws.proposals[0].markets[0].approvedConsensus = null;
    ws.proposals[0].markets[0].declinedConsensus = null;
    return ws;
  };

  test('the bet buttons are replaced by an explanation', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(unfundedJob() as never);
    renderFloor();

    const row = await screen.findByTitle('rewrite the store page');
    fireEvent.click(row);

    await waitFor(() => expect(screen.getByText(/no market yet/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Bet Higher/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Bet Lower/ })).toBeNull();
  });

  test('a funded job still offers the bet', async () => {
    const { api } = await import('../../lib/api');
    const ws = h.workspace();
    ws.joinAs = 'trader';
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    renderFloor();

    const row = await screen.findByTitle('rewrite the store page');
    fireEvent.click(row);

    await waitFor(() => expect(screen.getByRole('button', { name: /Bet Higher/ })).toBeTruthy());
    expect(screen.queryByText(/no market yet/i)).toBeNull();
  });
});

/**
 * "What can you do?" (owner ask 2026-08-15). The three beats below it say
 * what the floor IS; a visitor who follows that still has to be told what
 * they may DO, and the two sides are not equally obvious: the bet buttons
 * are on screen, while "a stranger can propose paid work here" is the part
 * nobody guesses.
 */
describe('what can you do', () => {
  test('names both sides of the economy', async () => {
    renderFloor();
    await screen.findByRole('heading', { name: 'What can you do?' });
    const section = screen.getByLabelText('What can you do?');
    expect(within(section).getByText('Trade')).toBeTruthy();
    expect(within(section).getByText('Do a contract')).toBeTruthy();
    // The contract side has to say the money is real, or it reads as points.
    expect(within(section).getByText(/real money/i)).toBeTruthy();
  });

  test('each card sends the reader to the control it names', async () => {
    const into = vi.fn();
    Element.prototype.scrollIntoView = into;
    const ws = h.workspace();
    ws.joinAs = 'trader';
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);

    const { container } = renderFloor();
    await screen.findByRole('heading', { name: 'What can you do?' });

    fireEvent.click(screen.getByText('Do a contract'));
    expect(into).toHaveBeenCalled();
    expect(container.querySelector('.pubws-rail--right')).toBeTruthy();

    into.mockClear();
    fireEvent.click(screen.getByText('Trade'));
    expect(into).toHaveBeenCalled();
  });

  test('the floor calls them contracts, never jobs', async () => {
    const { container } = renderFloor();
    await screen.findByRole('heading', { name: 'What can you do?' });
    // "Top contractors" is the rail's own heading, so the thing they do is a
    // contract; "jobs" alongside it was two words for one idea.
    expect(container.textContent).not.toMatch(/\bjobs?\b/i);
  });
});

test('the page explains, then asks, then offers the owner door', async () => {
  const { container } = renderFloor();
  await screen.findByRole('heading', { name: 'What can you do?' });
  const order = [...container.querySelectorAll('.pubws-about-head, .pubws-do-head, .pubws-setup-lead')]
    .map(n => (n.textContent ?? '').slice(0, 16));
  expect(order).toEqual(['What is this?', 'What can you do?', 'Want this for yo']);
});

/**
 * A selected contract must show its branch market's positions and trades,
 * not just the conversation (owner report 2026-08-15: an external user's
 * contract had a real trade on the approved branch and the panel rendered
 * "Comments (0)" alone).
 */
describe('the activity panel under a selected contract', () => {
  test('asks for the branch market, not only the contract thread', async () => {
    const { api } = await import('../../lib/api');
    const ws = h.workspace();
    ws.joinAs = 'trader';
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    vi.mocked(api.getMarketActivity).mockClear();

    renderFloor();
    const row = await screen.findByTitle('rewrite the store page');
    fireEvent.click(row);

    // The comment thread stays keyed to the contract; the activity read is
    // keyed to the branch market on screen.
    await waitFor(() => expect(vi.mocked(api.getMarketActivity)).toHaveBeenCalledWith('lookpilot', 'm-approved'));
    expect(vi.mocked(api.getFloorComments)).toHaveBeenCalledWith('lookpilot', expect.objectContaining({ proposalId: 'job-1' }));
  });

  // The conversation outlives the decision (owner ask 2026-08-20,
  // docs/vision.md): hiding the whole trade section on a decided contract
  // buried its thread exactly when the outcome is worth discussing.
  test('a decided contract keeps its comment thread, without the bet verbs', async () => {
    const { api } = await import('../../lib/api');
    const ws = h.workspace();
    ws.joinAs = 'trader';
    ws.proposals[0].status = 'approved' as never;
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    vi.mocked(api.getFloorComments).mockClear();

    renderFloor();
    fireEvent.click(await screen.findByTitle('rewrite the store page'));

    await waitFor(() => expect(vi.mocked(api.getFloorComments)).toHaveBeenCalledWith('lookpilot', expect.objectContaining({ proposalId: 'job-1' })));
    expect(screen.queryByRole('button', { name: 'Bet Higher ↑' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bet Lower ↓' })).toBeNull();
  });

  test('follows the branch toggle', async () => {
    const { api } = await import('../../lib/api');
    const ws = h.workspace();
    ws.joinAs = 'trader';
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);

    renderFloor();
    fireEvent.click(await screen.findByTitle('rewrite the store page'));
    await waitFor(() => expect(vi.mocked(api.getMarketActivity)).toHaveBeenCalledWith('lookpilot', 'm-approved'));

    fireEvent.click(await screen.findByRole('button', { name: 'if declined' }));
    await waitFor(() => expect(vi.mocked(api.getMarketActivity)).toHaveBeenCalledWith('lookpilot', 'm-declined'));
  });
});

/**
 * When a market settles, in words. A weekly horizon printed nothing at all
 * until 2026-08-16, so its chart never said when it lands, and on Telarchy's
 * own floor, where two metrics share a name once the "(end of 2026)" tail is
 * stripped, that date is the only thing telling the two charts apart.
 */
describe('settleDayOf', () => {
  test('an ISO week settles on its Sunday', () => {
    expect(settleDayOf('2026-W34')).toBe('23 August 2026');
    expect(settleDayOf('2026-W33')).toBe('16 August 2026');
    expect(settleDayOf('2026-W01')).toBe('4 January 2026');
  });

  test('a year, a month and a day are unchanged', () => {
    expect(settleDayOf('2026')).toBe('31 December 2026');
    expect(settleDayOf('2026-08')).toBe('31 August 2026');
    expect(settleDayOf('2026-08-05')).toBe('5 August 2026');
  });

  test('an unrecognised shape says nothing rather than guessing', () => {
    expect(settleDayOf('whenever')).toBeNull();
  });
});

/**
 * Which market the floor shows: the furthest-resolving one, and only it.
 *
 * The second clock was removed on 2026-08-17 ("lets remove the this week
 * option completely, its just too confusing"). A workspace can still have
 * other open baseline markets, and the API still ships them, so what these
 * pin is that the floor picks the right one and offers no way to reach the
 * others: no selector, one chart, one ticket. LookPilot is "net 2026 at
 * $78,571", not "$213 so far this week", and every other surface leads with
 * the same number.
 */
describe('the one horizon', () => {
  const twoMarkets = () => {
    const ws = h.workspace();
    ws.markets = [
      { marketId: 'm-week', metricId: 'metric-w', metricName: 'LookPilot revenue this week (USD)',
        targetDate: '2026-W34', resolvesOn: '2026-08-24T00:00:00Z', consensus: 213,
        probability: 0.5, liquidity: 200, rangeMin: 0, rangeMax: 8000 },
      { marketId: 'm-hero', metricId: 'metric-1', metricName: 'LookPilot net 2026 (USD)',
        targetDate: '2026-12', resolvesOn: '2026-12-31T00:00:00Z', consensus: 78_571,
        probability: 0.5, liquidity: 200, rangeMin: 0, rangeMax: 150_000 },
    ];
    return ws;
  };

  test('the headline is the furthest-resolving market, and there is no selector', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(twoMarkets() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-price')?.textContent).toBeTruthy());
    expect(container.querySelector('.pubws-price')!.textContent).toContain('78');
    // The removal itself: a second open market must not put a way back to the
    // second clock on the page.
    expect(container.querySelectorAll('.pubws-horizon')).toHaveLength(0);
    expect(container.querySelector('.pubws-horizon-note')).toBeNull();
  });

  test('a workspace with one market is unaffected', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(h.workspace() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-price')?.textContent).toBeTruthy());
    expect(container.querySelector('.pubws-price')!.textContent).toContain('80');
  });
});

test('the know section draws no metric chart', async () => {
  const { api } = await import('../../lib/api');
  const ws = h.workspace();
  ws.markets = [
    { marketId: 'm-week', metricId: 'metric-w', metricName: 'LookPilot revenue this week (USD)',
      targetDate: '2026-W34', resolvesOn: '2026-08-24T00:00:00Z', consensus: 213,
      probability: 0.5, liquidity: 200, rangeMin: 0, rangeMax: 8000 },
    { marketId: 'm-hero', metricId: 'metric-1', metricName: 'LookPilot net 2026 (USD)',
      targetDate: '2026-12', resolvesOn: '2026-12-31T00:00:00Z', consensus: 78_571,
      probability: 0.5, liquidity: 200, rangeMin: 0, rangeMax: 150_000 },
  ];
  ws.horizonHistories = [
    { marketId: 'm-week', metricName: 'LookPilot revenue this week (USD)', targetDate: '2026-W34',
      description: 'This week only.', points: [{ at: '2026-08-18T09:00:00Z', value: 120 }] },
    { marketId: 'm-hero', metricName: 'LookPilot net 2026 (USD)', targetDate: '2026-12',
      description: 'The year.', points: [{ at: '2026-08-15T09:00:00Z', value: 45_339 }] },
  ];
  vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);

  const { container } = renderFloor();
  // The metric-trajectory charts were removed from the floor entirely (owner
  // direction 2026-08-18): the section shows the definition and nothing else,
  // however many markets are open. The history fields stay in the API.
  await waitFor(() => expect(container.querySelector('.pubws-know')).toBeTruthy());
  expect(container.querySelectorAll('.pubws-know .pubws-settle').length).toBe(0);
  expect(container.querySelector('.pubws-know .mchart-calllabel')).toBeNull();
});

test('the workspace name heads the page', async () => {
  const { api } = await import('../../lib/api');
  vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(h.workspace() as never);
  const { container } = renderFloor();
  // Owner direction 2026-08-18: with the settle date gone from the headline,
  // the name at the top is what says whose floor this is.
  await waitFor(() => expect(container.querySelector('.pubws-ws-name')).toBeTruthy());
  expect(container.querySelector('.pubws-ws-name')!.textContent).toBe(h.workspace().name);
  // The company is the page, so its name is the page's h1 and the metric
  // name is only the caption over the number (owner direction 2026-08-18).
  expect(container.querySelector('.pubws-ws-name')!.tagName).toBe('H1');
  expect(container.querySelectorAll('h1').length).toBe(1);
  // And it does not say the company twice: the caption is what the number
  // measures, with the name it already carries overhead stripped off, and the
  // day it settles after it (owner ask 2026-08-20, so the arrows have
  // something to tell two clocks apart by).
  expect(container.querySelector('.pubws-instrument-label')!.textContent).toBe('revenue @ 31 Dec');
});

test('the workspace description is the company tagline, and is optional', async () => {
  const { api } = await import('../../lib/api');
  // What the business sells, said once under its name: without it the floor
  // opens with a number about a word the visitor has never seen.
  vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(
    { ...h.workspace(), description: 'Webcam head tracker for sims.' } as never,
  );
  const first = renderFloor();
  await waitFor(() => expect(first.container.querySelector('.pubws-ws-tagline')).toBeTruthy());
  expect(first.container.querySelector('.pubws-ws-tagline')!.textContent)
    .toBe('Webcam head tracker for sims.');
  first.unmount();

  // A workspace that never wrote one gets no empty line under its name.
  vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(h.workspace() as never);
  const second = renderFloor();
  await waitFor(() => expect(second.container.querySelector('.pubws-ws-name')).toBeTruthy());
  expect(second.container.querySelector('.pubws-ws-tagline')).toBeNull();
});

/**
 * The chart on screen plots the market on screen./**
 * The chart on screen plots the market on screen.
 *
 * `marketHistory` in the payload is ONE market's price replay (the primary),
 * and the page used to draw it under whichever horizon was selected. On the
 * weekly view that meant the year's $77k line followed by a drop to the
 * week's $213 call, with "-$73,387 since open" underneath (owner report
 * 2026-08-17: "a market showing 78k and then suddenly dropping to 213?").
 */
describe('the price series belongs to the market on screen', () => {
  const payload = () => {
    const ws = h.workspace();
    ws.markets = [
      { marketId: 'm-week', metricId: 'metric-w', metricName: 'LookPilot revenue this week (USD)',
        targetDate: '2026-W34', resolvesOn: '2026-08-24T00:00:00Z', consensus: 213,
        probability: 0.5, liquidity: 200, rangeMin: 0, rangeMax: 8000 },
      { marketId: 'm-hero', metricId: 'metric-1', metricName: 'LookPilot net 2026 (USD)',
        targetDate: '2026-12', resolvesOn: '2026-12-31T00:00:00Z', consensus: 78_571,
        probability: 0.5, liquidity: 200, rangeMin: 0, rangeMax: 150_000 },
    ];
    // The inline series names its market, the way the server sends it.
    (ws as Record<string, unknown>).marketHistory = [
      { at: '2026-08-11T06:00:00.000Z', consensus: 73_600 },
      { at: '2026-08-13T17:00:00.000Z', consensus: 78_571 },
    ];
    (ws as Record<string, unknown>).marketHistoryMarketId = 'm-hero';
    return ws;
  };

  const series = (c: HTMLElement) => c.querySelector('[data-testid="chart"]')!.getAttribute('data-series');

  test('the inline series is drawn, with no extra request', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(payload() as never);
    vi.mocked(api.getPublicMarketHistory).mockClear();
    const { container } = renderFloor();
    await waitFor(() => expect(series(container)).toBe('73600,78571'));
    expect(vi.mocked(api.getPublicMarketHistory)).not.toHaveBeenCalledWith('lookpilot', 'm-hero');
  });

  test('never the other market\'s numbers, and "since open" is this market\'s open', async () => {
    // The cliff this guards: the page once drew the year's 73,600 -> 78,571
    // line and then dropped to the week's 213 call, with "-$73,387 since
    // open" underneath (owner report 2026-08-17). With one horizon the mix is
    // structurally impossible, so what is pinned is the number itself.
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(payload() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-delta-chip')?.textContent).toContain('4,971'));
    expect(series(container)).not.toContain('213');
  });
});

/**
 * The headline must not wander under the reader.
 *
 * The floor rebuilds its market list from a five-second reload, and the hourly
 * market refresh can add or retire a baseline market. Picked by array
 * position, the headline then re-points at a different market under the
 * reader, and the ticket trades whatever is showing. It is picked by
 * resolution date instead, in one place.
 */
describe('which market is the headline, across a poll', () => {
  const floor = () => {
    const ws = h.workspace();
    ws.markets = [
      { marketId: 'm-week', metricId: 'metric-w', metricName: 'Revenue this week (USD)',
        targetDate: '2026-W34', resolvesOn: '2026-08-24T00:00:00Z', consensus: 213,
        probability: 0.5, liquidity: 200, rangeMin: 0, rangeMax: 8000 },
      { marketId: 'm-hero', metricId: 'metric-1', metricName: 'Net 2026 (USD)',
        targetDate: '2026-12', resolvesOn: '2027-01-01T00:00:00Z', consensus: 78_571,
        probability: 0.5, liquidity: 200, rangeMin: 0, rangeMax: 150_000 },
    ];
    return ws;
  };

  test('a nearer market appearing mid-poll does not take the headline', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(floor() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-price')!.textContent).toContain('78'));

    // The hourly refresh opens a monthly market between the two. Inserted at
    // index 1, it is exactly what a position-based pick would grab.
    const withMonthly = floor();
    withMonthly.markets = [
      withMonthly.markets[0],
      { marketId: 'm-month', metricId: 'metric-1', metricName: 'Net 2026 (USD)',
        targetDate: '2026-09', resolvesOn: '2026-10-01T00:00:00Z', consensus: 50_000,
        probability: 0.5, liquidity: 200, rangeMin: 0, rangeMax: 150_000 },
      withMonthly.markets[1],
    ];
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(withMonthly as never);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_200); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(container.querySelector('.pubws-price')!.textContent).toContain('78');
  });

  test('a market resolving later than the headline does take it over', async () => {
    // The other half of the rule. "Furthest-resolving" is the definition, so a
    // 2027 market becoming the headline is correct, not a regression.
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(floor() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-price')!.textContent).toContain('78'));

    const with2027 = floor();
    with2027.markets = [
      ...with2027.markets,
      { marketId: 'm-2027', metricId: 'metric-1', metricName: 'Net 2027 (USD)',
        targetDate: '2027-12', resolvesOn: '2028-01-01T00:00:00Z', consensus: 120_000,
        probability: 0.5, liquidity: 200, rangeMin: 0, rangeMax: 250_000 },
    ];
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(with2027 as never);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_200); });
    await waitFor(() => expect(container.querySelector('.pubws-price')!.textContent).toContain('120'));
  });

  test('a retired market leaves the headline on whatever is left', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(floor() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-price')!.textContent).toContain('78'));

    const soloWeek = h.workspace();
    soloWeek.markets = [floor().markets[0]];
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(soloWeek as never);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_200); });
    await waitFor(() => expect(container.querySelector('.pubws-price')!.textContent).toContain('213'));
  });
});

/**
 * A notification points at one thing and the floor has to land on it.
 *
 * The regression this pins (owner report 2026-08-19, "I click it and it still
 * doesn't highlight"): clicking the bell while already on the floor moves the
 * hash through pushState, which does NOT fire hashchange, so a listener-only
 * implementation did nothing in the most common case of all.
 */
describe('a notification link lands on what it names', () => {
  test('an in-app click selects the contract and points at the comment', async () => {
    renderFloor();
    await screen.findByTitle('rewrite the store page');
    // The floor starts on the baseline market, not on the contract.
    expect(screen.queryByRole('button', { name: 'if declined' })).toBeNull();

    fireEvent.click(screen.getByText('stand-in notification'));

    // The contract is open: its branch toggle only exists when one is.
    // (What the floor then does with the comment id is FloorComments'
    // contract, pinned in its own spec; this one is about the hash arriving
    // at all, which is the half that was broken.)
    expect(await screen.findByRole('button', { name: 'if declined' })).toBeTruthy();
  });

  test('a pasted link works the same on first paint', async () => {
    renderFloor(['/lookpilot#contract=job-1']);
    expect(await screen.findByRole('button', { name: 'if declined' })).toBeTruthy();
  });
});

/**
 * Otto is ON the floor.
 *
 * The regression this pins (owner report 2026-08-20, "where is otto i dont
 * see him"): the component, its styles and its endpoint all shipped, and
 * nothing rendered it. main went red on an import that outran its component,
 * the fix removed the import AND the render, and the render never came back.
 * A component nobody mounts is indistinguishable from a component nobody
 * wrote, and only the page can tell you which one you have.
 */
describe('the floor carries Otto', () => {
  test('his dock is on the page', async () => {
    renderFloor();
    expect(await screen.findByRole('button', { name: /ask otto about lookpilot/i })).toBeTruthy();
  });
});
