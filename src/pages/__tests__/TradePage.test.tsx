import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

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
    signupCredits: 100,
    metricCount: 1,
    openMarketCount: 1,
    participantCount: 3,
    proposalStats: { total: 1, pending: 1, approved: 0, declined: 0 },
    markets: [
      {
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
      },
    ],
    marketHistory: historyFor('m-hero'),
    // The payload names the market its inline replay belongs to, so the page
    // never has to guess which chart it fits.
    marketHistoryMarketId: 'm-hero',
    proposals: [
      {
        id: 'job-1',
        title: '$80: rewrite the store page',
        description: 'A better store page.',
        askUsd: 80,
        status: 'pending' as const,
        proposedByName: 'Ada',
        createdAt: '2026-08-12T09:00:00.000Z',
        marketPairCount: 1,
        markets: [
          {
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
          },
        ],
      },
    ],
  });
  return { historyFor, workspace, chartRenders: [] as Array<{ marketId: string; seriesLen: number }> };
});

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));

// The chart itself is covered elsewhere; here it is a probe that records what
// the page handed it on every render.
vi.mock('../../components/MarketChart', () => ({
  // NumberChart (not mocked) imports the shared geometry from this module.
  GEOM: {
    wide: { W: 720, PAD_L: 46, PAD_R: 58, H: 260 },
    compact: { W: 400, PAD_L: 40, PAD_R: 50, H: 300 },
  },
  MarketChart: (props: {
    series: Array<{ consensus: number | null }>;
    consensus: number;
    corner?: unknown;
    center?: unknown;
  }) => {
    h.chartRenders.push({ marketId: 'current', seriesLen: props.series.length });
    return (
      <div
        data-testid="chart"
        data-series-len={props.series.length}
        // What the page actually handed the chart. A series belongs to ONE
        // market; plotting another market's is the bug these expose.
        data-series={props.series.map(p => p.consensus ?? '').join(',')}
      >
        {/* The control row rides in as props; the row's own tests below
            need it rendered, the probe tests ignore it. */}
        {props.corner as React.ReactNode}
        {props.center as React.ReactNode}
      </div>
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
      <Routes>
        <Route path="/marketplace/:workspaceId" element={<TradePage />} />
        <Route path="/:slug" element={<TradePage />} />
      </Routes>
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
  return <button onClick={() => navigate('/lookpilot#proposal=job-1&comment=c-2')}>stand-in notification</button>;
}

// Imported after the mocks so the page picks them up.
const { TradePage } = await import('../TradePage');
const { settleDayOf } = await import('../../lib/floor-horizons');

beforeEach(() => {
  h.chartRenders.length = 0;
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
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // Pin the clock. The fixtures name real dates ('2026-W34', '2026-09')
  // and the assertions name the words the floor renders for them, and
  // both of those are relative to today: on 2026-09-01 the September
  // market stopped reading '30 Sep' and started reading 'this month',
  // which turned main red on a day nobody had pushed anything
  // (bug hunt 2026-08-31 flagged the class; the month boundary found
  // these two files first).
  vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

/** Let the fifteen-second poll fire and its fetches settle. */
async function poll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_200);
  });
}

describe('the poll cadence is 15 seconds', () => {
  // Pinned deliberately (2026-08-20): each tick is ~5 endpoints, so the old
  // 5s cadence made one open tab 60 requests a minute against the database
  // that ran out of connections that evening. Speeding it back up is a
  // decision about database load, not a frontend tweak; see the comment on
  // the poll effect in TradePage.tsx.
  test('nothing refetches at the old 5s mark; everything does by 15s', async () => {
    renderFloor();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    const { api } = await import('../../lib/api');
    const loads = api.getMarketplaceWorkspace as ReturnType<typeof vi.fn>;
    const afterMount = loads.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(loads.mock.calls.length).toBe(afterMount); // old cadence: silent

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_500);
    });
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

  test('a bet verb opens the ticket inline, not in a modal', async () => {
    // Owner ask 2026-08-28: composing the bet must not cover the charts,
    // because the composed bet's ghost draws on the market chart above.
    const { api } = await import('../../lib/api');
    const ws = h.workspace();
    ws.joinAs = 'trader';
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    const { container } = renderFloor();

    fireEvent.click(await screen.findByRole('button', { name: /Bet Higher/ }));
    await waitFor(() => expect(container.querySelector('.pubws-ticket-inline')).toBeTruthy());
    expect(document.querySelector('.floor-modal-overlay')).toBeNull();
    // The ticket sits inside the floor's action section, under the verbs.
    expect(container.querySelector('.pubws-act .pubws-ticket-inline')).toBeTruthy();
  });
});

/**
 * "What can you do?" (owner ask 2026-08-15). The three beats below it say
 * what the floor IS; a visitor who follows that still has to be told what
 * they may DO, and the two sides are not equally obvious: the bet buttons
 * are on screen, while "a stranger can propose paid work here" is the part
 * nobody guesses.
 */
describe('the floor closes in two lines', () => {
  test('THE PAGE STOPS EXPLAINING ITSELF FOUR TIMES', async () => {
    const { container } = renderFloor();
    await screen.findByLabelText('New here?');
    // A floor answered "what is this" in its market definition, in three
    // numbered beats and in two cards, one under the other. The market above
    // is the explanation; what is left is the part it cannot show.
    expect(container.querySelector('.pubws-about')).toBeNull();
    expect(container.querySelector('.pubws-do')).toBeNull();
    expect(container.querySelector('.pubws-know')).toBeTruthy();
  });

  test('the half nobody guesses survives: paid work, in real money', async () => {
    renderFloor();
    const close = await screen.findByLabelText('New here?');
    // Watching a market trade never tells a stranger they may offer to do
    // the work and be paid for it, so that line cannot go with the cards.
    expect(within(close).getByText(/offer to do the work and name your price/i)).toBeTruthy();
    expect(within(close).getByText(/real money/i)).toBeTruthy();
  });

  test('the full explanation is a link, not a section', async () => {
    renderFloor();
    const close = await screen.findByLabelText('New here?');
    const how = within(close).getByRole('link', { name: /how it works/i });
    expect(how.getAttribute('href')).toBe('/forecast');
  });

  test('and the proposal line still scrolls to the control it names', async () => {
    const into = vi.fn();
    Element.prototype.scrollIntoView = into;
    const ws = h.workspace();
    ws.joinAs = 'trader';
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);

    const { container } = renderFloor();
    const close = await screen.findByLabelText('New here?');
    fireEvent.click(within(close).getByText(/offer a proposal/i));
    expect(into).toHaveBeenCalled();
    expect(container.querySelector('.pubws-rail--right')).toBeTruthy();
  });

  test('the floor calls them proposals, never jobs', async () => {
    const { container } = renderFloor();
    await screen.findByLabelText('New here?');
    expect(container.textContent).not.toMatch(/\bjobs?\b/i);
  });
});

