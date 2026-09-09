import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * A proposal is a decision with a price (docs/ui-conventions.md, "A proposal
 * is a decision with a price", 2026-09-09; record notes/decisions/
 * ui-conventions.md).
 *
 * The title is the headline, the strips carry this proposal's impact on
 * every cell of the grid, the impact is the hero with the two worlds as the
 * control under it, the world rides the verb, and the words and the ruling
 * are below the trade. Nothing that is prose or a control stands between the
 * title and the number.
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
    joinAs: 'trader' as const,
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
    proposals: [
      {
        id: 'job-1',
        number: 7,
        title: '$80: rewrite the store page',
        description: 'A better store page.',
        askUsd: 80,
        status: 'pending' as const,
        decideBy: '2026-09-20T00:00:00Z',
        closedAt: null,
        lapsedAt: null,
        proposedByName: 'Ada',
        createdAt: '2026-08-12T09:00:00.000Z',
        marketPairCount: 2,
        markets: [
          {
            metricId: 'reviews',
            metricName: 'Steam reviews (count)',
            targetDate: '2026-10',
            resolvesOn: '2026-11-01T00:00:00Z',
            approvedConsensus: 55,
            declinedConsensus: 55,
            delta: 0,
            approvedMarketId: 'm-a2',
            declinedMarketId: 'm-d2',
            approvedProbability: 0.5,
            approvedLiquidity: 200,
            declinedProbability: 0.5,
            declinedLiquidity: 200,
            approvedPool: 3_000,
            declinedPool: 3_000,
            approvedTraders: 0,
            declinedTraders: 0,
            approvedVolume: 0,
            declinedVolume: 0,
            rangeMin: 0,
            rangeMax: 200,
          },
          {
            metricId: 'rev',
            metricName: 'LookPilot net revenue (USD)',
            targetDate: '2026-10',
            resolvesOn: '2026-11-01T00:00:00Z',
            approvedConsensus: 7_400,
            declinedConsensus: 7_100,
            delta: 300,
            approvedMarketId: 'm-approved',
            declinedMarketId: 'm-declined',
            approvedProbability: 0.5,
            approvedLiquidity: 200,
            declinedProbability: 0.5,
            declinedLiquidity: 200,
            approvedPool: 3_000,
            declinedPool: 3_000,
            approvedTraders: 1,
            declinedTraders: 0,
            approvedVolume: 50,
            declinedVolume: 0,
            rangeMin: 0,
            rangeMax: 50_000,
          },
        ],
      },
    ],
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

// A visitor: the anonymous poster is where the ticket has to be visible
// from the first screen, because signing up IS the intent signal.
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
    getProfile: vi.fn(async () => ({ capabilities: ['read', 'trade'] })),
    getParticipant: vi.fn(async () => ({ balance: 500, id: 'agent-1' })),
    getPositions: vi.fn(async () => []),
    getLimitOrders: vi.fn(async () => []),
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
const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const words = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function openProposal(container: HTMLElement) {
  await waitFor(() => expect(container.querySelector('.pubws-ballot-row')).toBeTruthy());
  fireEvent.click(container.querySelector('.pubws-ballot-row') as HTMLElement);
  await waitFor(() => expect(container.querySelector('.pubws-proposal-head')).toBeTruthy());
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
  vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => h.grid() as never);
  sessionStorage.clear();
});
afterEach(() => vi.clearAllMocks());

