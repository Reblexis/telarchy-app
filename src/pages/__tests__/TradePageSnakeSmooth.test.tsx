import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The floor updates smoothly in realtime (docs/ui-conventions.md, "The feed
 * drives the floor", "Every countdown on the floor reads one clock", "The
 * reading's age is the newest reading's age", "A proposal past its deadline
 * reads as closed before the ruling lands"; Viktor 2026-09-11: "fix the
 * bugs and issues causing it to not update smoothly realtime leave the
 * rest"). What these pin: a NOW cell that said "read 1m ago" one second
 * after the reading it names, and a ticket that vanished at the deadline
 * with nothing in its place.
 */

const NOW = Date.UTC(2026, 8, 11, 16, 30, 30);

const h = vi.hoisted(() => {
  const NOW_MS = Date.UTC(2026, 8, 11, 16, 30, 30);
  const state = { proposals: [] as unknown[], readingAt: new Date(NOW_MS - 60_000).toISOString() };
  const pair = () => ({
    metricId: 'metric-len',
    metricName: 'Reached length',
    targetDate: '2026-09-11T17:30',
    resolvesOn: '2026-09-11T17:31:00Z',
    approvedConsensus: 3.4,
    declinedConsensus: 3.0,
    delta: 0.4,
    approvedMarketId: 'm-a',
    declinedMarketId: 'm-d',
    approvedProbability: 0.5,
    approvedLiquidity: 200,
    declinedProbability: 0.5,
    declinedLiquidity: 200,
    approvedPool: 1000,
    declinedPool: 1000,
    approvedTraders: 0,
    declinedTraders: 0,
    approvedVolume: 0,
    declinedVolume: 0,
    rangeMin: 0,
    rangeMax: 144,
  });
  const proposal = (over: Record<string, unknown>) => ({
    id: `p-${over.number}`,
    title: `Game 1, attempt 49, move 10: Turn left`,
    description: '',
    askUsd: null,
    proposedByName: 'snake',
    proposedByHandle: 'snake',
    createdAt: '2026-09-11T16:30:00Z',
    decideBy: '2026-09-11T16:31:00Z',
    status: 'pending',
    resolvedAt: null,
    closedAt: null,
    lapsedAt: null,
    marketPairCount: 1,
    markets: [pair()],
    ...over,
  });
  const workspace = () => ({
    workspaceId: 'ws-1',
    name: 'Snake',
    slug: 'snake',
    ownerId: null,
    ownerHandle: null,
    description: null,
    charter: null,
    liveViewUrl: null,
    liveFeed: { kind: 'snake', url: 'https://snake.example.com' },
    visibility: 'public',
    proposalReward: 0,
    spamPenalty: 0,
    joinAs: 'trader' as const,
    signupCredits: 100,
    metricCount: 1,
    openMarketCount: 1,
    participantCount: 3,
    heroMetricId: 'metric-len',
    heroMetricDescription: 'The length.',
    proposalStats: { total: 3, pending: 3, approved: 0, declined: 0 },
    decisionMinutes: 1,
    markets: [
      {
        marketId: 'm-len',
        metricId: 'metric-len',
        metricName: 'Reached length',
        targetDate: '2026-09-11T17:30',
        resolvesOn: '2026-09-11T17:31:00Z',
        consensus: 3,
        probability: 0.5,
        liquidity: 200,
        rangeMin: 0,
        rangeMax: 144,
      },
    ],
    marketHistory: [],
    marketHistoryMarketId: 'm-len',
    horizonHistories: [
      {
        marketId: 'm-len',
        periodStart: '2026-09-11',
        points: [{ at: state.readingAt, value: 3 }],
        description: 'The length.',
      },
    ],
    proposals: state.proposals,
  });
  /** What the feed reports up through `onState`: a step opened just now. */
  const feedState = (over: Record<string, unknown> = {}) => ({
    game: {
      snake: [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
      ],
      food: { x: 8, y: 2 },
      heading: 'right',
      length: 4,
      step: 42,
      deaths: 0,
      complete: false,
      size: 12,
      gameNumber: 1,
    },
    grid: 12,
    gameNumber: 1,
    next: { action: 'forward', direction: 'right', decided: false, seconds: 28 },
    open: {
      step: 42,
      openedAt: new Date(NOW_MS - 2_000).toISOString(),
      decideAt: '2026-09-11T16:30:58Z',
      deadline: '2026-09-11T16:31:00Z',
      cells: {},
      directions: { forward: 'right', left: 'up', right: 'down' },
      proposals: { forward: { id: 'p-121', title: 'Continue', url: 'https://telarchy.com/snake/p/121' } },
      quotes: {},
      ...(over.open as Record<string, unknown>),
    },
    recentDecisions: [],
    complete: false,
    nextGameAt: null,
  });
  return { state, workspace, proposal, feedState };
});

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../../components/MarketChart', () => ({
  GEOM: { wide: { W: 720, PAD_L: 46, PAD_R: 58, H: 260 }, compact: { W: 400, PAD_L: 40, PAD_R: 50, H: 300 } },
  MarketChart: () => <div data-testid="call-chart" />,
}));
vi.mock('../../components/live/LiveView', () => ({
  LiveView: ({
    onStep,
    onState,
  }: {
    onStep?: (s: { step: number; decided: boolean }) => void;
    onState?: (s: unknown) => void;
  }) => (
    <div data-testid="live-view">
      <button type="button" onClick={() => onState?.(h.feedState())}>
        feed-state
      </button>
      <button type="button" onClick={() => onStep?.({ step: 42, decided: true })}>
        feed-decided
      </button>
    </div>
  ),
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

function renderFloor(path = '/snake') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/:slug" element={<TradePage />} />
        <Route path="/:slug/p/:number" element={<TradePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const nowCell = () => document.querySelector('.pubws-stat--now') as HTMLElement;
/** The page open on a proposal: its head is drawn and the feed is wired. */
async function openProposal(number: number) {
  renderFloor(`/snake/p/${number}`);
  await screen.findByTestId('live-view');
  await waitFor(() => expect(document.querySelector('.pubws-proposal-title')?.textContent).toContain(`#${number}`));
}
const rail = () => document.querySelector('.pubws-rail--right') as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  Element.prototype.scrollIntoView = vi.fn();
  sessionStorage.clear();
  h.state.proposals = [];
  h.state.readingAt = new Date(NOW - 60_000).toISOString();
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

describe('the read age is the true age of the newest reading', () => {
  test("the feed's own step is the newest reading when it is newer than the payload", async () => {
    renderFloor();
    await screen.findByTestId('live-view');
    await waitFor(() => expect(nowCell()).toBeTruthy());
    // The payload's last reading is a minute old, and that is what the page
    // knows before the feed speaks.
    expect(nowCell().textContent).toMatch(/read 1m ago/);
    await act(async () => {
      fireEvent.click(screen.getByText('feed-state'));
    });
    // The feed opened a step two seconds ago: that IS the newest reading.
    await waitFor(() => expect(nowCell().textContent).toMatch(/read just now/));
    expect(nowCell().textContent).toContain('4');
  });

  test('the age ticks with the floor clock rather than waiting for a poll', async () => {
    h.state.readingAt = new Date(NOW - 61_000).toISOString();
    h.state.proposals = [h.proposal({ number: 122 })];
    renderFloor();
    await screen.findByTestId('live-view');
    await waitFor(() => expect(nowCell()).toBeTruthy());
    expect(nowCell().textContent).toMatch(/read 1m ago/);
    // The clock runs at one second while a deadline is inside the hour.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await waitFor(() => expect(nowCell().textContent).toMatch(/read 2m ago/));
  });

  test('a payload reading newer than the feed is the one that counts', async () => {
    h.state.readingAt = new Date(NOW - 1_000).toISOString();
    renderFloor();
    await screen.findByTestId('live-view');
    await waitFor(() => expect(nowCell()).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByText('feed-state'));
    });
    // The feed's step is two seconds old, the payload's reading one: the
    // page keeps the newer one and its value.
    expect(nowCell().textContent).toMatch(/read just now/);
    expect(nowCell().textContent).toContain('3');
  });
});

describe('a sixty-second window counts down by the second', () => {
  test('the board row and the proposal head both read m:ss and tick', async () => {
    h.state.proposals = [h.proposal({ number: 122, decideBy: new Date(NOW + 60_000).toISOString() })];
    await openProposal(122);
    await waitFor(() => expect(document.querySelector('.pubws-ballot-clock')).toBeTruthy());
    /** "0:59" as seconds; the finest bucket is the second, never "<1h". */
    const secondsOf = (text: string | null) => {
      const m = /(\d+):(\d\d)/.exec(text ?? '');
      expect(m, `no m:ss clock in ${text}`).toBeTruthy();
      return Number(m?.[1]) * 60 + Number(m?.[2]);
    };
    const rowClock = () => secondsOf((document.querySelector('.pubws-ballot-clock') as HTMLElement).textContent);
    const headClock = () => secondsOf((screen.getByLabelText('Decision deadline') as HTMLElement).textContent);
    const row0 = rowClock();
    const head0 = headClock();
    expect(row0).toBeGreaterThan(50);
    expect(row0).toBeLessThanOrEqual(60);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    // One second later, one second less: on both clocks, with no poll.
    expect(rowClock()).toBe(row0 - 1);
    expect(headClock()).toBe(head0 - 1);
  });
});

describe('the ticket stays in place when the window closes', () => {
  test('the rail keeps one line from the close through the ruling', async () => {
    h.state.proposals = [h.proposal({ number: 122, decideBy: new Date(NOW + 3_000).toISOString() })];
    await openProposal(122);
    await waitFor(() => expect(document.querySelector('.pubws-ticket-inline')).toBeTruthy());
    // The deadline passes while the page is open.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_100);
    });
    await waitFor(() => expect(document.querySelector('.pubws-closed-line')).toBeTruthy());
    const line = document.querySelector('.pubws-closed-line') as HTMLElement;
    expect(line.textContent).toMatch(/Trading closed at the deadline/);
    expect(rail().textContent?.trim()).not.toBe('');
    // The ruling lands: the same line says what happened, in place.
    h.state.proposals = [
      h.proposal({
        number: 122,
        status: 'approved',
        resolvedAt: '2026-09-11T16:30:58Z',
        closedAt: '2026-09-11T16:30:58Z',
      }),
    ];
    await act(async () => {
      fireEvent.click(screen.getByText('feed-decided'));
    });
    await waitFor(() => expect(document.querySelector('.pubws-closed-line')?.textContent).toMatch(/Decided/));
    expect(document.querySelector('.pubws-closed-line')).toBe(line);
    expect(line.textContent).toMatch(/Trading closed\. Decided: approved\./);
  });

  test('a proposal decided before its deadline still leaves the line where the ticket was', async () => {
    h.state.proposals = [
      h.proposal({
        number: 122,
        status: 'declined',
        resolvedAt: '2026-09-11T16:30:28Z',
        closedAt: '2026-09-11T16:30:28Z',
      }),
    ];
    await openProposal(122);
    await waitFor(() => expect(document.querySelector('.pubws-closed-line')).toBeTruthy());
    expect((document.querySelector('.pubws-closed-line') as HTMLElement).textContent).toMatch(
      /Trading closed\. Decided: declined\./,
    );
    expect(document.querySelector('.pubws-ticket-inline')).toBeNull();
  });
});
