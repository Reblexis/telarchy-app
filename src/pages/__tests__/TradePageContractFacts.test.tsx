import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * A conditional market says the same three things about itself as any other
 * market (docs/ui-conventions.md, "What a market says about itself"): distinct
 * traders, credits in the pool, credits traded.
 *
 * Owner report 2026-08-31 ("the conditional markets should be just the same as
 * any other, it should show the statistics below"). The floor used to hide the
 * row entirely whenever a proposal was on screen, so a branch with its own
 * funded book looked like a market with no liquidity at all.
 *
 * The row is about the BRANCH on screen, never the baseline: the approved
 * world and the declined world are two separate books.
 *
 * This file mocks a signed-in admin, because the Inject control beside the
 * pool only exists for a manager.
 */

const h = vi.hoisted(() => {
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
    joinAs: 'trader' as const,
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
        // The baseline's own three, deliberately unlike the branches' below,
        // so a leak from baseline to proposal is visible in the assertion.
        pool: 139,
        traderCount: 9,
        tradedVolume: 4_242,
        rangeMin: 0,
        rangeMax: 500_000,
      },
    ],
    marketHistory: [],
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
            metricId: 'metric-1',
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
            declinedLiquidity: 120,
            approvedPool: 77,
            declinedPool: 41,
            approvedTraders: 2,
            declinedTraders: 1,
            approvedVolume: 250,
            declinedVolume: 90,
            rangeMin: 0,
            rangeMax: 500_000,
          },
        ],
      },
    ],
  });
  return { workspace };
});

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u-1', email: 'owner@example.com' }, loading: false }),
}));

vi.mock('../../components/MarketChart', () => ({
  GEOM: {
    wide: { W: 720, PAD_L: 46, PAD_R: 58, H: 260 },
    compact: { W: 400, PAD_L: 40, PAD_R: 50, H: 300 },
  },
  // The probe records the label the page hands the call's end marker, so
  // the "how the call moved" strip can be checked for naming the book traded.
  MarketChart: (props: { callLabel?: string }) => <div data-testid="chart" data-call-label={props.callLabel ?? ''} />,
}));