test('the page explains, then asks, then offers the owner door', async () => {
  const { container } = renderFloor();
  await screen.findByLabelText('New here?');
  const order = [...container.querySelectorAll('.pubws-know-head, .pubws-close-line, .pubws-setup-lead')].map(n =>
    (n.textContent ?? '').slice(0, 16),
  );
  // Two "know" blocks already: the market's own definition, then the
  // company's. Those are the explanation; the closing lines say only what
  // they cannot.
  expect(order).toEqual([
    'What is this mar',
    'What is LookPilo',
    'New here? Telarc',
    'You can also off',
    'Want this for yo',
  ]);
});

/**
 * A selected proposal must show its branch market's positions and trades,
 * not just the conversation (owner report 2026-08-15: an external user's
 * proposal had a real trade on the approved branch and the panel rendered
 * "Comments (0)" alone).
 */
describe('the activity panel under a selected proposal', () => {
  test('asks for the branch market, not only the proposal thread', async () => {
    const { api } = await import('../../lib/api');
    const ws = h.workspace();
    ws.joinAs = 'trader';
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    vi.mocked(api.getMarketActivity).mockClear();

    renderFloor();
    const row = await screen.findByTitle('rewrite the store page');
    fireEvent.click(row);

    // The comment thread stays keyed to the proposal; the activity read is
    // keyed to the branch market on screen.
    await waitFor(() => expect(vi.mocked(api.getMarketActivity)).toHaveBeenCalledWith('lookpilot', 'm-approved'));
    expect(vi.mocked(api.getFloorComments)).toHaveBeenCalledWith(
      'lookpilot',
      expect.objectContaining({ proposalId: 'job-1' }),
    );
  });

  // The conversation outlives the decision (owner ask 2026-08-20,
  // docs/vision.md): hiding the whole trade section on a decided proposal
  // buried its thread exactly when the outcome is worth discussing.
  test('a decided proposal keeps its comment thread, without the bet verbs', async () => {
    const { api } = await import('../../lib/api');
    const ws = h.workspace();
    ws.joinAs = 'trader';
    ws.proposals[0].status = 'approved' as never;
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    vi.mocked(api.getFloorComments).mockClear();

    renderFloor();
    fireEvent.click(await screen.findByTitle('rewrite the store page'));

    await waitFor(() =>
      expect(vi.mocked(api.getFloorComments)).toHaveBeenCalledWith(
        'lookpilot',
        expect.objectContaining({ proposalId: 'job-1' }),
      ),
    );
    expect(screen.queryByRole('button', { name: /Bet Higher/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Bet Lower/ })).toBeNull();
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
      {
        marketId: 'm-week',
        metricId: 'metric-w',
        metricName: 'LookPilot revenue this week (USD)',
        targetDate: '2026-W34',
        resolvesOn: '2026-08-24T00:00:00Z',
        consensus: 213,
        probability: 0.5,
        liquidity: 200,
        rangeMin: 0,
        rangeMax: 8000,
      },
      {
        marketId: 'm-hero',
        metricId: 'metric-1',
        metricName: 'LookPilot net 2026 (USD)',
        targetDate: '2026-12',
        resolvesOn: '2026-12-31T00:00:00Z',
        consensus: 78_571,
        probability: 0.5,
        liquidity: 200,
        rangeMin: 0,
        rangeMax: 150_000,
      },
    ];
    return ws;
  };

  test('the headline is the furthest-resolving market, and there is no selector', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(twoMarkets() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-stat--call .pubws-price')?.textContent).toBeTruthy());
    expect(container.querySelector('.pubws-stat--call .pubws-price')!.textContent).toContain('78');
    // The removal itself: a second open market must not put a way back to the
    // second clock on the page.
    expect(container.querySelectorAll('.pubws-horizon')).toHaveLength(0);
    expect(container.querySelector('.pubws-horizon-note')).toBeNull();
  });

  test('a workspace with one market is unaffected', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(h.workspace() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-stat--call .pubws-price')?.textContent).toBeTruthy());
    expect(container.querySelector('.pubws-stat--call .pubws-price')!.textContent).toContain('80');
  });
});

