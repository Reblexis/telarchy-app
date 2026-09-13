import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// A full page render per test; under a loaded machine one ran past the
// five-second default.
vi.setConfig({ testTimeout: 20_000 });

/**
 * A log row lands on the thing it names (docs/ui-conventions.md, "A trade has
 * an address"; docs/data-room.md, "A row"; owner ask 2026-09-13: "clicking a
 * given log in the feed would link to the specific trade or whatever just
 * like it is with notifciations").
 *
 * `#proposal=<id>&trade=<tradeId>` opens the proposal, opens its Activity tab
 * and flashes the trade's row, for a trade on an OPTION book (the snake's
 * shape) and on either branch of a two-branch proposal, whether the address
 * was pasted or followed from the floor's own Live block.
 */

const h = vi.hoisted(() => {
  const soon = new Date(Date.now() + 60 * 60_000);
  soon.setUTCSeconds(0, 0);
  const TARGET = soon.toISOString().slice(0, 16);
  const RESOLVES = new Date(soon.getTime() + 60_000).toISOString();
  const DECIDE_BY = new Date(Date.now() + 30 * 60_000).toISOString();
  const option = (id: string, label: string, consensus: number, delta: number) => ({
    id,
    label,
    marketId: `m-${id}`,
    consensus,
    probability: 0.5,
    liquidity: 200,
    pool: 300,
    traders: 1,
    volume: 20,
    delta,
  });
  const nulls = {
    approvedProbability: null,
    approvedLiquidity: null,
    declinedProbability: null,
    declinedLiquidity: null,
    approvedPool: null,
    declinedPool: null,
    approvedTraders: null,
    declinedTraders: null,
    approvedVolume: null,
    declinedVolume: null,
  };
  const floor = () => ({
    workspaceId: 'ws-snake',
    name: 'Snake',
    slug: 'snake',
    ownerId: null,
    ownerHandle: null,
    description: 'A snake steered by markets',
    charter: null,
    visibility: 'public',
    proposalReward: 0,
    spamPenalty: 0,
    joinAs: 'trader' as const,
    signupCredits: 100,
    metricCount: 1,
    openMarketCount: 1,
    participantCount: 3,
    proposalStats: { total: 2, pending: 2, approved: 0, declined: 0 },
    markets: [
      {
        marketId: 'm-len',
        metricId: 'len',
        metricName: 'Reached length',
        metricOrder: 0,
        targetDate: TARGET,
        resolvesOn: RESOLVES,
        consensus: 6,
        probability: 0.5,
        liquidity: 200,
        pool: 3000,
        traderCount: 2,
        tradedVolume: 40,
        rangeMin: 0,
        rangeMax: 144,
      },
    ],
    marketHistory: [],
    marketHistoryMarketId: 'm-len',
    horizonHistories: [{ marketId: 'm-len', periodStart: '2026-09-11', points: [], description: 'The length.' }],
    proposals: [
      {
        id: 'job-opt',
        number: 129,
        title: 'Step 42: which way?',
        description: 'The snake picks a direction.',
        askUsd: 0,
        status: 'pending' as const,
        decideBy: DECIDE_BY,
        closedAt: null,
        lapsedAt: null,
        proposedByName: 'snake-operator',
        createdAt: new Date(Date.now() - 60 * 60_000).toISOString(),
        options: [
          { id: 'forward', label: 'Continue' },
          { id: 'left', label: 'Turn left' },
          { id: 'right', label: 'Turn right' },
        ],
        decidedOption: null,
        marketPairCount: 1,
        markets: [
          {
            metricId: 'len',
            metricName: 'Reached length',
            targetDate: TARGET,
            resolvesOn: RESOLVES,
            approvedConsensus: null,
            declinedConsensus: null,
            delta: 1.7,
            approvedMarketId: null,
            declinedMarketId: null,
            ...nulls,
            options: [
              option('forward', 'Continue', 7.2, -1.7),
              option('left', 'Turn left', 8.9, 1.7),
              option('right', 'Turn right', 5.1, -3.8),
            ],
            rangeMin: 0,
            rangeMax: 144,
          },
        ],
      },
      {
        id: 'job-pair',
        number: 130,
        title: 'Add a second fruit',
        description: 'Two fruits on the board.',
        askUsd: 0,
        status: 'pending' as const,
        decideBy: DECIDE_BY,
        closedAt: null,
        lapsedAt: null,
        proposedByName: 'snake-operator',
        createdAt: new Date(Date.now() - 50 * 60_000).toISOString(),
        marketPairCount: 1,
        markets: [
          {
            metricId: 'len',
            metricName: 'Reached length',
            targetDate: TARGET,
            resolvesOn: RESOLVES,
            ...nulls,
            approvedConsensus: 9,
            declinedConsensus: 6,
            delta: 3,
            approvedMarketId: 'm-yes',
            declinedMarketId: 'm-no',
            approvedProbability: 0.5,
            declinedProbability: 0.5,
            approvedLiquidity: 200,
            declinedLiquidity: 200,
            rangeMin: 0,
            rangeMax: 144,
          },
        ],
      },
    ],
  });
  const trade = (id: string, handle: string, minutesAgo: number) => ({
    id,
    handle,
    direction: 'higher',
    kind: 'buy',
    shares: 10,
    cost: 4,
    createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  });
  /** Every book's own trades, as GET .../markets/:id/activity answers. */
  const tradesByMarket: Record<string, ReturnType<typeof trade>[]> = {
    'm-len': [trade('t-base', 'base-trader', 1)],
    'm-forward': [trade('t-forward', 'fwd-trader', 2)],
    'm-left': [trade('t-left', 'left-trader', 3)],
    'm-right': [trade('t-right', 'right-trader', 4)],
    'm-yes': [trade('t-yes', 'yes-trader', 5)],
    'm-no': [trade('t-no', 'no-trader', 6)],
  };
  const logRow = (id: string, text: string, href: string) => ({
    id,
    at: new Date(Date.now() - 60_000).toISOString(),
    kind: 'trade',
    workspace: { slug: 'snake', name: 'Snake' },
    actor: { id: 'a', handle: 'left-trader' },
    text,
    detail: { side: 'buy', direction: 'higher', shares: 10, cost: 4, callBefore: 8, callAfter: 9 },
    href,
  });
  const commentRow = (id: string, href: string) => ({
    id,
    at: new Date(Date.now() - 30_000).toISOString(),
    kind: 'comment',
    workspace: { slug: 'snake', name: 'Snake' },
    actor: { id: 'b', handle: 'talker' },
    text: 'on Reached length: Cheap at 6.',
    detail: { on: 'market', marketId: 'm-len' },
    href,
  });
  const baseComments = () => [
    { id: 'c-old', fromName: 'quiet', content: 'First.', createdAt: new Date(Date.now() - 90_000).toISOString() },
    {
      id: 'c-base',
      fromName: 'talker',
      content: 'Cheap at 6.',
      createdAt: new Date(Date.now() - 30_000).toISOString(),
    },
  ];
  const actions = () => ({
    generatedAt: new Date().toISOString(),
    kinds: [],
    workspaces: [{ slug: 'snake', name: 'Snake', hidden: true }],
    rows: [
      commentRow('comment:c-base', '/snake#market=m-len&comment=c-base'),
      logRow('trade:t-left', 'bought 10 higher shares on the left book', '/snake#proposal=job-opt&trade=t-left'),
      logRow('trade:t-no', 'bought 10 higher shares on the declined book', '/snake#proposal=job-pair&trade=t-no'),
    ],
    next: null,
  });
  return { floor, tradesByMarket, actions, baseComments };
});

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));

