import { fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Correcting a proposal is a small, rare act, so it gets a small, rare
 * control (docs/ui-conventions.md, "A proposal has an address and a card";
 * owner ask 2026-09-09: "edit proposal make that more like an icon in
 * topright/bottomright"). A pencil on the words' head row, where the metric
 * definition's edit already lives, not a full-width button under the prose
 * competing with the ruling.
 */

const h = vi.hoisted(() => {
  const ws = () => ({
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
    metricCount: 1,
    openMarketCount: 1,
    participantCount: 3,
    proposalStats: { total: 1, pending: 1, approved: 0, declined: 0 },
    markets: [
      {
        marketId: 'rev-sep',
        metricId: 'rev',
        metricName: 'LookPilot net revenue (USD)',
        metricOrder: 0,
        targetDate: '2026-10',
        resolvesOn: '2026-11-01T00:00:00Z',
        consensus: 7_100,
        probability: 0.5,
        liquidity: 200,
        pool: 3_000,
        traderCount: 2,
        tradedVolume: 40,
        rangeMin: 0,
        rangeMax: 50_000,
      },
    ],
    marketHistory: [],
    marketHistoryMarketId: 'rev-sep',
    horizonHistories: [{ marketId: 'rev-sep', periodStart: '2026-09-01', points: [], description: 'Revenue.' }],
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
        proposedByHandle: 'ada',
        createdAt: '2026-08-12T09:00:00.000Z',
        marketPairCount: 1,
        markets: [
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
  return { ws };
});

let capabilities = ['read', 'trade', 'manage'];

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u-1', email: 'owner@example.com' }, loading: false }),
}));

vi.mock('../../components/MarketChart', () => ({
  GEOM: {
    wide: { W: 720, PAD_L: 46, PAD_R: 58, H: 260 },
    compact: { W: 400, PAD_L: 40, PAD_R: 50, H: 300 },
  },
  MarketChart: () => <div data-testid="call-chart" />,
}));

vi.mock('../../lib/api', () => {
  const explicit: Record<string, unknown> = {
    getMarketplaceWorkspace: vi.fn(async () => h.ws()),
    getPublicMarketHistory: vi.fn(async () => []),
    getLeaderboard: vi.fn(async () => ({ participants: [] })),
    getMarketActivity: vi.fn(async () => ({ consensus: null, positions: [], trades: [] })),
    getFloorComments: vi.fn(async () => []),
    getProfile: vi.fn(async () => ({ capabilities })),
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

async function openProposal(container: HTMLElement) {
  await waitFor(() => expect(container.querySelector('.pubws-ballot-row')).toBeTruthy());
  fireEvent.click(container.querySelector('.pubws-ballot-row') as HTMLElement);
  await waitFor(() => expect(container.querySelector('.pubws-proposal-head')).toBeTruthy());
}

const head = (c: HTMLElement) => c.querySelector('.pubws-proposal-words .pubws-know-head') as HTMLElement;

beforeEach(() => {
  capabilities = ['read', 'trade', 'manage'];
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
  vi.mocked(api.getMarketplaceWorkspace).mockImplementation(async () => h.ws() as never);
  sessionStorage.clear();
});
afterEach(() => vi.clearAllMocks());

describe('editing a proposal is a pencil, not a button', () => {
  test('the edit is an icon on the words head row', async () => {
    const { container } = renderFloor();
    await openProposal(container);
    await waitFor(() => expect(head(container).querySelector('.pubws-icon-edit')).toBeTruthy());
    const pencil = head(container).querySelector('.pubws-icon-edit') as HTMLElement;
    expect(pencil.getAttribute('aria-label')).toBe('Edit proposal');
    expect(pencil.querySelector('svg')).toBeTruthy();
    // Nothing but the icon says it: no word-button anywhere on the floor.
    expect([...container.querySelectorAll('button')].some(b => b.textContent?.trim() === 'Edit proposal')).toBe(false);
  });

  test('the pencil opens the edit form and stands down while it is open', async () => {
    const { container } = renderFloor();
    await openProposal(container);
    await waitFor(() => expect(head(container).querySelector('.pubws-icon-edit')).toBeTruthy());
    fireEvent.click(head(container).querySelector('.pubws-icon-edit') as HTMLElement);
    await waitFor(() => expect(container.querySelector('.pubws-know-edit')).toBeTruthy());
    expect(head(container).querySelector('.pubws-icon-edit')).toBeNull();
  });

  test('somebody who cannot edit this proposal never sees the pencil', async () => {
    capabilities = ['read', 'trade'];
    const { container } = renderFloor();
    await openProposal(container);
    // Give the profile fetch a tick to land before asserting the absence.
    await waitFor(() => expect(container.querySelector('.pubws-proposal-words')).toBeTruthy());
    expect(head(container).querySelector('.pubws-icon-edit')).toBeNull();
  });
});