test('the know section draws no metric chart', async () => {
  const { api } = await import('../../lib/api');
  const ws = h.workspace();
  ws.markets = [
    {
      marketId: 'm-week',
      metricId: 'metric-w',
      metricName: 'LookPilot revenue this week (USD)',
      targetDate: '2026-W34',
      resolvesOn: '2026-08-24T00:00:00Z',
      consensus: 213,
      probability: 0.5,
      liquidity: 200,
      rangeMin: 0,
      rangeMax: 8000,
    },
    {
      marketId: 'm-hero',
      metricId: 'metric-1',
      metricName: 'LookPilot net 2026 (USD)',
      targetDate: '2026-12',
      resolvesOn: '2026-12-31T00:00:00Z',
      consensus: 78_571,
      probability: 0.5,
      liquidity: 200,
      rangeMin: 0,
      rangeMax: 150_000,
    },
  ];
  ws.horizonHistories = [
    {
      marketId: 'm-week',
      metricName: 'LookPilot revenue this week (USD)',
      targetDate: '2026-W34',
      description: 'This week only.',
      points: [{ at: '2026-08-18T09:00:00Z', value: 120 }],
    },
    {
      marketId: 'm-hero',
      metricName: 'LookPilot net 2026 (USD)',
      targetDate: '2026-12',
      description: 'The year.',
      points: [{ at: '2026-08-15T09:00:00Z', value: 45_339 }],
    },
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
  // The caption is what the number measures, with the name it already
  // carries overhead stripped off, and the day it settles is the line under
  // it (owner ask 2026-08-25, two steppers).
  expect(container.querySelector('.pubws-instrument-label')!.textContent).toBe('revenue');
  expect(container.querySelector('.pubws-instrument-date')!.textContent).toBe('31 Dec');
  // And under the pickers, the same cell stated as the market's own
  // question (owner ask 2026-08-28, both stay). One metric and one date on
  // this floor, so neither word of the sentence is a control.
  expect(container.querySelector('.pubws-instrument-ask')!.textContent).toBe(
    "What will be LookPilot's revenue on 31 Dec?",
  );
  expect(container.querySelector('.pubws-ask-word--live')).toBeNull();
});

test('the workspace description is the company tagline, and is optional', async () => {
  const { api } = await import('../../lib/api');
  // What the business sells, said once under its name: without it the floor
  // opens with a number about a word the visitor has never seen.
  vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue({
    ...h.workspace(),
    description: 'Webcam head tracker for sims.',
  } as never);
  const first = renderFloor();
  await waitFor(() => expect(first.container.querySelector('.pubws-ws-tagline')).toBeTruthy());
  expect(first.container.querySelector('.pubws-ws-tagline')!.textContent).toBe('Webcam head tracker for sims.');
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
      {
        marketId: 'm-week',
        metricId: 'metric-w',
        metricName: 'LookPilot revenue this week (USD)',
        targetDate: '2026-W34',
        resolvesOn: '2026-08-24T00:00:00Z',
        consensus: 213,
        probability: 0.5,
        liquidity: 200,
        rangeMin: 0,
        rangeMax: 8000,
      },
      {
        marketId: 'm-hero',
        metricId: 'metric-1',
        metricName: 'LookPilot net 2026 (USD)',
        targetDate: '2026-12',
        resolvesOn: '2026-12-31T00:00:00Z',
        consensus: 78_571,
        probability: 0.5,
        liquidity: 200,
        rangeMin: 0,
        rangeMax: 150_000,
      },
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

  test("never the other market's numbers", async () => {
    // The cliff this guards: the page once drew the year's 73,600 -> 78,571
    // line and then dropped to the week's 213 call (owner report 2026-08-17).
    // The since-open chip that once restated it is gone (owner ask
    // 2026-08-28); the price and the series still pin the one-market rule.
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(payload() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-stat--call .pubws-price')?.textContent).toBe('$78,571'));
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
      {
        marketId: 'm-week',
        metricId: 'metric-w',
        metricName: 'Revenue this week (USD)',
        targetDate: '2026-W34',
        resolvesOn: '2026-08-24T00:00:00Z',
        consensus: 213,
        probability: 0.5,
        liquidity: 200,
        rangeMin: 0,
        rangeMax: 8000,
      },
      {
        marketId: 'm-hero',
        metricId: 'metric-1',
        metricName: 'Net 2026 (USD)',
        targetDate: '2026-12',
        resolvesOn: '2027-01-01T00:00:00Z',
        consensus: 78_571,
        probability: 0.5,
        liquidity: 200,
        rangeMin: 0,
        rangeMax: 150_000,
      },
    ];
    return ws;
  };

  test('a nearer market appearing mid-poll does not take the headline', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(floor() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-stat--call .pubws-price')!.textContent).toContain('78'));

    // The hourly refresh opens a monthly market between the two. Inserted at
    // index 1, it is exactly what a position-based pick would grab.
    const withMonthly = floor();
    withMonthly.markets = [
      withMonthly.markets[0],
      {
        marketId: 'm-month',
        metricId: 'metric-1',
        metricName: 'Net 2026 (USD)',
        targetDate: '2026-09',
        resolvesOn: '2026-10-01T00:00:00Z',
        consensus: 50_000,
        probability: 0.5,
        liquidity: 200,
        rangeMin: 0,
        rangeMax: 150_000,
      },
      withMonthly.markets[1],
    ];
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(withMonthly as never);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_200);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(container.querySelector('.pubws-stat--call .pubws-price')!.textContent).toContain('78');
  });

  test('a market resolving later than the headline does take it over', async () => {
    // The other half of the rule. "Furthest-resolving" is the definition, so a
    // 2027 market becoming the headline is correct, not a regression.
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(floor() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-stat--call .pubws-price')!.textContent).toContain('78'));

    const with2027 = floor();
    with2027.markets = [
      ...with2027.markets,
      {
        marketId: 'm-2027',
        metricId: 'metric-1',
        metricName: 'Net 2027 (USD)',
        targetDate: '2027-12',
        resolvesOn: '2028-01-01T00:00:00Z',
        consensus: 120_000,
        probability: 0.5,
        liquidity: 200,
        rangeMin: 0,
        rangeMax: 250_000,
      },
    ];
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(with2027 as never);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_200);
    });
    await waitFor(() =>
      expect(container.querySelector('.pubws-stat--call .pubws-price')!.textContent).toContain('120'),
    );
  });

  test('a retired market leaves the headline on whatever is left', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(floor() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-stat--call .pubws-price')!.textContent).toContain('78'));

    const soloWeek = h.workspace();
    soloWeek.markets = [floor().markets[0]];
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(soloWeek as never);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_200);
    });
    await waitFor(() =>
      expect(container.querySelector('.pubws-stat--call .pubws-price')!.textContent).toContain('213'),
    );
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
  test('an in-app click selects the proposal and points at the comment', async () => {
    renderFloor();
    await screen.findByTitle('rewrite the store page');
    // The floor starts on the baseline market, not on the proposal.
    expect(screen.queryByRole('button', { name: 'if declined' })).toBeNull();

    fireEvent.click(screen.getByText('stand-in notification'));

    // The proposal is open: its branch toggle only exists when one is.
    // (What the floor then does with the comment id is FloorComments'
    // proposal, pinned in its own spec; this one is about the hash arriving
    // at all, which is the half that was broken.)
    expect(await screen.findByRole('button', { name: 'if declined' })).toBeTruthy();
  });

  test('a pasted link works the same on first paint', async () => {
    renderFloor(['/lookpilot#proposal=job-1']);
    expect(await screen.findByRole('button', { name: 'if declined' })).toBeTruthy();
  });

  // The link was `#contract=<id>` until the rename (docs/ui-conventions.md,
  // "The thing on the ballot is a PROPOSAL"), and it is printed in every
  // email sent before it, so it keeps opening the same proposal.
  test('an older #contract= link from an email already sent still opens the proposal', async () => {
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
  test('two doors lead to him: the corner dock and the end of the prose', async () => {
    renderFloor();
    // Same name on both, because they are the same invitation to the same
    // conversation (owner direction 2026-08-21: make him obvious). The panel
    // is one, and the floor owns whether it is open.
    const doors = await screen.findAllByRole('button', { name: /ask otto about lookpilot/i });
    expect(doors.length).toBe(2);
    expect(doors.some(d => d.className.includes('ottodock'))).toBe(true);
    // The second door is the first row of the pair at the end of the prose
    // (AgentDoors). Signed out it still says "ask", because signed out he can
    // only answer; the row beside it offers the same market to their own AI.
    expect(doors.some(d => d.className.includes('doors-row'))).toBe(true);
    expect(screen.getByText('Or read it from your own AI')).toBeTruthy();
  });
});