vi.mock('../../components/MarketChart', () => ({
  GEOM: {
    wide: { W: 720, PAD_L: 46, PAD_R: 58, H: 260 },
    compact: { W: 400, PAD_L: 40, PAD_R: 50, H: 300 },
  },
  MarketChart: () => <div data-testid="call-chart" />,
}));

vi.mock('../../lib/api', () => {
  const explicit: Record<string, unknown> = {
    getMarketplaceWorkspace: vi.fn(async () => h.floor()),
    getActions: vi.fn(async () => h.actions()),
    getPublicMarketHistory: vi.fn(async () => []),
    getLeaderboard: vi.fn(async () => ({ participants: [] })),
    getMarketActivity: vi.fn(async (_slug: string, marketId: string) => ({
      consensus: null,
      positions: [],
      trades: h.tradesByMarket[marketId] ?? [],
      pool: [],
    })),
    getFloorComments: vi.fn(async (_slug: string, q: { marketId?: string }) =>
      q.marketId === 'm-len' ? h.baseComments() : [],
    ),
  };
  const api = new Proxy(explicit, {
    get(target, prop: string) {
      if (!(prop in target)) target[prop] = vi.fn(async () => []);
      return target[prop];
    },
  });
  return { api, setActiveWorkspace: vi.fn(), actionsQueryString: () => '' };
});

const { TradePage } = await import('../TradePage');

