import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * The floor's live poll must not touch what the viewer is looking at.
 *
 * The page reloads the workspace every five seconds. That reload used to be a
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

function renderFloor() {
  return render(
    <MemoryRouter initialEntries={['/lookpilot']}>
      <Routes><Route path="/:slug" element={<TradePage />} /></Routes>
    </MemoryRouter>,
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

/** Let the five-second poll fire and its fetches settle. */
async function poll() {
  await act(async () => { await vi.advanceTimersByTimeAsync(5200); });
}

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
 * Which clock the floor opens on: the DECISION horizon (owner direction
 * 2026-08-16). LookPilot is "net 2026 at $78,571", not "$213 so far this
 * week", and every other surface leads with the same number, so a visitor
 * arriving from a card or a shared link is not shown a different headline.
 */
describe('the primary horizon', () => {
  const twoClocks = () => {
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

  test('lists the far horizon first, and opens on it', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(twoClocks() as never);
    const { container } = renderFloor();

    await waitFor(() => expect(container.querySelector('.pubws-horizon.is-active')).toBeTruthy());
    // Owner direction 2026-08-16: yearly first, then weekly. The payload
    // still ships soonest-first, so this is a display order.
    const opts = [...container.querySelectorAll('.pubws-horizon')];
    expect(opts).toHaveLength(2);
    expect(opts[0].className).toContain('is-active');
    expect(opts[1].className).not.toContain('is-active');
  });

  test('the headline is the far horizon\'s number', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(twoClocks() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-price')?.textContent).toBeTruthy());
    expect(container.querySelector('.pubws-price')!.textContent).toContain('78');
  });

  test('the near horizon is still one click away', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(twoClocks() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelectorAll('.pubws-horizon')).toHaveLength(2));

    fireEvent.click(container.querySelectorAll('.pubws-horizon')[1]);
    await waitFor(() => expect(container.querySelector('.pubws-price')!.textContent).toContain('213'));
  });

  test('a one-clock workspace is unaffected', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(h.workspace() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-price')?.textContent).toBeTruthy());
    expect(container.querySelector('.pubws-price')!.textContent).toContain('80');
  });
});

test('the charts follow the selector: year first, week second', async () => {
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
  await waitFor(() => expect(container.querySelectorAll('.pubws-know .pubws-settle').length).toBe(2));
  const captions = [...container.querySelectorAll('.pubws-know .pubws-settle')].map(n => n.textContent ?? '');
  expect(captions[0]).toContain('net 2026');
  expect(captions[1]).toContain('this week');
});

/**
 * The chart on screen plots the market on screen.
 *
 * `marketHistory` in the payload is ONE market's price replay (the primary),
 * and the page used to draw it under whichever horizon was selected. On the
 * weekly view that meant the year's $77k line followed by a drop to the
 * week's $213 call, with "-$73,387 since open" underneath (owner report
 * 2026-08-17: "a market showing 78k and then suddenly dropping to 213?").
 */