/**
 * Opening a proposal used to REPLACE the clock line with the proposal's own
 * header, so the horizon arrows vanished and `pair` fell back to
 * `selectedJob.markets[0]`. The backend was never the problem:
 * createConditionalMarkets spawns a pair per baseline market, so a two-clock
 * floor gives a proposal four conditional markets and the API serves all of
 * them. The floor reached exactly one, and WHICH one depended on the horizon
 * the reader happened to be on before they clicked in, so a proposal's number
 * moved with state nobody could see.
 *
 * The rule these pin (docs/ui-conventions.md, "A proposal keeps the clock
 * line"): the question line and its cycle words render in BOTH states, and
 * the proposal adds one sentence underneath naming the world.
 */
describe('a proposal keeps the clock line', () => {
  /** A floor with two open horizons, and a proposal priced on both. */
  function twoClocks() {
    const ws = h.workspace();
    // The activity panel (and its per-branch read) only renders for someone
    // who can trade, which is what makes the last test here observable.
    ws.joinAs = 'trader';
    ws.markets = [
      {
        ...ws.markets[0],
        marketId: 'm-week',
        metricName: 'LookPilot weekly net revenue (USD)',
        targetDate: '2026-W34',
        resolvesOn: '2026-08-24',
        consensus: 500,
        rangeMax: 8_000,
      },
      {
        ...ws.markets[0],
        marketId: 'm-month',
        metricName: 'LookPilot monthly net revenue (USD)',
        targetDate: '2026-09',
        resolvesOn: '2026-10-01',
        consensus: 3_500,
        rangeMax: 25_000,
      },
    ];
    ws.marketHistoryMarketId = 'm-month';
    const pair = ws.proposals[0].markets[0];
    ws.proposals[0].markets = [
      {
        ...pair,
        metricName: 'LookPilot weekly net revenue (USD)',
        targetDate: '2026-W34',
        resolvesOn: '2026-08-24',
        approvedConsensus: 520,
        declinedConsensus: 500,
        delta: 20,
        approvedMarketId: 'm-week-approved',
        declinedMarketId: 'm-week-declined',
        rangeMax: 8_000,
      },
      {
        ...pair,
        metricName: 'LookPilot monthly net revenue (USD)',
        targetDate: '2026-09',
        resolvesOn: '2026-10-01',
        approvedConsensus: 4_700,
        declinedConsensus: 3_500,
        delta: 1_200,
        approvedMarketId: 'm-month-approved',
        declinedMarketId: 'm-month-declined',
        rangeMax: 25_000,
      },
    ];
    ws.proposals[0].marketPairCount = 2;
    return ws;
  }

  test('the metric picker survives opening a proposal', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(twoClocks() as never);
    renderFloor();

    // One metric on two dates: both date segments are on the picker, and
    // the sentence's date word is a cycle button.
    expect((await screen.findAllByRole('button', { name: /^Show / })).length).toBe(2);
    expect(screen.getByRole('button', { name: /^Date: / })).toBeTruthy();

    fireEvent.click(await screen.findByTitle('rewrite the store page'));
    await screen.findByRole('button', { name: 'if approved' });

    // The regression: this used to be 0, because the caption and its
    // controls lived in the branch that a selected proposal replaced.
    expect(screen.getAllByRole('button', { name: /^Show / }).length).toBe(2);
    expect(screen.getByRole('button', { name: /^Date: / })).toBeTruthy();
  });

  test('the clock line still names the metric and its settle day on a proposal', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(twoClocks() as never);
    renderFloor();
    fireEvent.click(await screen.findByTitle('rewrite the store page'));
    await screen.findByRole('button', { name: 'if approved' });

    // The floor opens on the furthest-resolving market, so the month is on
    // screen; the caption strips the leading workspace name, the date row
    // still carries the settle day, and the question line says the same
    // cell as a sentence.
    const caption = document.querySelector('.pubws-instrument-label');
    expect(caption?.textContent).toContain('monthly net revenue');
    expect(document.querySelector('.pubws-instrument-date')?.textContent).toMatch(/\d/);
    const ask = document.querySelector('.pubws-instrument-ask');
    expect(ask?.textContent).toContain('monthly net revenue');
    expect(ask?.textContent).toMatch(/ on \d/);
  });

  test('the proposal folds its condition into the one question sentence', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(twoClocks() as never);
    renderFloor();
    fireEvent.click(await screen.findByTitle('rewrite the store page'));

    const question = await screen.findByRole('heading', { name: /is paid \$80/ });
    // One sentence carries the market AND the condition (owner ask
    // 2026-08-28: modify the question, do not add a line under it): "What
    // will be ... if Ada is paid $80 to do: rewrite the store page?".
    expect(question.className).toContain('pubws-instrument-ask');
    expect(question.textContent?.startsWith('What will be')).toBe(true);
    expect(question.textContent).toMatch(/net revenue/i);
    expect(question.textContent?.trim().endsWith('?')).toBe(true);
    // And no second question heading under it.
    expect(document.querySelector('.pubws-question')).toBeNull();
  });

  test('picking the other metric re-points the proposal at that market', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(twoClocks() as never);
    vi.mocked(api.getMarketActivity).mockClear();
    renderFloor();
    fireEvent.click(await screen.findByTitle('rewrite the store page'));
    // Opens on the furthest-resolving horizon, so the month's approved branch.
    await waitFor(() => expect(vi.mocked(api.getMarketActivity)).toHaveBeenCalledWith('lookpilot', 'm-month-approved'));

    // The fixture's two markets share one metric, so this is the DATE row;
    // the week's segment is the one not on screen.
    fireEvent.click(screen.getByRole('button', { name: /^Show .*(this week|week to)/ }));

    // pair resolves by (metric, date), so the week's pair is now the one on
    // screen.
    await waitFor(() => expect(vi.mocked(api.getMarketActivity)).toHaveBeenCalledWith('lookpilot', 'm-week-approved'));
  });

  test('the date word cycles and LOOPS back to where it started', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(twoClocks() as never);
    const { container } = renderFloor();

    const ask = () => container.querySelector('.pubws-instrument-ask')!.textContent ?? '';
    await waitFor(() => expect(ask()).toContain('monthly net revenue'));
    // The whole sentence, so the scaffold and both words are pinned once.
    expect(ask()).toBe("What will be LookPilot's monthly net revenue on 30 Sep?");

    fireEvent.click(screen.getByRole('button', { name: /^Date: / }));
    await waitFor(() => expect(ask()).toContain('23 Aug'));

    // Two options, so the next step is the start again (the 2026-08-20
    // arrow rule: a control that always moves).
    fireEvent.click(screen.getByRole('button', { name: /^Date: / }));
    await waitFor(() => expect(ask()).toContain('30 Sep'));
  });
});

