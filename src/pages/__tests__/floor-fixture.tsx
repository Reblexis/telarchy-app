import { act, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';

/**
 * One floor for every floor test (docs/ui-conventions.md, "Trading floor").
 *
 * The workspace is a fresh object per call, like a real fetch, so a test
 * that depends on object identity by accident fails here rather than in
 * production. Two metrics read on three dates, two pending proposals (one
 * paid, by somebody else; one free, by the owner) and one decided, so the
 * owner's inbox, the books list and the pair all have something to show.
 *
 * Clock: the fixture is written against 2026-09-08T10:00Z; tests freeze
 * Date there with `freezeClock()`.
 */

export const NOW = '2026-09-08T10:00:00.000Z';
export const OWNER_ID = 'p-owner';
export const OTHER_ID = 'p-agents';

export function freezeClock(): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
}

export type Fx = {
  auth: { user: { id: string; name?: string; email?: string; image?: string | null } | null; loading: boolean };
  ws: () => Record<string, unknown>;
  overrides: Record<string, unknown>;
  profile: { capabilities: string[] };
  participant: Record<string, unknown>;
  history: Record<string, Array<{ at: string; consensus: number | null }>>;
  earn: number | null;
  activity: (marketId: string) => { consensus: number | null; positions: unknown[]; trades: unknown[] };
  calls: Record<string, ReturnType<typeof vi.fn>>;
};

const activeMonthHistory = [
  { at: '2026-08-20T09:00:00.000Z', consensus: 25 },
  { at: '2026-09-01T09:00:00.000Z', consensus: 19.5 },
  { at: '2026-09-08T08:00:00.000Z', consensus: 19.8 },
];

