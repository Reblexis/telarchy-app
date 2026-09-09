import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * A decision deadline on every proposal, and trading closes at the decision
 * (docs/ui-conventions.md, "The deadline is one amber chip"; docs/guides/
 * proposals.md, "The deadline, and the close"). One amber chip in the
 * caption row is the only mention; the owner's bar says what happens if they
 * do nothing; a closed proposal has no ticket, no verbs and no Sell.
 */

const h = vi.hoisted(() => {
  const DAY = 24 * 60 * 60 * 1000;
  const workspace = (proposalOverrides: Record<string, unknown> = {}) => ({
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
        probability: 0.16,
        liquidity: 200,
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
        decideBy: new Date(Date.now() + 6 * DAY).toISOString(),
        closedAt: null,
        lapsedAt: null,
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
        ...proposalOverrides,
      },
    ],
  });
  return { workspace, DAY };
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
    getPositions: vi.fn(async () => [{ direction: 'higher', shares: 10, totalCost: 5 }]),
    getLimitOrders: vi.fn(async () => []),
    getFloorComments: vi.fn(async () => []),
    editProposal: vi.fn(async () => ({ ok: true })),
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
async function selectContract() {
  fireEvent.click(await screen.findByTitle('rewrite the store page'));
}
async function withProposal(overrides: Record<string, unknown>) {
  const { api } = await import('../../lib/api');
  vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(h.workspace(overrides) as never);
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
  const { api } = await import('../../lib/api');
  vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => h.workspace() as never);
});

describe('the deadline is one amber chip', () => {
  test('a pending proposal shows "decides <date>" in the caption row and nowhere else', async () => {
    renderFloor();
    await selectContract();
    const chip = await screen.findByLabelText('Decision deadline');
    // Six days out it names the day; under a day it counts down.
    expect(chip.textContent).toMatch(/decides/i);
    // The only mention: no sentence about the deadline under the pitch or in the ticket.
    expect(screen.queryByText(/Trading on this proposal closes/)).toBeNull();
  });

  test('the chip is not there on the baseline market', async () => {
    renderFloor();
    await screen.findByTitle('rewrite the store page');
    expect(screen.queryByLabelText('Decision deadline')).toBeNull();
  });

  test('after the decision the chip reads "decided"', async () => {
    await withProposal({
      status: 'approved',
      resolvedAt: '2026-09-12T14:02:00.000Z',
      closedAt: '2026-09-12T14:02:00.000Z',
    });
    renderFloor();
    await selectContract();
    const chip = await screen.findByLabelText('Decision deadline');
    expect(chip.textContent).toMatch(/decided/i);
  });
});

describe("the owner's bar", () => {
  test('says the proposal declines itself, and offers nothing to press', async () => {
    renderFloor();
    await selectContract();
    await screen.findByRole('button', { name: /Approve/ });
    expect(screen.getByText(/declines itself/)).toBeTruthy();
    // The deadline never moves (docs/market-integrity.md I1b).
    expect(screen.queryByRole('button', { name: /extend/i })).toBeNull();
  });
});

describe('a closed proposal', () => {
  test('has no verbs, no ticket, and no Sell; the position says when it settles', async () => {
    await withProposal({
      status: 'approved',
      resolvedAt: '2026-09-12T14:02:00.000Z',
      closedAt: '2026-09-12T14:02:00.000Z',
    });
    renderFloor();
    await selectContract();
    await screen.findByLabelText('Decision deadline');
    expect(screen.queryByRole('button', { name: /Bet Higher/ })).toBeNull();
    const card = await screen.findByLabelText('Your position');
    expect(card.textContent).toMatch(/settles/i);
    expect(screen.queryByRole('button', { name: 'Sell' })).toBeNull();
  });

  test('the call cell says it is the call at the decision', async () => {
    await withProposal({
      status: 'approved',
      resolvedAt: '2026-09-12T14:02:00.000Z',
      closedAt: '2026-09-12T14:02:00.000Z',
    });
    renderFloor();
    await selectContract();
    const cell = await screen.findByLabelText("Market's call if approved");
    expect(cell.textContent).toMatch(/at the decision/);
  });
});

describe('the deadline reads at every scale', () => {
  test('under a day it counts down in hours', async () => {
    await withProposal({ decideBy: new Date(Date.now() + 4 * 3_600_000).toISOString() });
    renderFloor();
    await selectContract();
    expect((await screen.findByLabelText('Decision deadline')).textContent).toMatch(/in 4h/);
  });

  test('inside the hour it counts down in minutes, in red', async () => {
    await withProposal({ decideBy: new Date(Date.now() + 12 * 60_000).toISOString() });
    renderFloor();
    await selectContract();
    const chip = await screen.findByLabelText('Decision deadline');
    expect(chip.textContent).toMatch(/in 1[23]m/);
    expect(chip.className).toContain('is-urgent');
  });

  test('a day or more out it names the day', async () => {
    await withProposal({ decideBy: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    renderFloor();
    await selectContract();
    expect((await screen.findByLabelText('Decision deadline')).textContent).toMatch(/decides \d/);
  });
});