describe('the floor pins its own workspace context', () => {
  // Owner report 2026-08-22: editing a proposal answered "Proposal not
  // found" because the workspace header still named a previously visited
  // floor. The pin used to happen only inside the silent join's success
  // path, which a viewer-mode visitor (and an owner of a non-open floor)
  // never enters.
  test('loading a floor sets the active workspace even without a join', async () => {
    const { api, setActiveWorkspace } = await import('../../lib/api');
    const ws = h.workspace(); // default joinAs: 'viewer', so no silent join
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    vi.mocked(setActiveWorkspace).mockClear();
    renderFloor();
    await screen.findByTitle('rewrite the store page');
    await waitFor(() => expect(vi.mocked(setActiveWorkspace)).toHaveBeenCalledWith('ws-1'));
  });
});

describe('a market with no price yet', () => {
  test('keeps the question line on screen and says so where the price would be', async () => {
    const { api } = await import('../../lib/api');
    const ws = h.workspace();
    ws.markets = ws.markets.map(m => ({ ...m, consensus: null, liquidity: 0 }));
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-instrument-label')).toBeTruthy());
    expect(container.querySelector('.pubws-price')?.textContent).toBe('no price yet');
    expect(container.querySelector('.pubws-instrument-date')).toBeTruthy();
    expect(container.querySelector('.pubws-instrument-ask')?.textContent).toContain(' on ');
    expect(container.querySelector('.mchart')).toBeNull();
  });
});

