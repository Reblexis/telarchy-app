import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';

// A full page render per test; under a loaded machine one ran past the
// five-second default. The rules each test checks are unchanged.
vi.setConfig({ testTimeout: 20_000 });

/**
 * A proposal with options shows one world per option (docs/ui-conventions.md,
 * "A proposal with options shows one world per option"; the API shape is
 * docs/guides/proposals.md, "More than two options").
 *
 * The page is the same page; only the parts that said "two" change, and
 * they change by counting: the worlds are the options, the hero is the
 * leader's lead, the question and the verb name the option, the chart draws
 * every option, the decision bar has one Choose per option, and a decided
 * one strikes every option but the chosen one.
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

const capabilities = ['read', 'trade'];
const user: { id: string; email: string } | null = null;

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

const chipsOf = (c: HTMLElement) => [...c.querySelectorAll('.pubws-optchip')] as HTMLElement[];

describe('PRESSING AN OPTION CHIP OPENS THAT PROPOSAL WITH THAT OPTION SELECTED (docs/ui-conventions.md)', () => {
  test('from the floor, the Turn right chip opens #129 on the Turn right world', async () => {
    const { container } = renderFloor('/snake');
    await waitFor(() => expect(chipsOf(container).length).toBe(3), { timeout: 5000 });
    const right = chipsOf(container).find(c => /Turn right/.test(words(c))) as HTMLElement;
    fireEvent.click(right);
    await opened(container);
    await waitFor(
      () => {
        const pressed = cellsOf(container).filter(c => c.getAttribute('aria-pressed') === 'true');
        expect(pressed).toHaveLength(1);
        expect(words(pressed[0])).toMatch(/Turn right/);
      },
      { timeout: 5000 },
    );
    expect(words(screen.getByRole('button', { name: /Bet Higher/ }))).toMatch(/Turn right/);
  });

  test('with the proposal already open, another chip switches the world without closing it', async () => {
    const { container } = renderFloor('/snake/p/129');
    await opened(container);
    await waitFor(() => expect(chipsOf(container).length).toBe(3), { timeout: 5000 });
    const fwd = chipsOf(container).find(c => /Continue/.test(words(c))) as HTMLElement;
    fireEvent.click(fwd);
    await waitFor(
      () => {
        const pressed = cellsOf(container).filter(c => c.getAttribute('aria-pressed') === 'true');
        expect(words(pressed[0])).toMatch(/Continue/);
      },
      { timeout: 5000 },
    );
    expect(container.querySelector('.pubws-proposal-head')).toBeTruthy();
  });
});