export function baseWorkspace(): Record<string, unknown> {
  return {
    workspaceId: 'ws-1',
    name: 'Telarchy',
    slug: 'telarchy',
    ownerId: OWNER_ID,
    ownerHandle: 'Viktor36',
    description: 'This platform, running on itself.',
    charter: null,
    visibility: 'public',
    proposalReward: 500,
    spamPenalty: 0,
    joinAs: 'trader',
    signupCredits: 1000,
    metricCount: 2,
    openMarketCount: 4,
    participantCount: 40,
    traderCount: 22,
    proposalStats: { total: 3, pending: 2, approved: 1, declined: 0 },
    markets: [
      {
        marketId: 'm-day',
        metricId: 'metric-active',
        metricName: 'Active traders',
        metricOrder: 0,
        targetDate: '2026-09-08',
        resolvesOn: '2026-09-09T00:00:00.000Z',
        consensus: 9.4,
        probability: 0.188,
        liquidity: 5771,
        pool: 4000,
        traderCount: 5,
        tradedVolume: 900,
        rangeMin: 0,
        rangeMax: 50,
      },
      {
        marketId: 'm-week',
        metricId: 'metric-active',
        metricName: 'Active traders',
        metricOrder: 0,
        targetDate: '2026-W37',
        resolvesOn: '2026-09-14T00:00:00.000Z',
        consensus: 11.2,
        probability: 0.224,
        liquidity: 17312,
        pool: 12000,
        traderCount: 9,
        tradedVolume: 3000,
        rangeMin: 0,
        rangeMax: 50,
      },
      {
        marketId: 'm-month',
        metricId: 'metric-active',
        metricName: 'Active traders',
        metricOrder: 0,
        targetDate: '2026-09',
        resolvesOn: '2026-10-01T00:00:00.000Z',
        consensus: 19.8,
        probability: 0.396,
        liquidity: 54822,
        pool: 38000,
        traderCount: 21,
        tradedVolume: 15000,
        rangeMin: 0,
        rangeMax: 50,
      },
      {
        marketId: 'm-signups',
        metricId: 'metric-signups',
        metricName: 'Signups',
        metricOrder: 1,
        targetDate: '2026-09',
        resolvesOn: '2026-10-01T00:00:00.000Z',
        consensus: 41,
        probability: 0.41,
        liquidity: 12984,
        pool: 9000,
        traderCount: 6,
        tradedVolume: 2000,
        rangeMin: 0,
        rangeMax: 100,
      },
    ],
    marketHistory: activeMonthHistory,
    marketHistoryMarketId: 'm-month',
    horizonHistories: [
      {
        marketId: 'm-day',
        metricName: 'Active traders',
        targetDate: '2026-09-08',
        platformSynced: true,
        measured: true,
        description:
          'Participants with a synced Manifold account and 100 cr of absolute trades in the trailing 7 days, across every floor. Counted hourly by the platform.',
        settlementSummary: null,
        points: [
          { at: '2026-08-20T09:00:00.000Z', value: 8 },
          { at: '2026-09-05T09:00:00.000Z', value: 9 },
        ],
      },
      {
        marketId: 'm-week',
        metricName: 'Active traders',
        targetDate: '2026-W37',
        platformSynced: true,
        measured: true,
        description:
          'Participants with a synced Manifold account and 100 cr of absolute trades in the trailing 7 days, across every floor. Counted hourly by the platform.',
        settlementSummary: null,
        points: [
          { at: '2026-08-20T09:00:00.000Z', value: 8 },
          { at: '2026-09-05T09:00:00.000Z', value: 9 },
        ],
      },
      {
        marketId: 'm-month',
        metricName: 'Active traders',
        targetDate: '2026-09',
        platformSynced: true,
        measured: true,
        description:
          'Participants with a synced Manifold account and 100 cr of absolute trades in the trailing 7 days, across every floor. Counted hourly by the platform.',
        settlementSummary: null,
        points: [
          { at: '2026-08-20T09:00:00.000Z', value: 8 },
          { at: '2026-09-05T09:00:00.000Z', value: 9 },
        ],
      },
      {
        marketId: 'm-signups',
        metricName: 'Signups',
        targetDate: '2026-09',
        platformSynced: false,
        measured: true,
        description: 'Accounts created on telarchy.com this calendar month. Reported by the owner from the database.',
        settlementSummary: 'accounts created this month, per the database',
        points: [
          { at: '2026-09-01T09:00:00.000Z', value: 30 },
          { at: '2026-09-08T09:25:00.000Z', value: 41 },
        ],
      },
    ],
    proposals: [
      {
        id: 'job-paid',
        number: 3,
        title: '$200: Ship an open-source reference trading agent with a tutorial',
        description:
          'Agents are first-class participants here, and there is currently no worked example of one. A Manifold quant who would happily write a trading bot has nothing to start from. Every trader who runs an agent is a candidate for the verified weekly count. The tutorial covers keys, the market list and one trade.',
        askUsd: 200,
        status: 'pending',
        proposedByName: 'telarchy-agents',
        proposedByHandle: OTHER_ID,
        createdAt: '2026-08-15T09:00:00.000Z',
        editedAt: '2026-08-20T09:00:00.000Z',
        marketPairCount: 4,
        markets: [
          pair('metric-active', 'Active traders', '2026-09-08', '2026-09-09T00:00:00.000Z', 9.5, 9.4, 'a-day', 'd-day'),
          pair(
            'metric-active',
            'Active traders',
            '2026-W37',
            '2026-09-14T00:00:00.000Z',
            11.3,
            11.2,
            'a-week',
            'd-week',
          ),
          pair(
            'metric-active',
            'Active traders',
            '2026-09',
            '2026-10-01T00:00:00.000Z',
            17.04,
            17.0,
            'a-month',
            'd-month',
          ),
          pair('metric-signups', 'Signups', '2026-09', '2026-10-01T00:00:00.000Z', 42, 41, 'a-sign', 'd-sign', 100),
        ],
      },
      {
        id: 'job-free',
        number: 31,
        title: 'Referral rule in the earn table: 200 credits for bringing a verified trader',
        description: 'A referral rule.',
        askUsd: 0,
        status: 'pending',
        proposedByName: 'Viktor36',
        proposedByHandle: OWNER_ID,
        createdAt: '2026-09-01T09:00:00.000Z',
        editedAt: null,
        marketPairCount: 4,
        markets: [
          pair(
            'metric-active',
            'Active traders',
            '2026-09-08',
            '2026-09-09T00:00:00.000Z',
            9.4,
            9.4,
            'fa-day',
            'fd-day',
          ),
          pair(
            'metric-active',
            'Active traders',
            '2026-W37',
            '2026-09-14T00:00:00.000Z',
            11.2,
            11.2,
            'fa-week',
            'fd-week',
          ),
          pair(
            'metric-active',
            'Active traders',
            '2026-09',
            '2026-10-01T00:00:00.000Z',
            23.5,
            19.8,
            'fa-month',
            'fd-month',
          ),
          pair('metric-signups', 'Signups', '2026-09', '2026-10-01T00:00:00.000Z', 41, 41, 'fa-sign', 'fd-sign', 100),
        ],
      },
      {
        id: 'job-done',
        number: 2,
        title: '$20: Publish a LessWrong post on running a company by prediction markets',
        description: 'A post.',
        askUsd: 20,
        status: 'approved',
        resolvedAt: '2026-09-02T09:00:00.000Z',
        proposedByName: 'telarchy-agents',
        proposedByHandle: OTHER_ID,
        createdAt: '2026-08-10T09:00:00.000Z',
        editedAt: null,
        marketPairCount: 1,
        markets: [
          pair(
            'metric-active',
            'Active traders',
            '2026-09',
            '2026-10-01T00:00:00.000Z',
            20.0,
            19.8,
            'xa-month',
            'xd-month',
          ),
        ],
      },
    ],
    topContractors: [
      { id: OTHER_ID, name: 'telarchy-agents', impact: 0.24, jobs: 2, pendingJobs: 1, pricedJobs: 2, earnedUsd: 20 },
    ],
    latestAnnouncement: {
      id: 'ann-1',
      body: "September's weekly trader forecast dropped 21% this week, from 25 to 19.75.",
      publishedAt: '2026-08-25T09:00:00.000Z',
      editedAt: null,
      originalBody: null,
      publishedBy: null,
    },
    announcementCount: 5,
  };
}