describe('the stat row and the one chart (docs/ui-conventions.md, "The price and the chart")', () => {
  const oneMarket = () => {
    const ws = h.workspace();
    ws.markets = [
      {
        marketId: 'm-hero',
        metricId: 'metric-1',
        metricName: 'LookPilot net 2026 (USD)',
        targetDate: '2026-12',
        resolvesOn: '2026-12-31T00:00:00Z',
        consensus: 78_571,
        probability: 0.5,
        liquidity: 200,
        rangeMin: 0,
        rangeMax: 150_000,
      },
    ];
    ws.horizonHistories = [
      {
        marketId: 'm-hero',
        metricName: 'LookPilot net 2026 (USD)',
        targetDate: '2026-12',
        description: 'The year, net of refunds. Contract payouts are NOT subtracted.',
        points: [{ at: '2026-08-15T09:00:00Z', value: 45_339 }],
      },
    ];
    return ws;
  };

  test("the reading and the market's call are named, side by side, above one chart", async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(oneMarket() as never);
    const { container } = renderFloor();
    // Two named numbers in ONE row: the reading, ink, on the left; the
    // market's call, amber, on the right. A Manifold trader read the old
    // unnamed stack as a lifetime total of a brand-new company (2026-09-03).
    await waitFor(() => expect(container.querySelector('.pubws-stats')).toBeTruthy());
    const now = container.querySelector('.pubws-stats .pubws-stat--now') as HTMLElement;
    const call = container.querySelector('.pubws-stats .pubws-stat--call') as HTMLElement;
    expect(now.querySelector('.pubws-price')?.textContent).toBe('$45,339');
    expect(now.querySelector('.pubws-stat-what')?.textContent).toBe('now');
    expect(now.querySelector('.pubws-updated')?.textContent).toMatch(/^read .+ ago$|^read just now$/);
    expect(call.querySelector('.pubws-price')?.textContent).toBe('$78,571');
    expect(call.querySelector('.pubws-stat-what')?.textContent).toBe("market's call");
    // The day being forecast is the day before the settle instant, as the
    // picker names it, then THE COUNTDOWN, AND ONLY THE COUNTDOWN (owner,
    // 2026-09-01): the exact instant is the hover.
    const settle = call.querySelector('.pubws-settle-in') as HTMLElement;
    expect(settle.textContent).toMatch(/^for 30 Dec · settles in \S+$/);
    expect(settle.textContent).not.toMatch(/UTC|\d{4}/);
    expect(settle.title).toMatch(/^settles \d+ \w+ \d{4}, \d{2}:\d{2} UTC$/);
    expect(container.querySelector('.pubws-settle-at')).toBeNull();
    // The stats live above the chart, not inside either chart's control row.
    expect(container.querySelector('.pubws-numchart .pubws-price')).toBeNull();
    expect(container.querySelector('.pubws-callhist .pubws-price')).toBeNull();
    expect(container.textContent).not.toContain('expected');
  });

  test('the number chart is the hero and the market history is a captioned strip below it', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(oneMarket() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-numchart .nchart')).toBeTruthy());
    const num = container.querySelector('.pubws-numchart') as HTMLElement;
    const hist = container.querySelector('.pubws-callhist') as HTMLElement;
    expect(hist).toBeTruthy();
    // Document order IS reading order: the number first, how the call moved after.
    expect(num.compareDocumentPosition(hist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Each names itself in the centre of its row: the metric, caption-shaped
    // (the leading company name stripped), and the strip's own words.
    expect(num.querySelector('.pubws-chart-cap')?.textContent).toBe('net 2026');
    expect(hist.querySelector('.pubws-chart-cap')?.textContent).toBe('how the call moved');
    expect(screen.queryByText('market')).toBeNull();
    // There is still no MARKET/NUMBER switch.
    expect(screen.queryByRole('button', { name: 'market' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'number' })).toBeNull();
  });

  test('a legend under the number chart names the marks', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(oneMarket() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-numchart .nchart-legend')).toBeTruthy());
    const legend = container.querySelector('.pubws-numchart .nchart-legend') as HTMLElement;
    expect(legend.textContent).toContain('actual');
    expect(legend.textContent).toContain("market's call for 30 Dec");
    // One open market of this metric: no grey dots, so no words for them.
    expect(legend.textContent).not.toContain('other open dates');
  });

  test('with other open dates the legend says what the grey dots are', async () => {
    const { api } = await import('../../lib/api');
    const ws = oneMarket();
    ws.markets.push({
      marketId: 'm-week',
      metricId: 'metric-1',
      metricName: 'LookPilot net 2026 (USD)',
      targetDate: '2026-W35',
      resolvesOn: '2026-08-31T00:00:00Z',
      consensus: 46_000,
      probability: 0.5,
      liquidity: 200,
      rangeMin: 0,
      rangeMax: 150_000,
    });
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-numchart .nchart-legend')).toBeTruthy());
    expect(container.querySelector('.pubws-numchart .nchart-legend')?.textContent).toContain('other open dates');
  });

  test("the definition's first sentence sits under the question", async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(oneMarket() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-instrument-sum')).toBeTruthy());
    expect(container.querySelector('.pubws-instrument-sum')?.textContent).toBe('The year, net of refunds.');
    // Right under the question, before the numbers.
    const ask = container.querySelector('.pubws-instrument-ask') as HTMLElement;
    const sum = container.querySelector('.pubws-instrument-sum') as HTMLElement;
    const stats = container.querySelector('.pubws-stats') as HTMLElement;
    expect(ask.compareDocumentPosition(sum) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sum.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('no definition, no line', async () => {
    const { api } = await import('../../lib/api');
    const ws = oneMarket();
    ws.horizonHistories[0].description = null as unknown as string;
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-stats')).toBeTruthy());
    expect(container.querySelector('.pubws-instrument-sum')).toBeNull();
  });

  test('no reading yet: the reading says so and carries no age', async () => {
    const { api } = await import('../../lib/api');
    const ws = oneMarket();
    ws.horizonHistories[0].points = [];
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    const { container } = renderFloor();
    // No reading: the number chart stays, in its own "no reading yet"
    // state (hiding it read as the graph collapsing, owner report
    // 2026-08-28), and the reading's block says so with no age on it.
    await screen.findByText(/settles in/);
    expect(container.querySelector('.pubws-stat--now .pubws-price')?.textContent).toBe('no reading yet');
    expect(container.querySelector('.pubws-stat--now .pubws-updated')).toBeNull();
    expect(container.querySelector('.pubws-numchart .nchart-empty')?.textContent).toBe('no reading yet');
    // The call is still named and dated.
    expect(container.querySelector('.pubws-stat--call .pubws-price')?.textContent).toBe('$78,571');
  });
});

describe("the owner's own reading, under the market's", () => {
  test('a visitor never sees it', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(h.workspace() as never);
    renderFloor();
    await screen.findByText(h.workspace().name);
    // Signed out here, so canManage is false: no line, no Report.
    expect(screen.queryByRole('button', { name: 'Report' })).toBeNull();
    expect(screen.queryByText(/^Yours:/)).toBeNull();
  });
});

describe('the owner of a not-public floor', () => {
  test('/marketplace/{id} does NOT canonicalize a private floor to its slug', async () => {
    // Slug resolution excludes private floors, so the slug URL 404s. The
    // canonicalizer rewriting the address anyway meant loading your own
    // floor immediately refetched it into a 404 (owner report 2026-08-28).
    const { api } = await import('../../lib/api');
    const ws = { ...h.workspace(), visibility: 'private', slug: 'my-life' };
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    renderFloor([`/marketplace/${ws.workspaceId}`]);
    await screen.findByText(h.workspace().name);
    // Still at the id address: the loads stayed on the id, never the slug.
    const loads = vi.mocked(api.getMarketplaceWorkspace).mock.calls.map(c => c[0]);
    expect(loads).not.toContain('my-life');
  });

  test('/marketplace/{id} still canonicalizes a PUBLIC floor to its slug', async () => {
    const { api } = await import('../../lib/api');
    const ws = { ...h.workspace(), visibility: 'public', slug: 'lookpilot' };
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    renderFloor([`/marketplace/${ws.workspaceId}`]);
    await screen.findByText(h.workspace().name);
    await waitFor(() => {
      const loads = vi.mocked(api.getMarketplaceWorkspace).mock.calls.map(c => c[0]);
      expect(loads).toContain('lookpilot');
    });
  });

  test('the publish band never renders for a visitor', async () => {
    const { api } = await import('../../lib/api');
    const ws = { ...h.workspace(), visibility: 'unlisted' };
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    vi.mocked(api.getProfile).mockResolvedValue({ capabilities: ['read', 'trade', 'manage'] } as never);
    renderFloor();
    // Signed out in this harness, so canManage stays false: no band, no button.
    await screen.findByText(h.workspace().name);
    expect(screen.queryByText('Publish this market')).toBeNull();
    expect(screen.queryByText(/Only people with the link/)).toBeNull();
  });
});

describe('a floor with no market yet', () => {
  test('a visitor sees the honest state, not a broken page', async () => {
    const { api } = await import('../../lib/api');
    const ws = { ...h.workspace(), markets: [], marketHistory: [], marketHistoryMarketId: null };
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    renderFloor();
    expect(await screen.findByText('Nothing is priced here yet. The owner has not added a number.')).toBeTruthy();
    expect(screen.queryByText('Higher')).toBeNull();
  });
});

/**
 * The price on the floor's own verbs (docs/ui-conventions.md, "An untouched
 * ticket still quotes both sides"). On this page the untouched state is the
 * two verbs, not the ticket: the ticket only exists once a verb has been
 * pressed, and it opens with a side already chosen. So the quote has to be
 * on the verbs, or a visitor still cannot price a trade without committing
 * to a direction first (notes/quroe-churn-2026-08-27.md).
 */
describe('the floor quotes both sides before the first click', () => {
  const tradable = (probability: number) => {
    const ws = h.workspace();
    ws.joinAs = 'trader';
    ws.markets[0].probability = probability;
    return ws;
  };

  test('each verb says how much is on the table for that side', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(tradable(0.14) as never);
    renderFloor();

    // b = 200: 393 credits behind the 14c side, 30 behind the 86c one. The
    // verbs and the ticket's pills quote it in the same words, from the same
    // function, so the two untouched states cannot drift apart.
    const higher = await screen.findByRole('button', { name: /Bet Higher/ });
    const lower = screen.getByRole('button', { name: /Bet Lower/ });
    expect(higher.textContent).toContain('up to 393 cr');
    expect(lower.textContent).toContain('up to 30 cr');
  });

  test('and never the price in cents, which is the thing it replaced', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(tradable(0.14) as never);
    const { container } = renderFloor();

    await screen.findByRole('button', { name: /Bet Higher/ });
    expect(container.textContent).not.toContain('14c');
    expect(container.textContent).not.toContain('86c');
  });

  test('one line under the verbs says what a share pays, naming both ends', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(tradable(0.5) as never);
    const { container } = renderFloor();

    await screen.findByRole('button', { name: /Bet Higher/ });
    expect(container.textContent).toContain('A share pays 1 cr at $500,000, nothing at $0.');
  });

  test('the line goes once the ticket is open, which says the same thing about the bet', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(tradable(0.5) as never);
    const { container } = renderFloor();

    fireEvent.click(await screen.findByRole('button', { name: /Bet Higher/ }));
    await waitFor(() => expect(container.querySelector('.pubws-ticket-inline')).toBeTruthy());
    expect(container.textContent).not.toContain('A share pays 1 cr at');
  });

  test('a market with no liquidity quotes nothing: there is no book to price', async () => {
    const { api } = await import('../../lib/api');
    const ws = h.workspace();
    ws.joinAs = 'trader';
    ws.markets[0].liquidity = 0;
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    const { container } = renderFloor();

    await waitFor(() => expect(screen.getByText(/no liquidity yet/i)).toBeTruthy());
    expect(container.textContent).not.toContain('A share pays 1 cr at');
    expect(container.textContent).not.toContain('50c');
  });
});

