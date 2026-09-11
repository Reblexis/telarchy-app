import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * A tie at the top has no leader (docs/guides/proposals.md, "More than two
 * options", "The number you are reading"; docs/ui-conventions.md, "A proposal
 * with options shows one world per option"). When two or more priced options
 * share the highest consensus the row's lead is zero: the hero prints "±0"
 * over "<metric> <date>, tied at the top", no cell reads "· leads" or wears
 * the leader's green, and no Choose button is green, the buttons keeping the
 * proposer's order. On the snake an untraded step prices every option the
 * same, and the page used to name the first one as leading.
 */

const h = vi.hoisted(() => {
  // Relative to the real clock: a fixed instant turns into "past the
  // deadline" (dead verbs, no ticket) the moment the suite runs after it.
  const soon = new Date(Date.now() + 60 * 60_000);
  soon.setUTCSeconds(0, 0);
  const TARGET = soon.toISOString().slice(0, 16);
  const RESOLVES = new Date(soon.getTime() + 60_000).toISOString();
  const DECIDE_BY = new Date(Date.now() + 30 * 60_000).toISOString();
  const option = (
    id: string,
    label: string,
    consensus: number | null,
    over: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    id,
    label,
    marketId: `m-${id}`,
    consensus,
    probability: consensus === null ? null : 0.5,
    liquidity: consensus === null ? 0 : 200,
    pool: consensus === null ? 0 : 300,
    traders: consensus === null ? 0 : 1,
    volume: consensus === null ? 0 : 20,
    delta: null,
    ...over,
  });
  /** Continue 7.2, Turn left 8.9 (the leader, by 1.7), Turn right 5.1. */
  const options = () => [
    option('forward', 'Continue', 7.2, { delta: -1.7 }),
    option('left', 'Turn left', 8.9, { delta: 1.7 }),
    option('right', 'Turn right', 5.1, { delta: -3.8 }),
  ];
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
    proposalStats: { total: 1, pending: 1, approved: 0, declined: 0 },
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
        id: 'job-1',
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
            options: options(),
            rangeMin: 0,
            rangeMax: 144,
          },
        ],
      },
    ],
  });
  return { floor, option, options, TARGET, RESOLVES };
});

let capabilities = ['read', 'trade'];
let user: { id: string; email: string } | null = null;

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user, loading: false }) }));

vi.mock('../../components/MarketChart', () => ({
  GEOM: {
    wide: { W: 720, PAD_L: 46, PAD_R: 58, H: 260 },
    compact: { W: 400, PAD_L: 40, PAD_R: 50, H: 300 },
  },
  MarketChart: ({ corner, others, endLabel }: { corner?: unknown; others?: unknown; endLabel?: string }) => (
    <div data-testid="call-chart" data-others={JSON.stringify(others ?? null)} data-end-label={endLabel ?? ''}>
      {corner as never}
    </div>
  ),
}));

vi.mock('../../lib/api', () => {
  const explicit: Record<string, unknown> = {
    getMarketplaceWorkspace: vi.fn(async () => h.floor()),
    getPublicMarketHistory: vi.fn(async (_slug: string, marketId: string) =>
      marketId.startsWith('m-') && marketId !== 'm-len'
        ? [
            { at: new Date(Date.now() - 20 * 60_000).toISOString(), consensus: 6 },
            { at: new Date(Date.now() - 5 * 60_000).toISOString(), consensus: 7 },
          ]
        : [],
    ),
    createProposal: vi.fn(async () => ({ id: 'job-new' })),
    getLeaderboard: vi.fn(async () => ({ participants: [] })),
    getMarketActivity: vi.fn(async () => ({ consensus: null, positions: [], trades: [] })),
    getFloorComments: vi.fn(async () => []),
    getProfile: vi.fn(async () => ({ capabilities })),
    getParticipant: vi.fn(async () => ({ balance: 500, id: 'agent-1' })),
    getPositions: vi.fn(async () => []),
    getLimitOrders: vi.fn(async () => []),
    approveProposal: vi.fn(async () => ({})),
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

function renderFloor(path = '/snake/p/129') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/:slug" element={<TradePage />} />
        <Route path="/:slug/p/:number" element={<TradePage />} />
      </Routes>
    </MemoryRouter>,
  );
}
const words = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function opened(container: HTMLElement) {
  await waitFor(() => expect(container.querySelector('.pubws-proposal-head')).toBeTruthy());
}
const cellsOf = (c: HTMLElement) => [...c.querySelectorAll('.pubws-world-cell')] as HTMLElement[];

function withFloor(mutate: (ws: ReturnType<typeof h.floor>) => void) {
  const ws = h.floor();
  mutate(ws);
  vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => ws as never);
  return ws;
}

beforeEach(() => {
  capabilities = ['read', 'trade'];
  user = null;
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
  vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => h.floor() as never);
  sessionStorage.clear();
});
afterEach(() => vi.clearAllMocks());

