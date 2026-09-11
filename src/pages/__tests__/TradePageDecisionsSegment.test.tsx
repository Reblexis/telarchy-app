import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * DECISIONS is the chart's third segment: the forks, on the number
 * (docs/ui-conventions.md, "The price and the chart", the DECISIONS segment).
 *
 * Built on the one-chart floor's fixture: the same 2x2 grid, with decided
 * proposals priced on the market on screen. What is pinned: every decided
 * proposal on this market's pair is a node, the most recent is open, the
 * line under the plot names it and links to its page, and a date nobody
 * decided on says so instead of drawing an empty picture.
 *
 * The one-chart floor's own note follows, because the fixture is its:
 * There is ONE chart, and how the call moved is a mode of it
 * (docs/ui-conventions.md, "The price and the chart", revised 2026-09-09;
 * record notes/decisions/ui-conventions.md).
 *
 * Two charts stacked cost 340px of the first screen and pushed the two bet
 * verbs to 1035px on a 1000px viewport, below the fold, which is the one
 * thing a trading page may not do. And the open dates in the settlement band
 * are the date control: a reader who can see them priced differently and
 * cannot press them is being shown a control that is not one.
 */

const h = vi.hoisted(() => {
  const market = (
    id: string,
    metricId: string,
    metricName: string,
    targetDate: string,
    resolvesOn: string,
    metricOrder: number,
    consensus: number | null,
  ) => ({
    marketId: id,
    metricId,
    metricName,
    metricOrder,
    targetDate,
    resolvesOn,
    consensus,
    probability: 0.5,
    liquidity: 200,
    pool: 3000,
    traderCount: 2,
    tradedVolume: 40,
    rangeMin: 0,
    rangeMax: 50_000,
  });
  /** Two metrics, each on this week and on 30 Sep: a 2x2 grid. */
  const grid = () => ({
    workspaceId: 'ws-1',
    name: 'LookPilot',
    slug: 'lookpilot',
    ownerId: null,
    ownerHandle: null,
    description: 'Webcam head tracker for sims',
    charter: null,
    visibility: 'public',
    proposalReward: 0,
    spamPenalty: 0,
    joinAs: 'viewer' as const,
    signupCredits: 100,
    metricCount: 2,
    openMarketCount: 4,
    participantCount: 3,
    proposalStats: { total: 0, pending: 0, approved: 0, declined: 0 },
    markets: [
      market('rev-week', 'rev', 'LookPilot net revenue (USD)', '2026-W38', '2026-09-21T00:00:00Z', 0, 6_850),
      market('rev-sep', 'rev', 'LookPilot net revenue (USD)', '2026-10', '2026-11-01T00:00:00Z', 0, 7_100),
      market('rev-week-2', 'reviews', 'Steam reviews (count)', '2026-W38', '2026-09-21T00:00:00Z', 1, 41),
      market('rev-sep-2', 'reviews', 'Steam reviews (count)', '2026-10', '2026-11-01T00:00:00Z', 1, 55),
    ],
    marketHistory: [],
    marketHistoryMarketId: 'rev-sep',
    horizonHistories: [
      { marketId: 'rev-week', periodStart: '2026-08-31', points: [], description: 'Revenue.' },
      { marketId: 'rev-sep', periodStart: '2026-09-01', points: [], description: 'Revenue.' },
      { marketId: 'rev-week-2', periodStart: '2026-08-31', points: [], description: 'Reviews.' },
      { marketId: 'rev-sep-2', periodStart: '2026-09-01', points: [], description: 'Reviews.' },
    ],
    proposals: [],
  });
  const single = () => {
    const ws = grid();
    ws.markets = [ws.markets[1]];
    ws.horizonHistories = [ws.horizonHistories[1]];
    ws.metricCount = 1;
    ws.openMarketCount = 1;
    return ws;
  };
  return { grid, single };
});

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));

vi.mock('../../components/MarketChart', () => ({
  GEOM: {
    wide: { W: 720, PAD_L: 46, PAD_R: 58, H: 260 },
    compact: { W: 400, PAD_L: 40, PAD_R: 50, H: 300 },
  },
  MarketChart: ({ corner }: { corner?: unknown }) => <div data-testid="call-chart">{corner as never}</div>,
}));

