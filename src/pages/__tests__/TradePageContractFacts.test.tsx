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

/**
 * A conditional market says the same three things about itself as any other
 * market (docs/ui-conventions.md, "What a market says about itself"). On a
 * proposal that row is per BRANCH and lives in the pair band's cells and in
 * each branch column, which "The proposal view" (P4, P6) governs and
 * FloorProposalView.test.tsx pins. What survives here is the plain view.
 *
 * Deleted 2026-09-08 with the design they pinned: the branch pill toggle
 * ("if approved" / "if declined"), the four-cell decision row
 * (`.pubws-decision`) and its `.pubws-decision-why` line, the
 * "Trading the if-approved book · switch" line above the verbs, the
 * `.pubws-decide-why` line under the owner's bar, and the chart marker's
 * sign flipping with the branch on screen. Both books are on screen now with
 * their own tickets, so there is no branch on screen to switch, mark or flip.
 * Every rule they carried that the spec kept was ported to
 * FloorProposalView.test.tsx first: the reconciling precision, the difference
 * in ink shared with the rail, the caption from the chart's label helper, the
 * thin-books line and its "in each" case, the unpriced pair, and the branch's
 * own facts never borrowed from the baseline.
 */
describe('a conditional market says the same things about itself as any other', () => {
  test('the baseline still says its own three', async () => {
    renderFloor();
    await waitFor(async () => expect(await facts()).toContain('9'));
    // Traders, pool, and when it last traded: the credits traded over the
    // book's life gave way to its last trade (2026-09-08), which is what a
    // trader deciding whether the price is stale actually asks.
    expect(await facts()).toBe('9 139 no trades yet');
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

describe('the season block for the owner', () => {
  test('says what the floor costs them', async () => {
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
    expect(who.textContent).toBe(
      'This floor costs you nothing. You fund books in credits when you open them. Approved proposals cost their ask, in dollars.',
    );
  });
});

/**
 * The plain view has one book, so nothing above the verbs names it. On a
 * proposal both books are on screen with their own tickets and each is named
 * by its column's heading (docs/ui-conventions.md, "The proposal view", P6);
 * the "Trading the if-approved book · switch" line went with the branch
 * toggle on 2026-09-08.
 */
describe('the plain market has one book and no line', () => {
  test('nothing above the verbs names a book', async () => {
    const { container } = renderFloor();
    await screen.findByRole('button', { name: /Bet Higher/ });
    expect(container.querySelector('.pubws-bet-book')).toBeNull();
  });
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
