import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

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

/**
 * A second, SOONER date on the same metric, so the date strip is drawn (a
 * strip with one tab is not). The floor still opens on the furthest date,
 * which stays the fixture's own cell; the extra cell is priced the same.
 */
function addSoonerDate(ws: ReturnType<typeof h.floor>) {
  const sooner = new Date(new Date(h.RESOLVES).getTime() - 30 * 60_000);
  const target = new Date(sooner.getTime() - 60_000).toISOString().slice(0, 16);
  ws.markets.push({ ...ws.markets[0], marketId: 'm-len0', targetDate: target, resolvesOn: sooner.toISOString() });
  ws.proposals[0].markets.push({
    ...ws.proposals[0].markets[0],
    targetDate: target,
    resolvesOn: sooner.toISOString(),
    options: h.options().map(o => ({ ...o, marketId: `m0-${o.id}` })),
  });
}
const selectedDate = () =>
  ([...screen.getByLabelText('Dates').querySelectorAll('[role="tab"]')] as HTMLElement[]).find(
    t => t.getAttribute('aria-selected') === 'true',
  ) as HTMLElement;

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

describe('THE WORLDS ARE THE OPTIONS', () => {
  test("last read, then one cell per option in the proposer's order, captioned by the label, no declined cell", async () => {
    const { container } = renderFloor();
    await opened(container);
    const cells = cellsOf(container);
    expect(cells).toHaveLength(4);
    expect(words(cells[0])).toMatch(/last read/i);
    expect(words(cells[1])).toMatch(/^Continue/);
    expect(words(cells[2])).toMatch(/^Turn left/);
    expect(words(cells[3])).toMatch(/^Turn right/);
    // "Turn left", not "if turn left"; and no declined world anywhere.
    expect(container.textContent).not.toMatch(/if turn left|if declined|if approved/i);
    expect(container.querySelector('.pubws-world-cell--declined')).toBeNull();
    // Each option cell carries its own price.
    expect(words(cells[1])).toMatch(/7\.2/);
    expect(words(cells[2])).toMatch(/8\.9/);
    expect(words(cells[3])).toMatch(/5\.1/);
  });

  test('the leader wears the accent and is the selected world by default; pressing another cell switches', async () => {
    const { container } = renderFloor();
    await opened(container);
    const [, fwd, left, right] = cellsOf(container);
    expect(left.classList.contains('is-leader')).toBe(true);
    expect(fwd.classList.contains('is-leader')).toBe(false);
    expect(right.classList.contains('is-leader')).toBe(false);
    expect(left.getAttribute('aria-pressed')).toBe('true');
    expect(fwd.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(fwd);
    await waitFor(() => expect(fwd.getAttribute('aria-pressed')).toBe('true'), { timeout: 5000 });
    expect(left.getAttribute('aria-pressed')).toBe('false');
    // The leader keeps its accent whichever world is on the chart.
    expect(left.classList.contains('is-leader')).toBe(true);
  });

  test('an unpriced option says no liquidity and cannot be pressed', async () => {
    withFloor(ws => {
      ws.proposals[0].markets[0].options[2] = h.option('right', 'Turn right', null);
    });
    const { container } = renderFloor();
    await opened(container);
    const right = cellsOf(container)[3] as HTMLButtonElement;
    expect(words(right)).toMatch(/no liquidity/i);
    expect(right.disabled).toBe(true);
    fireEvent.click(right);
    expect(right.getAttribute('aria-pressed')).toBe('false');
  });

  test('with no leader (fewer than two priced) the first option is the selected world', async () => {
    withFloor(ws => {
      const m = ws.proposals[0].markets[0];
      m.options[0] = h.option('forward', 'Continue', null);
      m.options[2] = h.option('right', 'Turn right', null);
      m.options[1] = h.option('left', 'Turn left', 8.9);
      m.delta = null;
    });
    const { container } = renderFloor();
    await opened(container);
    const cells = cellsOf(container);
    // Continue is unpriced, so the first PRICED option is the world on the page.
    expect(cells[2].getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.pubws-world-cell.is-leader')).toBeNull();
  });
});

describe('THE HERO IS THE LEAD', () => {
  test("the big number is the leader's consensus minus the best other option, captioned with the leader over the next best", async () => {
    const { container } = renderFloor();
    await opened(container);
    const hero = container.querySelector('.pubws-impact-hero') as HTMLElement;
    expect(words(hero)).toMatch(/\+1\.7/);
    expect(hero.classList.contains('is-up')).toBe(true);
    const caption = words(container.querySelector('.pubws-impact-what'));
    expect(caption).toMatch(/reached length/i);
    expect(caption).toMatch(/Turn left over the next best/);
    expect(caption).not.toMatch(/approved versus declined/i);
  });

  test('fewer than two priced options: "no lead yet" in place of the number, and the strip prints "open"', async () => {
    withFloor(ws => {
      const m = ws.proposals[0].markets[0];
      m.options[0] = h.option('forward', 'Continue', null);
      m.options[2] = h.option('right', 'Turn right', null);
      m.delta = null;
      addSoonerDate(ws);
    });
    const { container } = renderFloor();
    await opened(container);
    expect(words(container.querySelector('.pubws-impact-hero'))).toBe('no lead yet');
    const cell = selectedDate();
    expect(words(cell)).toMatch(/open/);
    expect(words(cell)).not.toMatch(/no liquidity/);
    // Somebody has staked on one option, so the cell is alive.
    expect(cell.getAttribute('aria-disabled')).not.toBe('true');
  });

  test('a cell where no option has liquidity says "no liquidity" and is dead', async () => {
    withFloor(ws => {
      addSoonerDate(ws);
      const sooner = ws.proposals[0].markets[1];
      sooner.options = sooner.options.map(o => h.option(o.id as string, o.label as string, null));
      sooner.delta = null;
    });
    const { container } = renderFloor();
    await opened(container);
    const other = ([...screen.getByLabelText('Dates').querySelectorAll('[role="tab"]')] as HTMLElement[]).find(
      t => t.getAttribute('aria-selected') !== 'true',
    ) as HTMLElement;
    expect(words(other)).toMatch(/no liquidity/);
    expect(other.getAttribute('aria-disabled')).toBe('true');
  });

  test('the date strip prints the lead on a priced cell, never NaN', async () => {
    withFloor(addSoonerDate);
    const { container } = renderFloor();
    await opened(container);
    expect(words(selectedDate())).toMatch(/\+1\.7/);
    expect(container.textContent).not.toMatch(/NaN/);
  });
});

describe('THE QUESTION NAMES THE OPTION, AND THE WORLD RIDES THE VERB', () => {
  test('"With <label>, what will …", switching with the selected cell', async () => {
    const { container } = renderFloor();
    await opened(container);
    const q = () => words(container.querySelector('.pubws-proposal-q'));
    expect(q()).toMatch(/^With Turn left, what will Snake's reached length be/i);
    fireEvent.click(cellsOf(container)[1]);
    await waitFor(() => expect(q()).toMatch(/^With Continue, what will/), { timeout: 5000 });
    expect(q()).not.toMatch(/\bIf\b/);
  });

  test('"Bet Higher · Turn left" on the verb, and the ticket header names the same option', async () => {
    const { container } = renderFloor();
    await opened(container);
    const higher = screen.getByRole('button', { name: /Bet Higher/ });
    expect(words(higher)).toMatch(/Turn left/);
    expect(words(higher)).not.toMatch(/if approved|if left/);
    const lower = screen.getByRole('button', { name: /Bet Lower/ });
    expect(words(lower)).toMatch(/Turn left/);
    const ticket = container.querySelector('.ticket-subject-ctx') as HTMLElement;
    expect(words(ticket)).toMatch(/Turn left/);
    expect(words(ticket)).not.toMatch(/if approved/);
    fireEvent.click(cellsOf(container)[1]);
    await waitFor(() => expect(words(screen.getByRole('button', { name: /Bet Higher/ }))).toMatch(/Continue/), {
      timeout: 5000,
    });
    expect(words(container.querySelector('.ticket-subject-ctx'))).toMatch(/Continue/);
  });
});

describe('THE CHART DRAWS EVERY OPTION', () => {
  test("the value chart draws one line per priced option, the selected in green, each named at its right end, and no baseline 'without it'", async () => {
    const { container } = renderFloor();
    await opened(container);
    await waitFor(() => expect(container.querySelectorAll('.nchart-series').length).toBe(3));
    const lines = [...container.querySelectorAll('.nchart-series')] as SVGElement[];
    const selected = lines.filter(o => o.classList.contains('is-selected'));
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute('data-option')).toBe('left');
    const labels = [...container.querySelectorAll('.nchart-series-label')].map(words);
    expect(labels).toEqual(expect.arrayContaining(['8.9 Turn left', '7.2 Continue', '5.1 Turn right']));
    const svgText = words(container.querySelector('.nchart svg'));
    expect(svgText).not.toMatch(/without it/);
    expect(svgText).not.toMatch(/if approved|if declined/);
    // No pair anatomy: there is no approved/declined bar to draw.
    expect(container.querySelector('.nchart-pair-bar')).toBeNull();
    expect(container.querySelector('.nchart-pair-delta')).toBeNull();
  });

  test('pressing another option moves the green to its line', async () => {
    const { container } = renderFloor();
    await opened(container);
    fireEvent.click(cellsOf(container)[1]);
    await waitFor(() =>
      expect(container.querySelector('.nchart-series.is-selected')?.getAttribute('data-option')).toBe('forward'),
    );
  });

  test('the legend names the options, not "if approved" / "if not"', async () => {
    const { container } = renderFloor();
    await opened(container);
    const legend = container.querySelector('.nchart-legend') as HTMLElement;
    expect(legend).toBeTruthy();
    expect(words(legend)).toMatch(/Continue/);
    expect(words(legend)).toMatch(/Turn left/);
    expect(words(legend)).toMatch(/Turn right/);
    expect(words(legend)).not.toMatch(/if approved|if not|the market now/i);
  });

  test("every option's own history is fetched, and the call chart gets the selected option loud and the others as quiet lines", async () => {
    const { container } = renderFloor();
    await opened(container);
    await waitFor(() => {
      const ids = vi.mocked(api.getPublicMarketHistory).mock.calls.map(c => c[1]);
      expect(ids).toEqual(expect.arrayContaining(['m-forward', 'm-left', 'm-right']));
    });
    // The fetched history is what the lines are drawn through.
    await waitFor(() => {
      const d = container.querySelector('.nchart-series[data-option="left"] path')?.getAttribute('d') ?? '';
      expect(d.match(/[ML]/g)?.length ?? 0).toBeGreaterThan(2);
    });
    // Switch the chart to CALL: the loud line is the selected option and
    // the others ride as muted lines labelled with their names.
    fireEvent.click(screen.getByRole('button', { name: /^call$/i }));
    await waitFor(() => expect(container.querySelector('[data-testid="call-chart"]')).toBeTruthy());
    const chart = container.querySelector('[data-testid="call-chart"]') as HTMLElement;
    const others = JSON.parse(chart.getAttribute('data-others') ?? 'null') as Array<{ label: string }> | null;
    expect(others?.map(o => o.label).sort()).toEqual(['Continue', 'Turn right']);
    expect(chart.getAttribute('data-end-label')).toBe('Turn left');
  });
});

describe('THE DECISION BAR HAS ONE BUTTON PER OPTION', () => {
  beforeEach(() => {
    capabilities = ['read', 'trade', 'manage'];
    user = { id: 'u-1', email: 'owner@example.com' };
  });

  test('"Choose <label>" per option, the leader first and in the accent, then Decline; no Approve', async () => {
    const { container } = renderFloor();
    await opened(container);
    await waitFor(() => expect(container.querySelector('.pubws-ownerbar')).toBeTruthy());
    const bar = container.querySelector('.pubws-ownerbar') as HTMLElement;
    const buttons = [...bar.querySelectorAll('button')].map(b => words(b));
    expect(buttons.slice(0, 4)).toEqual(['Choose Turn left', 'Choose Continue', 'Choose Turn right', 'Decline']);
    const first = bar.querySelector('button') as HTMLElement;
    expect(first.classList.contains('pubws-decide--approve')).toBe(true);
    expect(bar.querySelectorAll('.pubws-decide--approve')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull();
  });

  test('pressing one is the approve with that option, and nothing asks twice', async () => {
    const { container } = renderFloor();
    await opened(container);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose Continue' })).toBeTruthy(), {
      timeout: 5000,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Choose Continue' }));
    await waitFor(() => expect(api.approveProposal).toHaveBeenCalledWith('job-1', 'forward'), { timeout: 5000 });
    expect(api.approveProposal).toHaveBeenCalledTimes(1);
  });

  test('"How this decides" speaks of options: one market per option, the others voided on the choice', async () => {
    const { container } = renderFloor();
    await opened(container);
    const rules = words(container.querySelector('.pubws-decides'));
    expect(rules).toMatch(/one market per option/i);
    expect(rules).not.toMatch(/two markets/i);
    expect(rules).toMatch(/refunded at what it cost/i);
  });
});

describe('A DECIDED PROPOSAL WITH OPTIONS', () => {
  test('strikes through every option cell but the chosen one, and the ruling reads "Chose <label>"', async () => {
    withFloor(ws => {
      const p = ws.proposals[0] as Record<string, unknown>;
      p.status = 'approved';
      p.decidedOption = 'forward';
      p.resolvedAt = new Date(Date.now() - 60_000).toISOString();
      p.closedAt = new Date(Date.now() - 60_000).toISOString();
    });
    const { container } = renderFloor();
    await opened(container);
    const [, fwd, left, right] = cellsOf(container);
    expect(fwd.classList.contains('is-struck')).toBe(false);
    expect(left.classList.contains('is-struck')).toBe(true);
    expect(right.classList.contains('is-struck')).toBe(true);
    const head = container.querySelector('.pubws-proposal-head') as HTMLElement;
    expect(words(head.querySelector('.pubws-ballot-status'))).toMatch(/^Chose Continue$/i);
    expect(head.querySelector('.pubws-ballot-status')?.classList.contains('is-approved')).toBe(true);
    // The chosen option is the world on the page.
    expect(fwd.getAttribute('aria-pressed')).toBe('true');
    expect(words(fwd)).toMatch(/chosen/);
    expect(words(left)).toMatch(/stakes refunded/);
    expect(words(right)).toMatch(/stakes refunded/);
    expect(words(fwd)).not.toMatch(/stakes refunded/);
  });

  test('once decided, the ruling bar offers no Choose', async () => {
    capabilities = ['read', 'trade', 'manage'];
    user = { id: 'u-1', email: 'owner@example.com' };
    withFloor(ws => {
      const p = ws.proposals[0] as Record<string, unknown>;
      p.status = 'approved';
      p.decidedOption = 'forward';
      p.resolvedAt = new Date(Date.now() - 60_000).toISOString();
      p.closedAt = new Date(Date.now() - 60_000).toISOString();
    });
    const { container } = renderFloor();
    await opened(container);
    await waitFor(() => expect(container.querySelector('.pubws-ownerbar')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /^Choose/ })).toBeNull();
  });

  test('a declined proposal with options strikes every option: none of these', async () => {
    withFloor(ws => {
      const p = ws.proposals[0] as Record<string, unknown>;
      p.status = 'declined';
      p.declineReason = 'Not now.';
      p.resolvedAt = new Date(Date.now() - 60_000).toISOString();
      p.closedAt = new Date(Date.now() - 60_000).toISOString();
    });
    const { container } = renderFloor();
    await opened(container);
    const [, fwd, left, right] = cellsOf(container);
    for (const c of [fwd, left, right]) expect(c.classList.contains('is-struck')).toBe(true);
  });
});

describe('POSTING ONE WITH OPTIONS', () => {
  beforeEach(() => {
    user = { id: 'u-1', email: 'owner@example.com' };
  });

  test("the form's options travel to createProposal; a plain one sends no options key", async () => {
    const { container } = renderFloor('/snake');
    await waitFor(() => expect(container.querySelector('.pubws-board')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Propose work on this number/ }));
    await waitFor(() => expect(screen.getByLabelText('Proposal title')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Options/ }));
    const [a, b] = screen.getAllByLabelText(/^Option \d label$/) as HTMLInputElement[];
    fireEvent.change(a, { target: { value: 'Turn left' } });
    fireEvent.change(b, { target: { value: 'Turn right' } });
    fireEvent.change(screen.getByLabelText('Proposal title'), { target: { value: 'Which way?' } });
    fireEvent.click(screen.getByRole('button', { name: /^Propose(?! work)/ }));
    await waitFor(() => expect(api.createProposal).toHaveBeenCalled());
    expect(vi.mocked(api.createProposal).mock.calls[0][0]).toMatchObject({
      title: 'Which way?',
      options: [
        { id: 'turn-left', label: 'Turn left' },
        { id: 'turn-right', label: 'Turn right' },
      ],
    });
  });

  test('a two-branch proposal posts without an options key', async () => {
    const { container } = renderFloor('/snake');
    await waitFor(() => expect(container.querySelector('.pubws-board')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Propose work on this number/ }));
    await waitFor(() => expect(screen.getByLabelText('Proposal title')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Proposal title'), { target: { value: 'Ship it' } });
    fireEvent.click(screen.getByRole('button', { name: /^Propose(?! work)/ }));
    await waitFor(() => expect(api.createProposal).toHaveBeenCalled());
    expect(vi.mocked(api.createProposal).mock.calls[0][0]).not.toHaveProperty('options');
  });
});