/**
 * While the floor loads (docs/ui-conventions.md, "While a page loads"): the
 * three columns are drawn as ghosts in the real geometry, the name from the
 * share hint the server planted paints at once in the headline slot, the
 * top bar runs its progress hairline, and the old rippling dot is gone.
 */
describe('while the floor loads', () => {
  // Inserted as markup, the way the server plants it: jsdom would try to
  // RUN a script element created through the DOM, JSON or not.
  function plantHint(body: unknown) {
    const json = JSON.stringify(body).replace(/<\//g, '<\\/');
    document.head.insertAdjacentHTML(
      'beforeend',
      `<script id="telarchy-floor" type="application/json">${json}</script>`,
    );
  }
  afterEach(() => {
    document.head.innerHTML = '';
  });

  test('ghost columns and the progress hairline, never a dot', async () => {
    const { api } = await import('../../lib/api');
    let release: (v: unknown) => void = () => {};
    vi.mocked(api.getMarketplaceWorkspace as unknown as () => Promise<unknown>).mockReturnValue(
      new Promise(r => {
        release = r;
      }),
    );
    const { container } = renderFloor();
    expect(container.querySelector('.pubws-main--floor')).toBeTruthy();
    expect(container.querySelectorAll('.pubws-ghost').length).toBeGreaterThanOrEqual(6);
    expect(container.querySelector('[role="status"][aria-label="Loading"]')).toBeTruthy();
    expect(container.querySelector('.pubws-topbar .pubws-progress')).toBeTruthy();
    expect(container.querySelector('.pubws-loading-dot')).toBeNull();
    release(h.workspace());
    await screen.findByRole('heading', { level: 1, name: 'LookPilot' });
    expect(container.querySelector('.pubws-ghost')).toBeNull();
    expect(container.querySelector('.pubws-progress')).toBeNull();
  });

  test('the name from the share hint paints before the payload lands', async () => {
    const { api } = await import('../../lib/api');
    plantHint({ id: 'ws-1', slug: 'lookpilot', name: 'LookPilot', description: 'Webcam head tracker for sims.' });
    vi.mocked(api.getMarketplaceWorkspace as unknown as () => Promise<unknown>).mockReturnValue(new Promise(() => {}));
    renderFloor(['/lookpilot']);
    expect(screen.getByRole('heading', { level: 1, name: 'LookPilot' })).toBeInTheDocument();
    expect(screen.getByText('Webcam head tracker for sims.')).toBeInTheDocument();
  });

  test('a hint for another floor is ignored', async () => {
    const { api } = await import('../../lib/api');
    plantHint({ id: 'ws-9', slug: 'other', name: 'Other Co', description: null });
    vi.mocked(api.getMarketplaceWorkspace as unknown as () => Promise<unknown>).mockReturnValue(new Promise(() => {}));
    renderFloor(['/lookpilot']);
    expect(screen.queryByText('Other Co')).toBeNull();
  });

  test('the hint is read once: the element is gone after mount', async () => {
    plantHint({ id: 'ws-1', slug: 'lookpilot', name: 'LookPilot', description: null });
    renderFloor(['/lookpilot']);
    await waitFor(() => expect(document.getElementById('telarchy-floor')).toBeNull());
  });
});