function pair(
  metricId: string,
  metricName: string,
  targetDate: string,
  resolvesOn: string,
  approved: number,
  declined: number,
  aid: string,
  did: string,
  rangeMax = 50,
) {
  return {
    metricId,
    metricName,
    targetDate,
    resolvesOn,
    approvedConsensus: approved,
    declinedConsensus: declined,
    delta: approved - declined,
    approvedMarketId: aid,
    declinedMarketId: did,
    approvedProbability: approved / rangeMax,
    declinedProbability: declined / rangeMax,
    approvedLiquidity: 425,
    declinedLiquidity: 474,
    approvedPool: 295,
    declinedPool: 329,
    approvedTraders: 4,
    declinedTraders: 3,
    approvedVolume: 600,
    declinedVolume: 500,
    rangeMin: 0,
    rangeMax,
  };
}

/** The mutable state behind the mocks; one per test file, reset in beforeEach. */
export function makeFx(): Fx {
  const fx: Fx = {
    auth: { user: null, loading: false },
    overrides: {},
    ws: () => ({ ...baseWorkspace(), ...fx.overrides }),
    profile: { capabilities: [] },
    participant: { id: 'p-viewer', balance: 946_000, liquidityBalance: 0, payoutHandle: 'paypal:viktor' },
    history: {
      'm-month': activeMonthHistory,
      'm-week': [
        { at: '2026-09-07T09:00:00.000Z', consensus: 11 },
        { at: '2026-09-08T07:00:00.000Z', consensus: 11.2 },
      ],
      'm-day': [{ at: '2026-09-08T00:30:00.000Z', consensus: 9.4 }],
      'm-signups': [
        { at: '2026-09-01T09:00:00.000Z', consensus: 30 },
        { at: '2026-09-06T09:00:00.000Z', consensus: 41 },
      ],
      'a-month': [
        { at: '2026-08-15T09:00:00.000Z', consensus: 19.5 },
        { at: '2026-09-05T09:00:00.000Z', consensus: 17.04 },
      ],
      'd-month': [
        { at: '2026-08-15T09:00:00.000Z', consensus: 19.5 },
        { at: '2026-09-04T09:00:00.000Z', consensus: 17.0 },
      ],
    },
    earn: 10_025,
    activity: () => ({ consensus: null, positions: [], trades: [] }),
    calls: {},
  };
  return fx;
}

export function resetFx(fx: Fx): void {
  fx.auth.user = null;
  fx.auth.loading = false;
  fx.overrides = {};
  fx.profile = { capabilities: [] };
  fx.participant = { id: 'p-viewer', balance: 946_000, liquidityBalance: 0, payoutHandle: 'paypal:viktor' };
  fx.earn = 10_025;
  fx.activity = () => ({ consensus: null, positions: [], trades: [] });
  // mockReset, not mockClear: a test that installs its own answer (an
  // empty positions list, a workspace that never resolves) must not leave
  // it standing for the next one. vi.fn(impl) restores impl on reset.
  for (const k of Object.keys(fx.calls)) fx.calls[k].mockReset();
}

export function signIn(fx: Fx, role: 'trader' | 'owner'): void {
  fx.auth.user = { id: role === 'owner' ? 'u-owner' : 'u-viewer', name: role === 'owner' ? 'Viktor' : 'Vire' };
  fx.profile = { capabilities: role === 'owner' ? ['manage', 'trade'] : ['trade'] };
  fx.participant = {
    ...fx.participant,
    id: role === 'owner' ? OWNER_ID : 'p-viewer',
    nickname: role === 'owner' ? 'Viktor36' : 'vire',
  };
}

/** The api mock: explicit answers for what the floor reads, and an empty
 *  array for anything a sub-component asks that a test does not care about. */
