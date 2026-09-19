import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * A proposal is a decision with a price (docs/ui-conventions.md, "A proposal
 * is a decision with a price", 2026-09-09; record notes/decisions/
 * ui-conventions.md).
 *
 * It reads top down (direction A, 2026-09-18): the title, the facts, what
 * the proposer would do, the strips with this proposal's impact on every
 * cell, the market's answer as one sentence with the impact inside it, the
 * worlds as bar rows that are the control, the verbs, then the rules and the
 * ruling below the trade.
 */

// Ten days out, never a fixed date: inside a day of the deadline the facts row
// says "decides in 14h" and a test pinned to a calendar day goes red.
const DECIDE_BY = vi.hoisted(() => new Date(Date.now() + 10 * 86_400_000).toISOString());

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
        decideBy: DECIDE_BY,
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
const { dayOf } = await import('../../lib/viewer-time');

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
    expect(text).toContain(dayOf(DECIDE_BY));
    expect(facts.querySelectorAll('svg').length).toBeGreaterThanOrEqual(3);
  });
});

describe('the strips say what it moves', () => {
  test('the metric strip prints no number here either: a metric is not a market', async () => {
    // Owner ask 2026-09-10, of the proposal view: "but again donet show any
    // numbers here".
    const { container } = renderFloor();
    await openProposal(container);
    const strip = screen.getByLabelText('Metrics');
    expect(strip.querySelector('.pubws-strip-val')).toBeNull();
    const tabs = [...strip.querySelectorAll('[role="tab"]')].map(t => words(t));
    expect(tabs[0]).toMatch(/^net revenue$/i);
    expect(tabs.join(' ')).not.toMatch(/\$300|±/);
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
    // The date strip prints the words; the metric strip, which prints no
    // numbers, is quiet and dead and says so on hover.
    const dates = [...screen.getByLabelText('Dates').querySelectorAll('[role="tab"]')] as HTMLElement[];
    expect(words(dates[0])).toContain('no liquidity');
    expect(dates[0].getAttribute('aria-disabled')).toBe('true');
    const reviews = [...screen.getByLabelText('Metrics').querySelectorAll('[role="tab"]')][1] as HTMLElement;
    expect(reviews.getAttribute('aria-disabled')).toBe('true');
    expect(reviews.getAttribute('title')).toBe('no liquidity');
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

  test('a funded pair keeps its impact on the dates, tagged with nothing', async () => {
    const { container } = renderFloor();
    await openProposal(container);
    const dates = [...screen.getByLabelText('Dates').querySelectorAll('[role="tab"]')] as HTMLElement[];
    const funded = dates.find(d => /\+\$300/.test(words(d))) as HTMLElement;
    expect(funded).toBeTruthy();
    expect(funded.getAttribute('aria-disabled')).not.toBe('true');
  });

  test('the dates strip carries the impact at each date', async () => {
    const { container } = renderFloor();
    await openProposal(container);
    const tabs = [...screen.getByLabelText('Dates').querySelectorAll('[role="tab"]')].map(t => words(t));
    expect(tabs.join(' ')).toMatch(/\+\$300|±/);
  });
});

describe("the market's answer is a sentence and the worlds are bars", () => {
  test('the sentence names both worlds, the metric and the date, and ends on the impact', async () => {
    const { container } = renderFloor();
    await openProposal(container);
    const verdict = container.querySelector('.pubws-verdict') as HTMLElement;
    expect(verdict).toBeTruthy();
    expect(words(verdict)).toMatch(
      /^Traders expect \$7,400 net revenue on .+ if this is approved, \$7,100 if it is declined\. That is \+\$300 for approving\.$/,
    );
  });

  test('the impact is the only coloured number in the sentence, green when up', async () => {
    const { container } = renderFloor();
    await openProposal(container);
    const hero = container.querySelector('.pubws-verdict .pubws-impact-hero') as HTMLElement;
    expect(words(hero)).toBe('+$300');
    expect(hero.className).toMatch(/is-up/);
    expect(container.querySelectorAll('.pubws-verdict .is-up, .pubws-verdict .is-down')).toHaveLength(1);
  });

  test('no bare number stands alone over a caption any more', async () => {
    const { container } = renderFloor();
    await openProposal(container);
    expect(container.querySelector('.pubws-impact-what')).toBeNull();
    expect(container.textContent).not.toMatch(/approved versus declined/i);
  });

  test('a pair nobody has priced says so instead of inventing a sentence', async () => {
    const g = h.grid();
    for (const m of g.proposals[0].markets) {
      Object.assign(m, { approvedConsensus: null, declinedConsensus: null, delta: null });
    }
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => g as never);
    const { container } = renderFloor();
    await openProposal(container);
    const verdict = container.querySelector('.pubws-verdict');
    if (verdict) expect(words(verdict)).toBe('Not yet priced.');
    expect(container.textContent).not.toMatch(/Traders expect/);
  });

  test('a negative impact is red and keeps its sign', async () => {
    const g = h.grid();
    const pair = g.proposals[0].markets.find(m => m.metricId === 'rev')!;
    Object.assign(pair, { approvedConsensus: 7_000, declinedConsensus: 7_100, delta: -100 });
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => g as never);
    const { container } = renderFloor();
    await openProposal(container);
    const hero = container.querySelector('.pubws-verdict .pubws-impact-hero') as HTMLElement;
    expect(words(hero)).toMatch(/^[-\u2212]\$100$/);
    expect(hero.className).toMatch(/is-down/);
  });

  test('last read, if approved and if declined are three rows, and the two worlds switch the branch', async () => {
    const { container } = renderFloor();
    await openProposal(container);
    const cells = [...container.querySelectorAll('.pubws-world-cell')];
    expect(cells).toHaveLength(3);
    expect(words(cells[0])).toMatch(/last read/i);
    expect(cells[0].tagName).not.toBe('BUTTON');
    const approved = cells[1] as HTMLElement;
    const declined = cells[2] as HTMLElement;
    expect(approved.getAttribute('aria-pressed')).toBe('true');
    expect(declined.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(declined);
    await waitFor(() => expect(declined.getAttribute('aria-pressed')).toBe('true'));
    expect(container.querySelector('.pubws-branch')).toBeNull();
  });

  test('every world row draws a bar against the largest value on screen', async () => {
    const { container } = renderFloor();
    await openProposal(container);
    const bars = [...container.querySelectorAll('.pubws-world-cell .pubws-world-bar > i')] as HTMLElement[];
    expect(bars).toHaveLength(3);
    const width = (el: HTMLElement) => Number.parseFloat(el.style.width);
    // if approved (7,400) is the largest, so it is the full bar.
    expect(width(bars[1])).toBeCloseTo(100, 0);
    expect(width(bars[2])).toBeCloseTo((7_100 / 7_400) * 100, 0);
    expect(width(bars[2])).toBeLessThan(width(bars[1]));
  });

  test('the worlds are a stack of rows, not a row of cells', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const css = readFileSync(join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'style.css'), 'utf8');
    const rule = css.match(/\.pubws-worlds \{([^}]*)\}/);
    expect(rule).toBeTruthy();
    expect(rule![1]).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(rule![1]).not.toMatch(/repeat\(3,/);
    // A sentence is a block of text: left-aligned (no centred text blocks).
    const verdict = css.match(/\.pubws-verdict \{([^}]*)\}/);
    expect(verdict).toBeTruthy();
    expect(verdict![1]).not.toMatch(/text-align:\s*center/);
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

describe('the words come first, the rules stay below the trade', () => {
  test('what the proposer would do sits under the facts and above every number', async () => {
    const { container } = renderFloor();
    await openProposal(container);
    const head = container.querySelector('.pubws-proposal-head') as HTMLElement;
    const details = container.querySelector('.pubws-proposal-words') as HTMLElement;
    const verdict = container.querySelector('.pubws-verdict') as HTMLElement;
    const bet = container.querySelector('.pubws-bet') as HTMLElement;
    expect(details).toBeTruthy();
    expect(words(details)).toMatch(/^What Ada would do/);
    expect(words(details)).toContain('A better store page');
    expect(follows(head, details)).toBe(true);
    expect(follows(details, verdict)).toBe(true);
    expect(follows(details, bet)).toBe(true);
    expect(container.querySelectorAll('.pubws-proposal-words')).toHaveLength(1);
  });

  test('how this decides stays below the trade', async () => {
    const { container } = renderFloor();
    await openProposal(container);
    const bet = container.querySelector('.pubws-bet') as HTMLElement;
    const decides = container.querySelector('.pubws-decides') as HTMLElement;
    expect(follows(bet, decides)).toBe(true);
    expect(container.querySelector('.pubws-proposal-words .pubws-decides')).toBeNull();
  });

  test('the ruling is below the words, and only a manager sees it', async () => {
    const { container } = renderFloor();
    await openProposal(container);
    // A visitor: no ruling anywhere.
    expect(container.querySelector('.pubws-ruling')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull();
  });
});

describe('a newcomer can tell what a proposal is', () => {
  /**
   * A review of the live page scored it 3/10 for a first-time visitor
   * (notes/proposal-page-review-2026-09-10.md): it never said that approving
   * pays anybody, its hero could be read as growth from today, it stated no
   * question, and two different numbers were both called "now".
   */
  test('the ask says what approving does to it, in the facts row', async () => {
    const { container } = renderFloor();
    await openProposal(container);
    const facts = container.querySelector('.pubws-proposal-head .pubws-prow-meta') as HTMLElement;
    expect(words(facts)).toContain('$80 if approved');
    // No sentence above the trade explaining the mechanism (Viktor,
    // 2026-09-10: "seems like too much of a detail").
    expect(container.querySelector('.pubws-proposal-deal')).toBeNull();
  });

  test('the mechanism is one block below the trade, and says what a ruling does', async () => {
    const { container } = renderFloor();
    await openProposal(container);
    const rules = container.querySelector('.pubws-decides') as HTMLElement;
    expect(words(rules)).toMatch(/how this decides/i);
    expect(words(rules)).toContain('Approving pays Ada $80');
    expect(words(rules)).toMatch(/two markets/i);
    // The engine's real behaviour: the unrealized world is refunded at cost.
    expect(words(rules)).toMatch(/refunded at what it cost/i);
    expect(words(rules)).toMatch(/lapses/i);
    // Below the trade, after the proposal's own words.
    const w = container.querySelector('.pubws-proposal-words') as HTMLElement;
    expect(follows(w, rules)).toBe(true);
  });

  test('a proposal that asks for nothing says so in both places', async () => {
    const ws = h.grid();
    ws.proposals[0].askUsd = 0;
    ws.proposals[0].title = 'Rewrite the store page';
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => ws as never);
    const { container } = renderFloor();
    await openProposal(container);
    expect(words(container.querySelector('.pubws-proposal-head .pubws-prow-meta'))).toContain('no payment asked');
    expect(words(container.querySelector('.pubws-decides'))).toContain('Approving commits LookPilot to the work');
  });

  test('the question sits under the worlds and above the chart, and follows the branch', async () => {
    const { container } = renderFloor();
    await openProposal(container);
    const q = container.querySelector('.pubws-proposal-q') as HTMLElement;
    expect(words(q)).toMatch(/^If approved, what will LookPilot's net revenue be on /i);
    const cells = [...container.querySelectorAll('.pubws-world-cell')];
    expect(follows(cells[2], q)).toBe(true);
    fireEvent.click(cells[2] as HTMLElement);
    await waitFor(() => expect(words(container.querySelector('.pubws-proposal-q'))).toMatch(/^If declined/i));
  });

  test('the baseline is "without it": only one number on the page is called now', async () => {
    const { container } = renderFloor();
    await openProposal(container);
    expect(words(container.querySelector('.pubws-world-cell--now'))).toMatch(/^last read/i);
    expect(words(container.querySelector('.pubws-world-cell--now'))).not.toMatch(/\bnow\b/i);
  });

  test('the reading says WHEN it was read, in words that follow "last read"', async () => {
    const ws = h.grid();
    const at = new Date(Date.now() - 4 * 86_400_000).toISOString();
    // The reading the cell prints is the last point of the horizon's history.
    for (const h2 of ws.horizonHistories) (h2.points as unknown[]).push({ at, value: 7_000 });
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => ws as never);
    const { container } = renderFloor();
    await openProposal(container);
    const cell = words(container.querySelector('.pubws-world-cell--now'));
    // Never "4 days old" or "reported today" after the words "last read".
    expect(cell).not.toMatch(/old/i);
    expect(cell).not.toMatch(/reported/i);
  });
});

describe('the address and the sentence read right for a stranger', () => {
  const renderAt = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/:slug" element={<TradePage />} />
          <Route path="/:slug/p/:number" element={<TradePage />} />
        </Routes>
      </MemoryRouter>,
    );

  test('an address that names no proposal says so, and shows the plain floor', async () => {
    const { container } = renderAt('/lookpilot/p/999');
    await waitFor(() => expect(container.querySelector('.pubws-proposal-missing')).toBeTruthy());
    expect(words(container.querySelector('.pubws-proposal-missing'))).toBe('No proposal #999 on this floor.');
    expect(container.querySelector('.pubws-proposal-head')).toBeNull();
    expect(container.querySelector('.pubws-instrument-ask')).toBeTruthy();
  });

  test('an address that names a real proposal says nothing of the sort', async () => {
    const { container } = renderAt('/lookpilot/p/7');
    await waitFor(() => expect(container.querySelector('.pubws-proposal-head')).toBeTruthy());
    expect(container.querySelector('.pubws-proposal-missing')).toBeNull();
  });

  test('a capitalised metric name reads in sentence case inside the question', async () => {
    const ws = h.grid();
    for (const m of ws.markets) if (m.metricId === 'rev') m.metricName = 'Active traders';
    for (const p of ws.proposals)
      for (const pm of p.markets) if (pm.metricId === 'rev') pm.metricName = 'Active traders';
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => ws as never);
    const { container } = renderAt('/lookpilot');
    await waitFor(() => expect(container.querySelector('.pubws-instrument-ask')).toBeTruthy());
    expect(words(container.querySelector('.pubws-instrument-ask'))).toMatch(/LookPilot's active traders/);
    await openProposal(container);
    expect(words(container.querySelector('.pubws-proposal-q'))).toMatch(/LookPilot's active traders/);
    expect(words(container.querySelector('.pubws-verdict'))).toMatch(/^Traders expect \S+ active traders /);
  });
});

test('an old chess move does not say decides now after its deadline', async () => {
  const floor = h.grid();
  floor.proposals[0].decideBy = '2020-01-01T00:00:00Z';
  vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(floor as never);
  const { container } = renderFloor();
  await openProposal(container);
  expect(words(container.querySelector('.pubws-chip--deadline'))).toBe('Decision overdue');
});

describe('a decided proposal says what was decided, what the market expected, and what happens next', () => {
  const decided = (status: 'approved' | 'declined' | 'lapsed') => {
    const g = h.grid();
    Object.assign(g.proposals[0], {
      status: status === 'lapsed' ? 'declined' : status,
      closedAt: '2026-09-18T14:36:00Z',
      lapsedAt: status === 'lapsed' ? '2026-09-18T14:36:00Z' : null,
    });
    vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => g as never);
    return g;
  };
  const openDecided = async () => {
    const view = render(
      <MemoryRouter initialEntries={['/lookpilot/p/7']}>
        <Routes>
          <Route path="/:slug/p/:number" element={<TradePage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(view.container.querySelector('.pubws-proposal-head')).toBeTruthy());
    return view;
  };
  const rowsOf = (c: HTMLElement) => [...c.querySelectorAll('.pubws-decided-row')].map(r => words(r));

  test('an approval records the if-approved value, and says the declined world was refunded', async () => {
    decided('approved');
    const { container } = await openDecided();
    const rec = container.querySelector('.pubws-decided') as HTMLElement;
    expect(rec).toBeTruthy();
    expect(rowsOf(container)[0]).toMatch(/^market expected, at the decision ?\$7,400$/i);
    expect(rowsOf(container).some(r => /^settles ?\d/i.test(r))).toBe(true);
    expect(words(rec)).toContain('The declined world was voided. Every bet on it was refunded at cost.');
    // It sits where the ticket was: under the closed line.
    const line = container.querySelector('.pubws-closed-line') as HTMLElement;
    expect(follows(line, rec)).toBe(true);
  });

  test('a decline records the if-declined value, and says the approved world was refunded', async () => {
    decided('declined');
    const { container } = await openDecided();
    expect(rowsOf(container)[0]).toMatch(/\$7,100$/);
    expect(words(container.querySelector('.pubws-decided'))).toContain(
      'The approved world was voided. Every bet on it was refunded at cost.',
    );
  });

  test('a lapse counts as a decline', async () => {
    decided('lapsed');
    const { container } = await openDecided();
    expect(rowsOf(container)[0]).toMatch(/\$7,100$/);
  });

  test('a pending proposal has no record: nothing is decided', async () => {
    const { container } = renderFloor();
    await openProposal(container);
    expect(container.querySelector('.pubws-decided')).toBeNull();
    expect(container.textContent).not.toMatch(/was voided/);
  });
});
