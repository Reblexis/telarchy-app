import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * A proposal's pair prices the difference from the baseline (docs/guides/
 * creating.md, "A conditional pair prices the difference from the
 * baseline"; docs/ui-conventions.md, "A proposal keeps the clock line, and
 * says which world it is"). On the floor that means: the question asks how
 * much the metric changes, the big number is the branch's impact, the level
 * it reads as today is the quiet derived line, and the ticket says what the
 * bet pays on. A pair from before the rule (`quotes: "level"`) keeps the old
 * sentence and is marked as priced as a level, so nobody reads it as
 * following the baseline. Owner decision 2026-09-05.
 */

const h = vi.hoisted(() => {
  const pair = (overrides: Record<string, unknown> = {}) => ({
    metricId: 'metric-1',
    metricName: 'LookPilot revenue (monthly, USD)',
    targetDate: '2026-12',
    resolvesOn: '2026-12-31',
    // The levels the branches read as: baseline 80,000 plus the impacts.
    approvedConsensus: 81_500,
    declinedConsensus: 79_500,
    delta: 2_000,
    approvedMarketId: 'm-approved',
    declinedMarketId: 'm-declined',
    approvedProbability: 0.515,
    approvedLiquidity: 200,
    declinedProbability: 0.495,
    declinedLiquidity: 120,
    approvedPool: 77,
    declinedPool: 41,
    approvedTraders: 2,
    declinedTraders: 1,
    approvedVolume: 250,
    declinedVolume: 90,
    rangeMin: -250_000,
    rangeMax: 250_000,
    quotes: 'difference',
    approvedImpact: 1_500,
    declinedImpact: -500,
    baselineConsensus: 80_000,
    reference: null,
    ...overrides,
  });
  const workspace = (pairOverrides: Record<string, unknown> = {}, proposalOverrides: Record<string, unknown> = {}) => ({
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
        proposedByName: 'Ada',
        createdAt: '2026-08-12T09:00:00.000Z',
        marketPairCount: 1,
        markets: [pair(pairOverrides)],
        ...proposalOverrides,
      },
    ],
  });
  return { workspace, pair };
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

async function selectContract() {
  fireEvent.click(await screen.findByTitle('rewrite the store page'));
}

async function withPayload(pairOverrides: Record<string, unknown>, proposalOverrides: Record<string, unknown> = {}) {
  const { api } = await import('../../lib/api');
  vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(h.workspace(pairOverrides, proposalOverrides) as never);
}

const question = () =>
  document.querySelector('.pubws-instrument-ask')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

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

describe('a difference pair on the floor', () => {
  test('the question asks how much the metric changes', async () => {
    renderFloor();
    await selectContract();
    await waitFor(() => expect(question()).toMatch(/^How much will LookPilot's/));
    expect(question()).toContain('change if Ada is paid $80');
    expect(question()).not.toContain('What will be');
  });

  test('the big number is the impact, the level is the quiet line under it', async () => {
    renderFloor();
    await selectContract();
    const cell = await screen.findByLabelText('Impact if approved');
    // The big number tweens to its value; the line under it does not.
    await waitFor(() => expect(cell.textContent).toContain('+$1,500'), { timeout: 3000 });
    expect(cell.textContent).toContain('reads $81,500 with today');
    // The delta against the other world rides beside it.
    expect(cell.textContent).toContain('+$2,000');
  });

  test('the baseline cell names the forecast the impact is read against', async () => {
    renderFloor();
    await selectContract();
    const cell = await screen.findByLabelText('Baseline');
    expect(cell.textContent).toContain('$80,000');
  });

  test('switching worlds shows that world\'s impact', async () => {
    renderFloor();
    await selectContract();
    await screen.findByLabelText('Impact if approved');
    fireEvent.click(await screen.findByRole('button', { name: 'if declined' }));
    const cell = await screen.findByLabelText('Impact if declined');
    await waitFor(() => expect(cell.textContent).toContain('-$500'), { timeout: 3000 });
    expect(cell.textContent).toContain('reads $79,500');
  });

  test('the ticket says what the bet pays on', async () => {
    renderFloor();
    await selectContract();
    await screen.findByLabelText('Impact if approved');
    fireEvent.click(await screen.findByRole('button', { name: /Bet Higher/ }));
    expect(await screen.findByText(/minus the baseline's call at the moment the owner decides/)).toBeTruthy();
    expect(screen.getByLabelText('New impact')).toBeTruthy();
  });

  test('the owner is told what deciding records', async () => {
    renderFloor();
    await selectContract();
    await screen.findByLabelText('Impact if approved');
    expect(await screen.findByText(/Deciding records the baseline's call right now, \$80,000/)).toBeTruthy();
  });

  test('a decided pair shows the recorded reference and its impact against it', async () => {
    await withPayload(
      { reference: 78_000, approvedConsensus: 79_300, declinedConsensus: 78_000, approvedImpact: 1_300, declinedImpact: 0, delta: 1_300 },
      { status: 'approved', resolvedAt: '2026-09-06T14:02:00.000Z' },
    );
    renderFloor();
    await selectContract();
    const cell = await screen.findByLabelText('Baseline at the decision');
    expect(cell.textContent).toContain('$78,000');
    const impact = await screen.findByLabelText('Impact if approved');
    await waitFor(() => expect(impact.textContent).toContain('+$1,300'), { timeout: 3000 });
  });
});

describe('a pair from before difference pricing', () => {
  const level = {
    quotes: 'level',
    approvedImpact: null,
    declinedImpact: null,
    approvedConsensus: 82_000,
    declinedConsensus: 71_000,
    delta: 11_000,
    rangeMin: 0,
    rangeMax: 500_000,
    reference: null,
  };

  test('keeps the old question and the level as its headline', async () => {
    await withPayload(level);
    renderFloor();
    await selectContract();
    await waitFor(() => expect(question()).toMatch(/^What will be LookPilot's/));
    const cell = await screen.findByLabelText("Market's call if approved");
    await waitFor(() => expect(cell.textContent).toContain('$82,000'), { timeout: 3000 });
    expect(screen.queryByLabelText('Impact if approved')).toBeNull();
  });

  test('says it is priced as a level, under the call and in the ticket', async () => {
    await withPayload(level);
    renderFloor();
    await selectContract();
    const cell = await screen.findByLabelText("Market's call if approved");
    expect(cell.textContent).toContain('priced as a level');
    fireEvent.click(await screen.findByRole('button', { name: /Bet Higher/ }));
    expect(await screen.findByText(/price the level itself/)).toBeTruthy();
    expect(screen.getByLabelText('New value')).toBeTruthy();
  });
});