function renderFloor(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/:slug" element={<TradePage />} />
        <Route path="/:slug/p/:number" element={<TradePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const activityTab = () => screen.getByRole('button', { name: /^Activity/ });
const tradeRow = (id: string) => document.querySelector(`[data-trade-id="${id}"]`) as HTMLElement | null;

/** The proposal is open, its Activity tab is open, and that trade's row flashed. */
async function landedOn(title: string, tradeId: string) {
  await waitFor(() => expect(document.querySelector('.pubws-proposal-title')?.textContent).toContain(title));
  await waitFor(() => expect(activityTab().getAttribute('aria-expanded')).toBe('true'));
  await waitFor(() => expect(tradeRow(tradeId)?.className).toContain('is-flashed'));
  expect(tradeRow(tradeId)?.scrollIntoView).toHaveBeenCalled();
  // Exactly the one row: the others on the list stay plain.
  expect(document.querySelectorAll('.pubws-mkt-row.is-flashed')).toHaveLength(1);
}

beforeEach(() => {
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
  Element.prototype.scrollIntoView = vi.fn();
  sessionStorage.clear();
});
afterEach(() => vi.clearAllMocks());

describe('A PASTED TRADE ADDRESS LANDS ON THAT TRADE ON ITS PROPOSAL', () => {
  test('a trade on an option book of a proposal with options (the snake shape)', async () => {
    renderFloor('/snake#proposal=job-opt&trade=t-left');
    await landedOn('Step 42', 't-left');
    // The Activity list of a proposal with options holds every option's book.
    for (const id of ['t-forward', 't-left', 't-right']) expect(tradeRow(id)).toBeTruthy();
    expect(tradeRow('t-base')).toBeNull();
  });

  test('a trade on the declined branch of a two-branch proposal', async () => {
    renderFloor('/snake#proposal=job-pair&trade=t-no');
    await landedOn('Add a second fruit', 't-no');
    expect(tradeRow('t-yes')).toBeTruthy();
  });

  test('a trade on the approved branch of a two-branch proposal', async () => {
    renderFloor('/snake#proposal=job-pair&trade=t-yes');
    await landedOn('Add a second fruit', 't-yes');
  });
});

describe('A LIVE LOG ROW FOLLOWED FROM THE FLOOR LANDS ON THE THING IT NAMES', () => {
  test('from the plain floor, a row on an option book opens the proposal, the tab and the flash', async () => {
    const { container } = renderFloor('/snake');
    // The baseline book's activity has loaded before the click: its list must
    // never answer for the proposal's.
    await waitFor(() => expect(container.querySelector('.pubws-live')).toBeTruthy());
    const row = [...container.querySelectorAll('.pubws-live a.pubws-live-row')].find(
      a => a.getAttribute('href') === '/snake#proposal=job-opt&trade=t-left',
    ) as HTMLAnchorElement;
    expect(row).toBeTruthy();
    fireEvent.click(row);
    await landedOn('Step 42', 't-left');
  });

  test('from the plain floor with Activity already open on the baseline book', async () => {
    const { container } = renderFloor('/snake');
    await waitFor(() => expect(container.querySelector('.pubws-live')).toBeTruthy());
    await waitFor(() => expect(activityTab().textContent).toContain('(1)'));
    fireEvent.click(activityTab());
    await waitFor(() => expect(tradeRow('t-base')).toBeTruthy());
    const row = [...container.querySelectorAll('.pubws-live a.pubws-live-row')].find(
      a => a.getAttribute('href') === '/snake#proposal=job-pair&trade=t-no',
    ) as HTMLAnchorElement;
    fireEvent.click(row);
    await landedOn('Add a second fruit', 't-no');
  });

  test('from the plain floor, a comment row on the book on screen opens the thread and flashes that line', async () => {
    const { container } = renderFloor('/snake');
    await waitFor(() => expect(container.querySelector('.pubws-live')).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('button', { name: /^Discussion/ }).textContent).toContain('2'));
    const row = [...container.querySelectorAll('.pubws-live a.pubws-live-row')].find(
      a => a.getAttribute('href') === '/snake#market=m-len&comment=c-base',
    ) as HTMLAnchorElement;
    expect(row).toBeTruthy();
    fireEvent.click(row);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Discussion/ }).getAttribute('aria-expanded')).toBe('true'),
    );
    const line = () => document.querySelector('[data-comment-id="c-base"]') as HTMLElement | null;
    await waitFor(() => expect(line()?.className).toContain('is-flashed'));
    expect(line()?.scrollIntoView).toHaveBeenCalled();
    expect((document.querySelector('[data-comment-id="c-old"]') as HTMLElement).className).not.toContain('is-flashed');
  });
});