vi.mock('../../lib/api', () => {
  const explicit: Record<string, unknown> = {
    getMarketplaceWorkspace: vi.fn(async () => h.workspace()),
    joinWorkspace: vi.fn(async () => ({})),
    getProfile: vi.fn(async () => ({ capabilities: ['read', 'trade', 'manage'] })),
    getParticipant: vi.fn(async () => ({ balance: 100, id: 'agent-1' })),
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

function renderFloor() {
  return render(
    <MemoryRouter initialEntries={['/lookpilot']}>
      <Routes>
        <Route path="/:slug" element={<TradePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The three facts on the book's row, in order: traders, pool, last trade
 *  (docs/ui-conventions.md, "The verbs and the inline ticket", row 1). The
 *  row is facts only: deepening the book lives on the activity tab row. */
async function facts(): Promise<string> {
  const row = await screen.findByLabelText('This book');
  return [...row.querySelectorAll(':scope > span')]
    .map(s => (s.textContent ?? '').replace(/\s+/g, ' ').trim())
    .join(' ');
}

/** Put the proposal on screen, the way a reader does: click its row. */
async function selectContract() {
  fireEvent.click(await screen.findByTitle('rewrite the store page'));
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
});
afterEach(async () => {
  vi.clearAllMocks();
  // A test that swaps the payload must not leave it swapped: clearAllMocks
  // clears the calls, never the implementation.
  const { api } = await import('../../lib/api');
  vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => h.workspace() as never);
});

describe('a conditional market says the same things about itself as any other', () => {
  test('the baseline still says its own three', async () => {
    renderFloor();
    await waitFor(async () => expect(await facts()).toContain('9'));
    // Traders, pool, and when it last traded: the credits traded over the
    // book's life gave way to its last trade (2026-09-08), which is what a
    // trader deciding whether the price is stale actually asks.
    expect(await facts()).toBe('9 139 no trades yet');
  });

  test('a proposal on screen shows the row, not nothing', async () => {
    renderFloor();
    await selectContract();
    // The bug: the row was hidden whenever a proposal was selected, so a
    // funded branch read as a market with no pool at all.
    expect(await screen.findByLabelText('This book')).toBeTruthy();
  });

  test("the row reads the approved branch's own numbers", async () => {
    renderFloor();
    await selectContract();
    await waitFor(async () => expect(await facts()).toBe('2 77 no trades yet'));
  });

  test('switching to the declined world switches all three', async () => {
    renderFloor();
    await selectContract();
    await waitFor(async () => expect(await facts()).toBe('2 77 no trades yet'));

    fireEvent.click(await screen.findByRole('button', { name: 'if declined' }));
    await waitFor(async () => expect(await facts()).toBe('1 41 no trades yet'));

    fireEvent.click(await screen.findByRole('button', { name: 'if approved' }));
    await waitFor(async () => expect(await facts()).toBe('2 77 no trades yet'));
  });

  test("a proposal never borrows the baseline's numbers", async () => {
    renderFloor();
    await selectContract();
    await waitFor(async () => expect(await facts()).toBe('2 77 no trades yet'));
    const row = await facts();
    expect(row).not.toContain('139');
    expect(row.startsWith('9 ')).toBe(false);
  });

  test('a branch with an empty book reads zero, and still shows the row', async () => {
    const { api } = await import('../../lib/api');
    const ws = h.workspace();
    Object.assign(ws.proposals[0].markets[0], {
      approvedPool: 0,
      approvedTraders: 0,
      approvedVolume: 0,
    });
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    renderFloor();
    await selectContract();
    await waitFor(async () => expect(await facts()).toBe('0 0 no trades yet'));
  });

  test("the owner's Inject targets the branch on screen, not the baseline", async () => {
    renderFloor();
    await selectContract();
    await waitFor(async () => expect(await facts()).toBe('2 77 no trades yet'));

    fireEvent.click(await screen.findByRole('button', { name: 'if declined' }));
    await waitFor(async () => expect(await facts()).toBe('1 41 no trades yet'));
    // Deepening the book lives on the activity tab row now, beside what the
    // book holds (docs/ui-conventions.md, "Activity").
    fireEvent.click(await screen.findByRole('button', { name: 'Inject liquidity' }));

    // The dialog names the market it is about to change. Injecting into the
    // baseline while the reader is looking at a branch would put the credits
    // in a book nobody asked about.
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('if declined');
    expect(dialog.textContent).not.toContain('if approved');
    // It reports the branch's pool, not the baseline's 139.
    expect(dialog.textContent).toContain('41');

    // And the credits actually land on the declined branch's book.
    const { api } = await import('../../lib/api');
    fireEvent.click(dialog.querySelector('.ticket-go') as HTMLElement);
    await waitFor(() =>
      expect(vi.mocked(api.injectLiquidity)).toHaveBeenCalledWith('m-declined', 1000, expect.anything()),
    );
  });
});

/**
 * The decision row, then the decision bar (docs/ui-conventions.md, critics'
 * round 2026-09-08): a decision is laid out as a decision before it is
 * asked. Under the proposal's headline, four cells on hairlines: if approved
 * and its call, if declined and its call, the difference, the cost. The
 * owner's bar sits directly under it. Everyone sees the row.
 */
describe('the decision row, then the decision bar', () => {
  const cells = (container: HTMLElement) =>
    [...container.querySelectorAll('.pubws-decision .pubws-decision-cell')].map(c => ({
      what: c.querySelector('.pubws-stat-what')?.textContent?.trim() ?? '',
      value: c.querySelector('.pubws-price')?.textContent?.trim() ?? '',
      active: c.classList.contains('is-active'),
    }));

  test('four cells from the pair: if approved, if declined, difference, costs', async () => {
    const { container } = renderFloor();
    await selectContract();
    await waitFor(() => expect(container.querySelector('.pubws-decision')).toBeTruthy());
    expect(cells(container)).toEqual([
      { what: 'if approved', value: '$82,000', active: true },
      { what: 'if declined', value: '$71,000', active: false },
      { what: 'difference · revenue', value: '+$11,000', active: false },
      { what: 'costs', value: '$80', active: false },
    ]);
    // The numbers are in the price register, a size down from the headline.
    for (const cell of container.querySelectorAll('.pubws-decision .pubws-price')) {
      expect(cell.className).toContain('pubws-price--sm');
    }
  });

  /** The difference caption never truncates (round 2: "DIFFERENCE · ACTIV…"
   *  at 1700px): the caption wraps, and the difference cell is the widest of
   *  the four. */
  test('the stylesheet lets the difference caption wrap in a wider cell', () => {
    const CSS = readFileSync(join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'style.css'), 'utf8');
    const row = CSS.match(/\.pubws-decision \{([^}]*)\}/);
    expect(row).toBeTruthy();
    expect(row![1]).toMatch(/grid-template-columns:\s*1fr 1fr 1\.4fr 1fr/);
    expect(CSS).toMatch(/\.pubws-decision-cell \{[^}]*min-width:\s*0/);
    const cap = CSS.match(/\.pubws-decision-cell \.pubws-stat-what \{([^}]*)\}/);
    expect(cap).toBeTruthy();
    expect(cap![1]).toMatch(/white-space:\s*normal/);
    expect(cap![1]).toMatch(/overflow:\s*visible/);
    expect(cap![1]).toMatch(/text-overflow:\s*clip/);
  });

  test('the difference caption carries its unit in a span the stylesheet can break onto its own line', async () => {
    const { container } = renderFloor();
    await selectContract();
    await waitFor(() => expect(container.querySelector('.pubws-decision')).toBeTruthy());
    const diff = container.querySelectorAll('.pubws-decision .pubws-decision-cell')[2] as HTMLElement;
    const unit = diff.querySelector('.pubws-stat-what .pubws-decision-unit') as HTMLElement;
    expect(unit).toBeTruthy();
    expect(unit.textContent).toBe('revenue');
  });

  test('the branch on screen is the marked cell', async () => {
    const { container } = renderFloor();
    await selectContract();
    await waitFor(() => expect(container.querySelector('.pubws-decision')).toBeTruthy());
    fireEvent.click(await screen.findByRole('button', { name: 'if declined' }));
    await waitFor(() => expect(cells(container)[1].active).toBe(true));
    expect(cells(container)[0].active).toBe(false);
    // The difference is approved minus declined whichever world is on screen.
    expect(cells(container)[2].value).toBe('+$11,000');
  });

  test('the row sits under the headline, and the owner bar directly under the row', async () => {
    const { container } = renderFloor();
    await selectContract();
    await waitFor(() => expect(container.querySelector('.pubws-decision')).toBeTruthy());
    const row = container.querySelector('.pubws-decision') as HTMLElement;
    const ask = container.querySelector('.pubws-instrument-ask') as HTMLElement;
    expect(ask.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const approve = await screen.findByRole('button', { name: 'Approve, pay $80' });
    const bar = approve.closest('.pubws-ownerbar') as HTMLElement;
    expect(bar.previousElementSibling).toBe(row);
    // And before the tickets: a decision is laid out as a decision before
    // it is asked (docs/ui-conventions.md, "The proposal view", P5).
    const verbs = container.querySelector('.pubws-verbs') as HTMLElement;
    expect(row.compareDocumentPosition(verbs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('the row and the rail print the same difference', async () => {
    const { formatImpact } = await import('../../lib/formatImpact');
    const { api } = await import('../../lib/api');
    const ws = h.workspace();
    // A difference under 1: the precision rule is where the three used to drift.
    ws.proposals[0].markets[0].approvedConsensus = 80_000.45;
    ws.proposals[0].markets[0].declinedConsensus = 80_000;
    ws.proposals[0].markets[0].delta = 0.45;
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    const { container } = renderFloor();
    await selectContract();
    await waitFor(() => expect(container.querySelector('.pubws-decision')).toBeTruthy());
    const expected = formatImpact(0.45, '$');
    expect(expected).toBe('+$0.45');
    expect(cells(container)[2].value).toBe(expected);
    // The impact chip beside the call is not drawn any more (2026-09-08):
    // the numbers band shows the metric's own numbers, and the difference
    // is stated in the decision row and on the rail, in one precision.
    expect(container.querySelector('.pubws-stat--call .pubws-delta-chip')).toBeNull();
    const rail = container.querySelector('.pubws-rail--right .pubws-ballot-delta') as HTMLElement;
    expect(rail.textContent).toBe(expected);
  });

  /** The row has to add up at a glance (critics' round 2 of 2026-09-08:
   *  "17.0, 17.0, difference +0.04" reads as wrong): the two calls print
   *  with enough decimals to reconcile the difference. */
  test('a difference under a tenth prints the two calls with two decimals', async () => {
    const { api } = await import('../../lib/api');
    const ws = h.workspace();
    ws.markets[0].consensus = 17;
    ws.markets[0].rangeMax = 50;
    Object.assign(ws.proposals[0].markets[0], {
      approvedConsensus: 17.02,
      declinedConsensus: 16.98,
      delta: 0.04,
      rangeMax: 50,
    });
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    const { container } = renderFloor();
    await selectContract();
    await waitFor(() => expect(container.querySelector('.pubws-decision')).toBeTruthy());
    const c = cells(container);
    expect(c[0].value).toBe('$17.02');
    expect(c[1].value).toBe('$16.98');
    expect(c[2].value).toBe('+$0.04');
    // The chart's branch labels use the same rule.
    await waitFor(() => expect(container.querySelector('.nchart-pair-label--approved')).toBeTruthy());
    expect(container.querySelector('.nchart-pair-label--approved')?.textContent).toBe('if approved $17.02');
    expect(container.querySelector('.nchart-pair-label--declined')?.textContent).toBe('if declined $16.98');
  });

  test('two calls that would print equal at their usual precision grow decimals until they differ', async () => {
    const { api } = await import('../../lib/api');
    const ws = h.workspace();
    ws.markets[0].consensus = 150;
    ws.markets[0].rangeMax = 500;
    // Whole numbers from 100 up: "150" and "150" beside "+0.4" is the bug.
    Object.assign(ws.proposals[0].markets[0], {
      approvedConsensus: 150.4,
      declinedConsensus: 150,
      delta: 0.4,
      rangeMax: 500,
    });
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    const { container } = renderFloor();
    await selectContract();
    await waitFor(() => expect(container.querySelector('.pubws-decision')).toBeTruthy());
    const c = cells(container);
    expect(c[0].value).toBe('$150.40');
    expect(c[1].value).toBe('$150.00');
    expect(c[2].value).toBe('+$0.40');
  });

  test('a wide difference keeps the usual precision: no decimals invented', async () => {
    const { container } = renderFloor();
    await selectContract();
    await waitFor(() => expect(container.querySelector('.pubws-decision')).toBeTruthy());
    const c = cells(container);
    expect(c[0].value).toBe('$82,000');
    expect(c[1].value).toBe('$71,000');
    expect(container.querySelector('.pubws-decision-why')).toBeNull();
  });

  test('the difference cell is captioned with the metric, from the same label helper as the chart caption', async () => {
    const { captionLabel, metricLabelOf } = await import('../../lib/floor-horizons');
    const { container } = renderFloor();
    await selectContract();
    await waitFor(() => expect(container.querySelector('.pubws-decision')).toBeTruthy());
    const expected = `difference · ${captionLabel(metricLabelOf('LookPilot revenue (monthly, USD)'), 'LookPilot')}`;
    expect(expected).toBe('difference · revenue');
    expect(cells(container)[2].what).toBe(expected);
  });

  /** When the pair sits away from the unconditional call by more than the
   *  difference, one grey line under the row says why in the trader's
   *  terms: the pools, and the market's own call. */
  test("a pair far from the market's own call gets one grey line under the row naming the pools and the call", async () => {
    const { api } = await import('../../lib/api');
    const ws = h.workspace();
    // Both branches 9,000 and 10,000 above the baseline's 80,000, 1,000 apart.
    Object.assign(ws.proposals[0].markets[0], {
      approvedConsensus: 90_000,
      declinedConsensus: 89_000,
      delta: 1_000,
    });
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    const { container } = renderFloor();
    await selectContract();
    await waitFor(() => expect(container.querySelector('.pubws-decision-why')).toBeTruthy());
    const why = container.querySelector('.pubws-decision-why') as HTMLElement;
    expect(why.textContent).toBe("Both books trade thin (77 cr and 41 cr); the market's own call is $80,000.");
    // Directly under the row, before the owner's bar.
    const row = container.querySelector('.pubws-decision') as HTMLElement;
    expect(row.nextElementSibling).toBe(why);
    const approve = await screen.findByRole('button', { name: 'Approve, pay $80' });
    expect((approve.closest('.pubws-ownerbar') as HTMLElement).previousElementSibling).toBe(why);
  });

  test('equal pools read "in each"', async () => {
    const { api } = await import('../../lib/api');
    const ws = h.workspace();
    Object.assign(ws.proposals[0].markets[0], {
      approvedConsensus: 90_000,
      declinedConsensus: 89_000,
      delta: 1_000,
      approvedPool: 295,
      declinedPool: 295,
    });
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    const { container } = renderFloor();
    await selectContract();
    await waitFor(() => expect(container.querySelector('.pubws-decision-why')).toBeTruthy());
    expect(container.querySelector('.pubws-decision-why')?.textContent).toBe(
      "Both books trade thin (295 cr in each); the market's own call is $80,000.",
    );
  });

  test("a pair that straddles or hugs the market's call gets no line", async () => {
    const { api } = await import('../../lib/api');
    const ws = h.workspace();
    // 82,000 is 2,000 from the call; the difference is 11,000: the row explains itself.
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    const { container } = renderFloor();
    await selectContract();
    await waitFor(() => expect(container.querySelector('.pubws-decision')).toBeTruthy());
    expect(container.querySelector('.pubws-decision-why')).toBeNull();
  });

  test('an unpriced pair says so in the cells rather than printing zeros', async () => {
    const { api } = await import('../../lib/api');
    const ws = h.workspace();
    Object.assign(ws.proposals[0].markets[0], {
      approvedConsensus: null,
      declinedConsensus: null,
      approvedLiquidity: 0,
      declinedLiquidity: 0,
    });
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    const { container } = renderFloor();
    await selectContract();
    await waitFor(() => expect(container.querySelector('.pubws-decision')).toBeTruthy());
    const c = cells(container);
    expect(c[0].value).toBe('no price yet');
    expect(c[1].value).toBe('no price yet');
    expect(c[2].value).toBe('open');
    expect(c[3].value).toBe('$80');
  });
});

/**
 * For the owner the reading cell is also the reporting cell (docs/
 * ui-conventions.md, "The stat row"): the Report control sits beside the
 * age, a platform-synced metric says "synced hourly" there instead, and a
 * count prints whole.
 */
describe('the reading cell for a manager', () => {
  const withReading = (extra: Record<string, unknown> = {}) => {
    const ws = h.workspace() as ReturnType<typeof h.workspace> & { horizonHistories?: unknown[] };
    ws.horizonHistories = [
      {
        marketId: 'm-hero',
        metricName: 'LookPilot revenue (monthly, USD)',
        targetDate: '2026-12',
        description: 'Everything LookPilot earned in the month. Net of refunds.',
        points: [{ at: '2026-08-15T09:00:00Z', value: 45_339 }],
        ...extra,
      },
    ];
    return ws;
  };

  test('Report sits in the reading cell beside the age, and the old line under the charts is gone', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(withReading() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-stat--now')).toBeTruthy());
    const now = container.querySelector('.pubws-stat--now') as HTMLElement;
    await waitFor(() => expect(within(now).getByRole('button', { name: 'Report' })).toBeTruthy());
    const report = within(now).getByRole('button', { name: 'Report' });
    expect(now.querySelector('.pubws-updated')).toBeTruthy();
    expect(now.querySelector('.pubws-price')?.textContent).toBe('$45,339');
    expect(container.querySelector('.pubws-yours')).toBeNull();
    expect(container.textContent).not.toMatch(/Yours:/);
    // The control keeps its dialog.
    fireEvent.click(report);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('revenue');
  });

  test('a platform-synced metric says "synced hourly" instead of offering Report', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(withReading({ platformSynced: true }) as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-stat--now')).toBeTruthy());
    const now = container.querySelector('.pubws-stat--now') as HTMLElement;
    await waitFor(() => expect(now.textContent).toContain('synced hourly'));
    expect(within(now).queryByRole('button', { name: 'Report' })).toBeNull();
  });

  test('a count prints whole: "9", never "9.00"', async () => {
    const { api } = await import('../../lib/api');
    const ws = withReading({
      metricName: 'Steam reviews (count)',
      points: [{ at: '2026-08-15T09:00:00Z', value: 9 }],
    });
    ws.markets[0].metricName = 'Steam reviews (count)';
    ws.markets[0].consensus = 9.5;
    ws.markets[0].rangeMax = 100;
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-stat--now .pubws-price')).toBeTruthy());
    expect(container.querySelector('.pubws-stat--now .pubws-price')?.textContent).toBe('9');
  });

  test('money keeps its decimals', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(
      withReading({ points: [{ at: '2026-08-15T09:00:00Z', value: 9 }] }) as never,
    );
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-stat--now .pubws-price')).toBeTruthy());
    expect(container.querySelector('.pubws-stat--now .pubws-price')?.textContent).toBe('$9.00');
  });
});

describe('the season block for a manager', () => {
  test('says who pays the prizes', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getSeasons).mockResolvedValue({
      seasons: [
        {
          id: 's0',
          name: 'Season 0',
          status: 'running',
          startsAt: '2026-08-22T00:00:00.000Z',
          endsAt: '2027-10-01T00:00:00.000Z',
          settledAt: null,
          poolUsd: 1000,
          payoutMode: 'ladder',
          minPayoutUsd: 0,
          strictEligibility: false,
          ladder: [{ place: 1, prizeUsd: 500 }],
          rulesUrl: '/legal/season-0',
        },
      ],
    } as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-season .pubws-season-who')).toBeTruthy());
    const who = container.querySelector('.pubws-season .pubws-season-who') as HTMLElement;
    expect(who.textContent).toBe('Prizes paid by Telarchy. Your floor costs you nothing.');
  });
});

/**
 * On a proposal the bet verbs say which book they trade (docs/
 * ui-conventions.md, critics' round 2): one line directly above the pair,
 * "Trading the if-approved book · switch", the switch flipping the branch
 * exactly as the pills under the decision bar do.
 */
describe('on a proposal the bet verbs say which book they trade', () => {
  test('one line directly above the verbs names the book, and its switch flips the branch', async () => {
    const { container } = renderFloor();
    await selectContract();
    await waitFor(() => expect(container.querySelector('.pubws-bet-book')).toBeTruthy());
    const line = container.querySelector('.pubws-bet-book') as HTMLElement;
    expect(line.textContent?.replace(/\s+/g, ' ').trim()).toBe('Trading the if-approved book · switch');
    expect(line.nextElementSibling).toBe(container.querySelector('.pubws-verbs'));
    fireEvent.click(within(line).getByRole('button', { name: 'switch' }));
    await waitFor(() =>
      expect(line.textContent?.replace(/\s+/g, ' ').trim()).toBe('Trading the if-declined book · switch'),
    );
    // The same flip the pills make: the facts row now reads the declined book.
    await waitFor(async () => expect(await facts()).toBe('1 41 no trades yet'));
    // And the pills agree.
    expect(cells(container)[1].active).toBe(true);
  });

  test('the plain market has one book and no line', async () => {
    const { container } = renderFloor();
    await screen.findByRole('button', { name: /Bet Higher/ });
    expect(container.querySelector('.pubws-bet-book')).toBeNull();
  });

  /** The pair's own switch: the pills under the decision row. */

  const cells = (container: HTMLElement) =>
    [...container.querySelectorAll('.pubws-decision .pubws-decision-cell')].map(c => ({
      active: c.classList.contains('is-active'),
    }));
});

/**
 * For a manager the Edit control sits beside "more" in the summary line
 * (docs/ui-conventions.md, "The price and the chart", critics' round 2), so
 * it is reachable without expanding; pressing it opens the editor in place.
 */
describe('Edit beside "more" for a manager', () => {
  const withDefinition = () => {
    const ws = h.workspace() as ReturnType<typeof h.workspace> & { horizonHistories?: unknown[] };
    ws.horizonHistories = [
      {
        marketId: 'm-hero',
        metricName: 'LookPilot revenue (monthly, USD)',
        targetDate: '2026-12',
        description: 'Everything LookPilot earned in the month. Net of refunds.',
        points: [],
      },
    ];
    return ws;
  };

  test('Edit sits beside "Full definition", outside the clamp, and opens the metric sheet', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(withDefinition() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-instrument-sum')).toBeTruthy());
    const sum = container.querySelector('.pubws-instrument-sum') as HTMLElement;
    await waitFor(() => expect(within(sum).getByRole('button', { name: 'Edit' })).toBeTruthy());
    const more = within(sum).getByRole('button', { name: 'Full definition' });
    const edit = within(sum).getByRole('button', { name: 'Edit' });
    expect(more.compareDocumentPosition(edit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Both sit OUTSIDE the clamped summary, so the clamp can never swallow
    // them (docs/ui-conventions.md, "The settlement line").
    expect(more.closest('.pubws-instrument-sum-text')).toBeNull();
    expect(edit.closest('.pubws-instrument-sum-text')).toBeNull();
    // The same small link register as "Full definition", never the decision
    // pill, which overlapped the summary's last line (round 2).
    expect(edit.className).toBe('pubws-instrument-edit');
    expect(edit.className).not.toContain('pubws-decide');
    expect(more.nextElementSibling).toBe(edit);
    // Not expanded yet: the control is reachable without expanding.
    expect(container.querySelector('.pubws-instrument-more')).toBeNull();
    fireEvent.click(edit);
    // The definition is edited on the metric sheet now (2026-09-08), where
    // its summary line, range and dates live beside it.
    expect(document.querySelector('[role="dialog"][aria-label="Metrics"]')).not.toBeNull();
    expect(container.querySelector('.pubws-instrument-more textarea')).toBeNull();
  });

  test('the stylesheet sets Edit beside "more" as an underlined inline link, tertiary, never a pill', () => {
    const CSS = readFileSync(join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'style.css'), 'utf8');
    const rule = CSS.match(/\.pubws-instrument-edit \{([^}]*)\}/);
    expect(rule).toBeTruthy();
    const body = rule![1];
    expect(body).toMatch(/display:\s*inline/);
    expect(body).toMatch(/border:\s*none/);
    expect(body).toMatch(/background:\s*none/);
    expect(body).toMatch(/text-decoration:\s*underline/);
    expect(body).toMatch(/text-underline-offset:\s*2px/);
    expect(body).toMatch(/color:\s*var\(--text-tertiary\)/);
    expect(body).not.toMatch(/border-radius/);
    expect(body).not.toMatch(/padding:\s*0\.\d+rem\s+\d/);
  });

  test('the expander itself no longer carries a second Edit', async () => {
    const { api } = await import('../../lib/api');
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(withDefinition() as never);
    const { container } = renderFloor();
    await waitFor(() => expect(container.querySelector('.pubws-instrument-sum')).toBeTruthy());
    const sum = container.querySelector('.pubws-instrument-sum') as HTMLElement;
    fireEvent.click(within(sum).getByRole('button', { name: 'Full definition' }));
    await waitFor(() => expect(container.querySelector('.pubws-instrument-more')).toBeTruthy());
    const full = container.querySelector('.pubws-instrument-more') as HTMLElement;
    expect(within(full).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(full.querySelector('.pubws-instrument-more-edit')).toBeNull();
    // One Edit for the definition on the page: the summary line's.
    await waitFor(() => expect(within(sum).getByRole('button', { name: 'Edit' })).toBeTruthy());
  });
});

/**
 * The owner's decision bar says what its two quiet buttons do to the books
 * (docs/ui-conventions.md, "The decision row, then the decision bar",
 * critics' round 3): one grey line under the bar. The wording follows the
 * server (functions/src/services/proposals.ts): a plain decline voids the
 * if-approved book (refunded at cost) and keeps if-declined live to settle
 * on the real number; remove voids both books and refunds everyone.
 */
describe('one grey line under the decision bar says what Decline and Remove do', () => {
  test('the line sits directly under the bar, for the owner, and names both outcomes', async () => {
    const { container } = renderFloor();
    await selectContract();
    const approve = await screen.findByRole('button', { name: 'Approve, pay $80' });
    const bar = approve.closest('.pubws-ownerbar') as HTMLElement;
    const why = bar.nextElementSibling as HTMLElement;
    expect(why?.classList.contains('pubws-decide-why')).toBe(true);
    expect(why.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Decline settles the pair on if-declined: those positions pay out at the real number, if-approved is refunded. Remove voids both books and refunds everyone.',
    );
    expect(container.querySelectorAll('.pubws-decide-why')).toHaveLength(1);
  });

  test('a decided proposal has no bar and no line', async () => {
    const { api } = await import('../../lib/api');
    const ws = h.workspace();
    Object.assign(ws.proposals[0], { status: 'approved' });
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    const { container } = renderFloor();
    await selectContract();
    await waitFor(() => expect(container.querySelector('.pubws-decision')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull();
    expect(container.querySelector('.pubws-decide-why')).toBeNull();
  });
});

/**
 * The chart follows the row's precision (critics' round 3): the marker
 * beside the traded branch printed "+0.0" next to "if approved 17.04", and
 * "how the call moved" named only the declined line, never the book being
 * traded.
 */
describe('the charts follow the decision row', () => {
  const tightPair = async () => {
    const { api } = await import('../../lib/api');
    const ws = h.workspace();
    ws.markets[0].consensus = 17;
    ws.markets[0].rangeMax = 50;
    Object.assign(ws.proposals[0].markets[0], {
      approvedConsensus: 17.04,
      declinedConsensus: 17,
      delta: 0.04,
      rangeMax: 50,
    });
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
  };

  test("the marker beside the traded branch prints the difference with the row's precision", async () => {
    await tightPair();
    const { container } = renderFloor();
    await selectContract();
    await waitFor(() => expect(container.querySelector('.nchart-pair-delta')).toBeTruthy());
    expect(container.querySelector('.nchart-pair-delta')?.textContent).toBe('+$0.04');
    // The same string as the row's difference cell.
    const diff = container.querySelectorAll('.pubws-decision .pubws-decision-cell')[2];
    expect(diff.querySelector('.pubws-price')?.textContent?.trim()).toBe('+$0.04');
  });

  test('from the declined world the marker flips its sign at the same precision', async () => {
    await tightPair();
    const { container } = renderFloor();
    await selectContract();
    fireEvent.click(await screen.findByRole('button', { name: 'if declined' }));
    await waitFor(() => expect(container.querySelector('.nchart-pair-delta')?.textContent).toBe('-$0.04'));
  });

  // "How the call moved" (MarketChart as a half-height strip under the
  // number chart) is not rendered any more (2026-09-08), so there is no
  // second chart to label with the book being traded; the branch on screen
  // is named by the decision row's pills and by the line above the verbs.
});