describe('per-horizon price history', () => {
  const twoClockPayload = () => {
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
  const weekSeries = [
    { at: '2026-08-17T09:00:00.000Z', consensus: 200 },
    { at: '2026-08-17T11:00:00.000Z', consensus: 213 },
  ];

  const series = (c: HTMLElement) => c.querySelector('[data-testid="chart"]')!.getAttribute('data-series');

  test('the decision view draws the inline series, with no extra request', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(twoClockPayload() as never);
    vi.mocked(api.getPublicMarketHistory).mockClear();
    const { container } = renderFloor();
    await waitFor(() => expect(series(container)).toBe('73600,78571'));
    expect(vi.mocked(api.getPublicMarketHistory)).not.toHaveBeenCalledWith('lookpilot', 'm-hero');
  });

  test('switching to the pulse draws the PULSE market\'s own prices', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(twoClockPayload() as never);
    vi.mocked(api.getPublicMarketHistory).mockImplementation(async (_slug: string, marketId: string) =>
      (marketId === 'm-week' ? weekSeries : []) as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelectorAll('.pubws-horizon')).toHaveLength(2));

    fireEvent.click(container.querySelectorAll('.pubws-horizon')[1]);
    await waitFor(() => expect(series(container)).toBe('200,213'));
    // Never the year's numbers: that mixture is what made the cliff.
    expect(series(container)).not.toContain('73600');
    expect(series(container)).not.toContain('78571');
  });

  test('before the pulse series lands, the chart holds the live call alone', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(twoClockPayload() as never);
    // A request that never resolves: the gap the old fallback filled with
    // another market's series.
    vi.mocked(api.getPublicMarketHistory).mockImplementation(() => new Promise(() => {}) as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelectorAll('.pubws-horizon')).toHaveLength(2));

    fireEvent.click(container.querySelectorAll('.pubws-horizon')[1]);
    await waitFor(() => expect(container.querySelector('.pubws-price')!.textContent).toContain('213'));
    expect(series(container)).toBe('213');
  });

  test('"since open" is measured against the same market\'s open', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(twoClockPayload() as never);
    vi.mocked(api.getPublicMarketHistory).mockImplementation(async (_slug: string, marketId: string) =>
      (marketId === 'm-week' ? weekSeries : []) as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-delta-chip')?.textContent).toContain('4,971'));

    fireEvent.click(container.querySelectorAll('.pubws-horizon')[1]);
    // 213 - 200, not 213 - 73,600.
    await waitFor(() => expect(container.querySelector('.pubws-delta-chip')?.textContent).toContain('13'));
    expect(container.querySelector('.pubws-delta-chip')!.textContent).not.toContain('73');
  });

  test('the caption describes the clock on screen', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(twoClockPayload() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-horizon-note')?.textContent).toBeTruthy());
    // "end of 2026" is the decision, so the note must not call it speed.
    expect(container.querySelector('.pubws-horizon-note')!.textContent).toBe('the number I fund on');

    fireEvent.click(container.querySelectorAll('.pubws-horizon')[1]);
    await waitFor(() =>
      expect(container.querySelector('.pubws-horizon-note')!.textContent).toBe('speed, not the decision'));
  });
});

test('a selected contract does not repaint the baseline chart with a branch price', async () => {
  // The horizon charts are captioned "actual so far, and where the market sees
  // it landing" for the UNCONDITIONAL number. With a contract selected the
  // live call belongs to the branch being traded, and painting it here showed
  // $78,772 (a branch) on a chart about $78,571 (owner report 2026-08-17).
  const { api } = await import('../../lib/api');
  const ws = h.workspace();
  ws.markets = [{
    marketId: 'm-hero', metricId: 'metric-1', metricName: 'LookPilot net 2026 (USD)',
    targetDate: '2026-12', resolvesOn: '2027-01-01T00:00:00Z', consensus: 78_571,
    probability: 0.5, liquidity: 200, rangeMin: 0, rangeMax: 150_000,
  }];
  (ws as Record<string, unknown>).horizonHistories = [{
    marketId: 'm-hero', metricName: 'LookPilot net 2026 (USD)', targetDate: '2026-12',
    periodStart: '2026-12-01T00:00:00.000Z', description: 'The year.',
    points: [{ at: '2026-08-16T09:00:00Z', value: 45_339 }],
  }];
  ws.proposals[0].markets = [{
    ...ws.proposals[0].markets[0],
    metricName: 'LookPilot net 2026 (USD)', targetDate: '2026-12', resolvesOn: '2027-01-01T00:00:00Z',
    approvedConsensus: 78_772, declinedConsensus: 78_571, delta: 201,
    rangeMin: 0, rangeMax: 150_000,
  }];
  vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);

  const { container } = renderFloor();
  await waitFor(() => expect(container.querySelector('.pubws-know .mchart-calllabel')).toBeTruthy());
  const call = () => container.querySelector('.pubws-know .mchart-calllabel')!.textContent;
  expect(call()).toBe('$78,571');

  fireEvent.click(container.querySelector('.pubws-ballot-row')!);
  // The headline follows the branch; the metric chart stays on the baseline.
  await waitFor(() => expect(container.querySelector('.pubws-price')!.textContent).toContain('78,772'));
  expect(call()).toBe('$78,571');
});