/** Set the one row's options to these prices, each delta its gap to the best other. */
function priceOptions(prices: [number | null, number | null, number | null]) {
  withFloor(ws => {
    const m = ws.proposals[0].markets[0];
    const ids = ['forward', 'left', 'right'];
    const labels = ['Continue', 'Turn left', 'Turn right'];
    const priced = prices.filter((p): p is number => p !== null);
    m.options = ids.map((id, i) => {
      const p = prices[i];
      const others = prices.filter((x, j): x is number => j !== i && x !== null);
      return h.option(id, labels[i], p, {
        delta: p === null || others.length === 0 ? null : p - Math.max(...others),
      });
    });
    const top = Math.max(...priced);
    m.delta = priced.length < 2 ? null : top - Math.max(...priced.filter(p => p !== top), top);
  });
}
const heroOf = (c: HTMLElement) => c.querySelector('.pubws-impact-hero') as HTMLElement;
const captionOf = (c: HTMLElement) => words(c.querySelector('.pubws-impact-what'));

async function expectTiedAtTheTop(container: HTMLElement) {
  expect(words(heroOf(container))).toBe('±0');
  expect(heroOf(container).classList.contains('is-up')).toBe(false);
  expect(heroOf(container).classList.contains('is-down')).toBe(false);
  expect(captionOf(container)).toMatch(/reached length.*, tied at the top$/i);
  expect(captionOf(container)).not.toMatch(/over the next best|the leader/);
  expect(container.querySelector('.pubws-world-cell.is-leader')).toBeNull();
  expect(container.textContent).not.toMatch(/· leads/);
}

describe('A TIE AT THE TOP HAS NO LEADER', () => {
  test('a tie at the top is not a lead: three options at one price print ±0 tied at the top and name no leader', async () => {
    priceOptions([7.2, 7.2, 7.2]);
    const { container } = renderFloor();
    await opened(container);
    await expectTiedAtTheTop(container);
    // No leader, so the page opens on the first priced option's world.
    expect(cellsOf(container)[1].getAttribute('aria-pressed')).toBe('true');
  });

  test('a tie at the top is not a lead: two options sharing the top above a third name no leader either', async () => {
    priceOptions([8.9, 8.9, 5.1]);
    const { container } = renderFloor();
    await opened(container);
    await expectTiedAtTheTop(container);
  });

  test('a tie at the top is not a lead: float noise between the top two is still a tie', async () => {
    priceOptions([5.1, 8.9, 8.9 + 1e-12]);
    const { container } = renderFloor();
    await opened(container);
    await expectTiedAtTheTop(container);
  });

  test('a clear leader still leads: its cell reads "· leads", wears the accent, and the caption names it', async () => {
    const { container } = renderFloor();
    await opened(container);
    expect(words(heroOf(container))).toMatch(/\+1\.7/);
    expect(captionOf(container)).toMatch(/Turn left over the next best/);
    expect(cellsOf(container)[2].classList.contains('is-leader')).toBe(true);
    expect(words(cellsOf(container)[2])).toMatch(/Turn left · leads/);
  });
});

describe('A TIE AT THE TOP HAS NO GREEN CHOOSE', () => {
  beforeEach(() => {
    capabilities = ['read', 'trade', 'manage'];
    user = { id: 'u-1', email: 'owner@example.com' };
  });
  const barOf = async (container: HTMLElement) => {
    await waitFor(() => expect(container.querySelector('.pubws-ownerbar')).toBeTruthy(), { timeout: 5000 });
    return container.querySelector('.pubws-ownerbar') as HTMLElement;
  };

  test("a tie at the top has no leader, so no Choose button is green and they keep the proposer's order (three-way)", async () => {
    priceOptions([7.2, 7.2, 7.2]);
    const { container } = renderFloor();
    await opened(container);
    const bar = await barOf(container);
    const buttons = [...bar.querySelectorAll('button')].map(b => words(b));
    expect(buttons.slice(0, 4)).toEqual(['Choose Continue', 'Choose Turn left', 'Choose Turn right', 'Decline']);
    expect(bar.querySelectorAll('.pubws-decide--approve')).toHaveLength(0);
  });

  test("a tie at the top has no leader, so no Choose button is green and they keep the proposer's order (two tied)", async () => {
    priceOptions([5.1, 8.9, 8.9]);
    const { container } = renderFloor();
    await opened(container);
    const bar = await barOf(container);
    const buttons = [...bar.querySelectorAll('button')].map(b => words(b));
    expect(buttons.slice(0, 4)).toEqual(['Choose Continue', 'Choose Turn left', 'Choose Turn right', 'Decline']);
    expect(bar.querySelectorAll('.pubws-decide--approve')).toHaveLength(0);
  });

  test('a clear leader still gets the green Choose, first', async () => {
    const { container } = renderFloor();
    await opened(container);
    const bar = await barOf(container);
    expect(bar.querySelectorAll('.pubws-decide--approve')).toHaveLength(1);
    expect(words(bar.querySelector('.pubws-decide--approve'))).toBe('Choose Turn left');
    expect(screen.getByRole('button', { name: 'Choose Turn left' })).toBe(bar.querySelector('button'));
  });
});