describe('the title is the headline, and the facts are one line under it', () => {
  test('the proposal leads with its number and title, not a conditional sentence', async () => {
    const { container } = renderFloor();
    await openProposal(container);
    const head = container.querySelector('.pubws-proposal-head') as HTMLElement;
    expect(words(head.querySelector('.pubws-proposal-title'))).toContain('rewrite the store page');
    expect(words(head.querySelector('.pubws-proposal-title'))).toContain('#7');
    // The conditional question is gone with it.
    expect(container.querySelector('.pubws-instrument-ask')).toBeNull();
    expect(container.textContent).not.toMatch(/What will be LookPilot's/);
  });

  test('the four facts are one icon row: proposer, ask, decision, pool', async () => {
    const { container } = renderFloor();
    await openProposal(container);
    const facts = container.querySelector('.pubws-proposal-head .pubws-prow-meta') as HTMLElement;
    const text = words(facts);
    expect(text).toContain('Ada');
    expect(text).toContain('$80');
    expect(text).toMatch(/20 Sep/);
    expect(facts.querySelectorAll('svg').length).toBeGreaterThanOrEqual(3);
  });
});

describe('the strips say what it moves', () => {
  test('every metric tab carries this proposal&rsquo;s impact on that metric', async () => {
    const { container } = renderFloor();
    await openProposal(container);
    const strip = screen.getByLabelText('Metrics');
    const tabs = [...strip.querySelectorAll('[role="tab"]')].map(t => words(t));
    expect(tabs[0]).toMatch(/\+\$300/);
    expect(tabs[1]).toMatch(/±0/);
  });

  test('a pair with no liquidity says so, and cannot be pressed', async () => {
    // Owner ask 2026-09-09, replacing "untraded": "its just useless tag..
    // if liuqidity isnt present.. then just dont make it clickable".
    const ws = h.grid();
    const pair = ws.proposals[0].markets[0];
    pair.approvedLiquidity = 0;
    pair.declinedLiquidity = 0;
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => ws as never);
    const { container } = renderFloor();
    await openProposal(container);
    const strip = screen.getByLabelText('Metrics');
    const reviews = [...strip.querySelectorAll('[role="tab"]')][1] as HTMLElement;
    expect(words(reviews)).toContain('no liquidity');
    expect(reviews.getAttribute('aria-disabled')).toBe('true');
    const before = reviews.getAttribute('aria-selected');
    fireEvent.click(reviews);
    expect(reviews.getAttribute('aria-selected')).toBe(before);
  });

  test('nothing anywhere says untraded any more', async () => {
    const { container } = renderFloor();
    await openProposal(container);
    expect(container.querySelector('.pubws-strip-note')).toBeNull();
    expect(container.textContent).not.toMatch(/untraded/i);
  });

  test('a funded pair keeps its impact, tagged with nothing', async () => {
    const { container } = renderFloor();
    await openProposal(container);
    const strip = screen.getByLabelText('Metrics');
    const rev = [...strip.querySelectorAll('[role="tab"]')][0] as HTMLElement;
    expect(words(rev)).toMatch(/\+\$300/);
    expect(rev.getAttribute('aria-disabled')).not.toBe('true');
  });

  test('the dates strip carries the impact at each date', async () => {
    const { container } = renderFloor();
    await openProposal(container);
    const tabs = [...screen.getByLabelText('Dates').querySelectorAll('[role="tab"]')].map(t => words(t));
    expect(tabs.join(' ')).toMatch(/\+\$300|±/);
  });
});

describe('the impact is the number and the two worlds are the control', () => {
  test('the hero is the impact, over a caption naming the metric and the date', async () => {
    const { container } = renderFloor();
    await openProposal(container);
    const hero = container.querySelector('.pubws-impact-hero') as HTMLElement;
    expect(words(hero)).toMatch(/\+\$300/);
    expect(words(hero.parentElement)).toMatch(/if approved/i);
  });

  test('now, if approved and if declined are three cells, and the two worlds switch the branch', async () => {
    const { container } = renderFloor();
    await openProposal(container);
    const cells = [...container.querySelectorAll('.pubws-world-cell')];
    expect(cells).toHaveLength(3);
    expect(words(cells[0])).toMatch(/now/i);
    const approved = cells[1] as HTMLElement;
    const declined = cells[2] as HTMLElement;
    expect(approved.getAttribute('aria-pressed')).toBe('true');
    expect(declined.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(declined);
    await waitFor(() => expect(declined.getAttribute('aria-pressed')).toBe('true'));
    // The pills they replaced are gone.
    expect(container.querySelector('.pubws-branch')).toBeNull();
  });

  test('the three worlds are one row of cells, not a stack', async () => {
    // The stylesheet is what makes them a row; a regex sweep of dead rules
    // deleted .pubws-worlds once and the cells stacked on the preview
    // (2026-09-09), which the DOM tests could not see.
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const css = readFileSync(join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'style.css'), 'utf8');
    const rule = css.match(/\.pubws-worlds \{([^}]*)\}/);
    expect(rule).toBeTruthy();
    expect(rule![1]).toMatch(/grid-template-columns:\s*repeat\(3,/);
  });

  test('the world rides the verb', async () => {
    const { container } = renderFloor();
    await openProposal(container);
    const bet = container.querySelector('.pubws-bet') as HTMLElement;
    expect(words(bet)).toMatch(/if approved/i);
    fireEvent.click(container.querySelectorAll('.pubws-world-cell')[2] as HTMLElement);
    await waitFor(() => expect(words(container.querySelector('.pubws-bet'))).toMatch(/if declined/i));
  });
});

describe('nothing that is prose or a ruling stands between the title and the number', () => {
  test('the words sit below the trade, headed by the proposer', async () => {
    const { container } = renderFloor();
    await openProposal(container);
    const head = container.querySelector('.pubws-proposal-head') as HTMLElement;
    const hero = container.querySelector('.pubws-impact-hero') as HTMLElement;
    const bet = container.querySelector('.pubws-bet') as HTMLElement;
    const details = container.querySelector('.pubws-proposal-words') as HTMLElement;
    expect(details).toBeTruthy();
    expect(words(details)).toContain('A better store page');
    expect(follows(head, hero)).toBe(true);
    expect(follows(bet, details)).toBe(true);
  });

  test('the ruling is below the words, and only a manager sees it', async () => {
    const { container } = renderFloor();
    await openProposal(container);
    // A visitor: no ruling anywhere.
    expect(container.querySelector('.pubws-ruling')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull();
  });
});