vi.mock('../../lib/api', () => {
  const explicit: Record<string, unknown> = {
    getMarketplaceWorkspace: vi.fn(async () => h.grid()),
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
const { api } = await import('../../lib/api');

function renderFloor() {
  return render(
    <MemoryRouter initialEntries={['/lookpilot']}>
      <Routes>
        <Route path="/:slug" element={<TradePage />} />
      </Routes>
    </MemoryRouter>,
  );
}
const mode = (name: string) => screen.getByRole('button', { name });

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

/** A decided proposal with one pair on (metric, date). */
function decidedProposal(
  id: string,
  number: number,
  status: string,
  days: number,
  metricId: string,
  targetDate: string,
) {
  return {
    id,
    number,
    title: `Proposal ${number}`,
    description: '',
    askUsd: 0,
    status,
    resolvedAt: ago(days),
    declineReason: null,
    decideBy: ago(days - 1),
    closedAt: ago(days),
    lapsedAt: null,
    proposedByName: 'Jason',
    createdAt: ago(days + 1),
    marketPairCount: 1,
    markets: [
      {
        metricId,
        metricName: metricId === 'rev' ? 'LookPilot net revenue (USD)' : 'Steam reviews (count)',
        targetDate,
        resolvesOn: '2026-11-01T00:00:00Z',
        approvedConsensus: 7_300,
        declinedConsensus: 6_900,
        delta: 400,
        approvedMarketId: `${id}-a`,
        declinedMarketId: `${id}-d`,
        approvedProbability: 0.5,
        approvedLiquidity: 100,
        declinedProbability: 0.5,
        declinedLiquidity: 100,
        rangeMin: 0,
        rangeMax: 50_000,
      },
    ],
  };
}

function floorWithDecisions() {
  const ws = h.single() as ReturnType<typeof h.single> & { proposals: unknown[] };
  ws.horizonHistories = [
    {
      ...ws.horizonHistories[0],
      points: [
        { at: ago(20), value: 6_700 },
        { at: ago(2), value: 6_850 },
      ],
    } as never,
  ];
  ws.proposals = [
    decidedProposal('p3', 3, 'approved', 9, 'rev', '2026-10'),
    decidedProposal('p4', 4, 'declined', 4, 'rev', '2026-10'),
    // Priced on another metric: not a decision about this number.
    decidedProposal('p5', 5, 'approved', 3, 'reviews', '2026-10'),
    // Still pending: not a decision at all.
    { ...decidedProposal('p6', 6, 'pending', 1, 'rev', '2026-10'), resolvedAt: null, closedAt: null },
  ];
  return ws;
}

beforeEach(() => {
  sessionStorage.clear();
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
  vi.mocked(api.getMarketplaceWorkspace).mockReset();
});

describe('DECISIONS is the third segment of the chart', () => {
  test('every floor has it, after Value and Call', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => floorWithDecisions() as never);
    renderFloor();
    await waitFor(() => expect(mode('Decisions')).toBeTruthy());
    const words = Array.from(document.querySelectorAll('.pubws-seg--chart .pubws-seg-btn')).map(b => b.textContent);
    expect(words.slice(0, 3)).toEqual(['Value', 'Call', 'Decisions']);
  });

  test('EVERY DECIDED PROPOSAL PRICED ON THIS MARKET IS A NODE, the most recent open and named under the plot', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => floorWithDecisions() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(mode('Decisions')).toBeTruthy());
    fireEvent.click(mode('Decisions'));
    await waitFor(() => expect(container.querySelectorAll('.nchart-fork')).toHaveLength(2));
    expect(container.querySelector('.nchart-fork.is-open')?.getAttribute('data-fork')).toBe('p4');
    const caption = container.querySelector('.nchart-fork-caption') as HTMLElement;
    expect(caption.textContent).toContain('#4');
    expect(caption.textContent).toContain('declined');
    expect(caption.querySelector('a')?.getAttribute('href')).toBe('/lookpilot/p/4');
  });

  test('pressing another node opens that decision', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => floorWithDecisions() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(mode('Decisions')).toBeTruthy());
    fireEvent.click(mode('Decisions'));
    await waitFor(() => expect(container.querySelector('.nchart-fork[data-fork="p3"]')).toBeTruthy());
    fireEvent.click(container.querySelector('.nchart-fork[data-fork="p3"]') as Element);
    await waitFor(() => expect(container.querySelector('.nchart-fork.is-open')?.getAttribute('data-fork')).toBe('p3'));
    expect(container.querySelector('.nchart-fork-caption')?.textContent).toContain('#3');
  });

  test('a date nobody decided on says so instead of drawing an empty picture', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => h.single() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(mode('Decisions')).toBeTruthy());
    fireEvent.click(mode('Decisions'));
    await waitFor(() => expect(container.textContent).toContain('no decision priced on this date yet'));
    expect(container.querySelector('.nchart-fork')).toBeNull();
    expect(container.querySelector('.nchart-fork-caption')).toBeNull();
  });
});
