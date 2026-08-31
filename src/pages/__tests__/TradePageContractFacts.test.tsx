import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * A conditional market says the same three things about itself as any other
 * market (docs/ui-conventions.md, "What a market says about itself"): distinct
 * traders, credits in the pool, credits traded.
 *
 * Owner report 2026-08-31 ("the conditional markets should be just the same as
 * any other, it should show the statistics below"). The floor used to hide the
 * row entirely whenever a contract was on screen, so a branch with its own
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
        // so a leak from baseline to contract is visible in the assertion.
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
  MarketChart: () => <div data-testid="chart" />,
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

/** The three numbers on the row, in order: traders, pool, traded. The
 *  owner's Inject and Buy sit on the same row and are not facts. */
async function facts(): Promise<string> {
  const row = await screen.findByLabelText('Market facts');
  return [...row.querySelectorAll(':scope > span')]
    .map(s => (s.textContent ?? '').replace(/\s+/g, ' ').trim())
    .join(' ');
}

/** Put the contract on screen, the way a reader does: click its row. */
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
    expect(await facts()).toBe('9 139 4,242');
  });

  test('a contract on screen shows the row, not nothing', async () => {
    renderFloor();
    await selectContract();
    // The bug: the row was hidden whenever a contract was selected, so a
    // funded branch read as a market with no pool at all.
    expect(await screen.findByLabelText('Market facts')).toBeTruthy();
  });

  test("the row reads the approved branch's own numbers", async () => {
    renderFloor();
    await selectContract();
    await waitFor(async () => expect(await facts()).toBe('2 77 250'));
  });

  test('switching to the declined world switches all three', async () => {
    renderFloor();
    await selectContract();
    await waitFor(async () => expect(await facts()).toBe('2 77 250'));

    fireEvent.click(await screen.findByRole('button', { name: 'if declined' }));
    await waitFor(async () => expect(await facts()).toBe('1 41 90'));

    fireEvent.click(await screen.findByRole('button', { name: 'if approved' }));
    await waitFor(async () => expect(await facts()).toBe('2 77 250'));
  });

  test("a contract never borrows the baseline's numbers", async () => {
    renderFloor();
    await selectContract();
    await waitFor(async () => expect(await facts()).toBe('2 77 250'));
    const row = await facts();
    expect(row).not.toContain('139');
    expect(row).not.toContain('4,242');
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
    await waitFor(async () => expect(await facts()).toBe('0 0 0'));
  });

  test("the owner's Inject targets the branch on screen, not the baseline", async () => {
    renderFloor();
    await selectContract();
    await waitFor(async () => expect(await facts()).toBe('2 77 250'));

    fireEvent.click(await screen.findByRole('button', { name: 'if declined' }));
    await waitFor(async () => expect(await facts()).toBe('1 41 90'));
    fireEvent.click(await screen.findByRole('button', { name: 'Inject' }));

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