export function apiMock(fx: Fx) {
  const explicit: Record<string, unknown> = {
    getMarketplaceWorkspace: vi.fn(async () => fx.ws()),
    getPublicMarketHistory: vi.fn(async (_slug: string, marketId: string) => fx.history[marketId] ?? []),
    getLeaderboard: vi.fn(async () => ({
      participants: [
        {
          id: 'p-vire',
          nickname: 'vire',
          rank: 1,
          calibration: null,
          accuracy: null,
          totalEarnings: 5980,
          resolvedMarkets: 3,
          totalTrades: 12,
          lastTradeAt: null,
          seasonEntered: true,
          seasonPrizeUsd: null,
        },
        {
          id: OWNER_ID,
          nickname: 'Viktor36',
          rank: 21,
          calibration: null,
          accuracy: null,
          totalEarnings: -66,
          resolvedMarkets: 1,
          totalTrades: 2,
          lastTradeAt: null,
        },
      ],
    })),
    getProfile: vi.fn(async () => ({ authRole: 'user', capabilities: fx.profile.capabilities })),
    getParticipant: vi.fn(async () => fx.participant),
    getMarketActivity: vi.fn(async (_slug: string, marketId: string) => fx.activity(marketId)),
    getFloorComments: vi.fn(async () => []),
    getPositions: vi.fn(async () => []),
    getLimitOrders: vi.fn(async () => []),
    getSeasons: vi.fn(async () => ({
      seasons: [
        {
          id: 's0',
          name: 'Season 0',
          status: 'running',
          startsAt: '2026-09-01T00:00:00.000Z',
          endsAt: '2026-10-01T00:00:00.000Z',
          settledAt: null,
          poolUsd: 1000,
          payoutMode: 'proportional',
          minPayoutUsd: 5,
          strictEligibility: false,
          ladder: [],
          rulesUrl: '/legal/season-0',
          entrantCount: 22,
        },
      ],
    })),
    getMySeason: vi.fn(async () => ({ optedIn: false })),
    getMyEarn: vi.fn(async () => ({ available: fx.earn ?? 0 })),
    getWorkspaceAnnouncements: vi.fn(async () => ({
      announcements: [
        {
          id: 'ann-1',
          body: "September's weekly trader forecast dropped 21% this week, from 25 to 19.75.",
          publishedAt: '2026-08-25T09:00:00.000Z',
          editedAt: null,
          originalBody: null,
          publishedBy: null,
        },
        {
          id: 'ann-2',
          body: 'Season 0 pool split now proportional to settled score.',
          publishedAt: '2026-08-28T09:00:00.000Z',
          editedAt: null,
          originalBody: null,
          publishedBy: null,
        },
      ],
    })),
    updateWorkspaceSettings: vi.fn(async () => ({})),
    joinWorkspace: vi.fn(async () => ({})),
    joinWaitlist: vi.fn(async () => ({ alreadyListed: false })),
    trade: vi.fn(async () => ({ consensus: 20 })),
    approveProposal: vi.fn(async () => ({})),
    declineProposal: vi.fn(async () => ({})),
    removeProposal: vi.fn(async () => ({})),
    createProposal: vi.fn(async () => ({ id: 'job-new' })),
    editProposal: vi.fn(async () => ({})),
    getWorkspace: vi.fn(async () => ({ newMarketLiquidityCredits: 1000 })),
    setupChecklist: vi.fn(async () => ({ items: [] })),
    askFloor: vi.fn(async () => ({ answer: 'ok' })),
  };
  for (const [k, v] of Object.entries(explicit)) fx.calls[k] = v as ReturnType<typeof vi.fn>;
  const api = new Proxy(explicit, {
    get(target, prop: string) {
      if (!(prop in target)) target[prop] = vi.fn(async () => []);
      return target[prop];
    },
  });
  return { api, setActiveWorkspace: vi.fn() };
}

export function renderFloor(TradePage: () => ReactNode, entries: string[] = ['/telarchy'], extra?: ReactNode) {
  return render(
    <MemoryRouter initialEntries={entries}>
      <Routes>
        <Route path="/marketplace/:workspaceId" element={<TradePage />} />
        <Route path="/:slug" element={<TradePage />} />
        <Route path="/signup" element={<p data-testid="signup-door">signup door</p>} />
        <Route path="/login" element={<p data-testid="login-door">login door</p>} />
        <Route path="/waitlist" element={<p data-testid="setup-door">setup door</p>} />
        <Route path="/guides" element={<p data-testid="guide">guide</p>} />
        <Route path="/leaderboard" element={<p data-testid="leaderboard">leaderboard</p>} />
      </Routes>
      {extra}
    </MemoryRouter>,
  );
}

export function installObservers(): void {
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
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({
      matches: false,
      media: q,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  Element.prototype.scrollIntoView = vi.fn();
}

export async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
