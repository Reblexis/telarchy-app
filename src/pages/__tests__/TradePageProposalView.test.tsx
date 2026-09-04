import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The proposal view is one sentence, one number, one action
 * (docs/ui-conventions.md, "A proposal is one sentence, one number, one
 * action"; decision 2026-09-04 in notes/decisions/ui-conventions.md).
 *
 * Every test here is named after the rule it protects. The fixture is the
 * ContractFacts one (an admin on LookPilot with one proposal, "$80: rewrite
 * the store page" by Ada), plus a reading and a definition on the hero
 * market so the "now" number and the summary line have something to show.
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
    horizonHistories: [
      {
        marketId: 'm-hero',
        metricName: 'LookPilot revenue (monthly, USD)',
        targetDate: '2026-12',
        description: 'Everything LookPilot earned in the last 30 days. Net of refunds.',
        points: [{ at: '2026-08-12T08:00:00.000Z', value: 80_000 }],
      },
    ],
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

describe('the proposal view is one sentence, one number, one action', () => {
  test('the caption chips stay in proposal view, and the sentence keeps its menu words', async () => {
    renderFloor();
    await screen.findByRole('heading', { name: /^What will be/ });
    await selectContract();
    await screen.findByRole('button', { name: 'if approved' });
    // Both ways in (owner, 2026-09-04, "doing both"): the chips line above
    // the sentence, and the words in it. One metric on one date here, so
    // both are plain text; the line itself must be there.
    expect(document.querySelector('.pubws-instrument-label .pubws-chip--date')).toBeTruthy();
    const q = screen.getByRole('heading', { name: /is paid \$80/ });
    expect(q.textContent?.startsWith('What will be')).toBe(true);
  });

  test('the summary line is not rendered in proposal view', async () => {
    renderFloor();
    await waitFor(() =>
      expect(document.querySelector('.pubws-instrument-sum')?.textContent).toBe(
        'Everything LookPilot earned in the last 30 days.',
      ),
    );
    await selectContract();
    await screen.findByRole('button', { name: 'if approved' });
    expect(document.querySelector('.pubws-instrument-sum')).toBeNull();
  });

  test('the proposal view is left-aligned', async () => {
    renderFloor();
    await screen.findByRole('heading', { name: /^What will be/ });
    expect(document.querySelector('.pubws-instrument--proposal')).toBeNull();
    await selectContract();
    await screen.findByRole('button', { name: 'if approved' });
    expect(document.querySelector('.pubws-instrument--proposal')).toBeTruthy();
  });

  test('the eyebrow carries the required facts once: proposal, proposer, ask, posted day', async () => {
    renderFloor();
    await selectContract();
    const eyebrow = await waitFor(() => {
      const el = document.querySelector('.pubws-proposal-eyebrow');
      if (!el) throw new Error('no eyebrow');
      return el;
    });
    const text = (eyebrow.textContent ?? '').replace(/\s+/g, ' ').trim();
    expect(text).toMatch(/^Proposal/i);
    expect(text).toContain('by Ada');
    expect(text).toContain('$80 to them');
    expect(text).toContain('posted 12 Aug');
  });

  test('the details sit under "What <proposer> would do"', async () => {
    renderFloor();
    await selectContract();
    expect(await screen.findByText('What Ada would do')).toBeTruthy();
    expect(screen.getByText('A better store page.').className).toContain('pubws-details');
  });

  test('there is no branch toggle group; the world word and the two branch numbers switch the world', async () => {
    renderFloor();
    await selectContract();
    const approved = await screen.findByRole('button', { name: 'if approved' });
    const declined = screen.getByRole('button', { name: 'if declined' });
    expect(document.querySelector('.pubws-branch')).toBeNull();
    expect(approved.getAttribute('aria-pressed')).toBe('true');
    expect(declined.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(declined);
    await waitFor(() => expect(declined.getAttribute('aria-pressed')).toBe('true'));
    expect(approved.getAttribute('aria-pressed')).toBe('false');
  });

  test('the impact is the headline number in proposal view, in the metric unit, with a plain sentence', async () => {
    renderFloor();
    await selectContract();
    const impact = await waitFor(() => {
      const el = document.querySelector('.pubws-impact');
      if (!el) throw new Error('no impact');
      return el as HTMLElement;
    });
    expect(impact.querySelector('.pubws-price')?.textContent).toBe('+$11,000');
    expect(impact.textContent).toContain('if this is approved');
    expect(impact.textContent).toMatch(/revenue/i);
    // The floor's two-block stat row is not on the page in proposal view.
    expect(document.querySelector('.pubws-stat--call')).toBeNull();
  });

  test('the impact keeps its sign whichever world is on screen', async () => {
    renderFloor();
    await selectContract();
    await waitFor(() => expect(document.querySelector('.pubws-impact .pubws-price')?.textContent).toBe('+$11,000'));
    fireEvent.click(screen.getByRole('button', { name: 'if declined' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'if declined' }).getAttribute('aria-pressed')).toBe('true'),
    );
    expect(document.querySelector('.pubws-impact .pubws-price')?.textContent).toBe('+$11,000');
  });

  test('now, if approved and if declined are the three named numbers under the headline', async () => {
    renderFloor();
    await selectContract();
    const now = await waitFor(() => {
      const el = document.querySelector('.pubws-stat--now');
      if (!el) throw new Error('no now block');
      return el as HTMLElement;
    });
    expect(now.textContent).toContain('$80,000');
    expect(now.textContent).toContain('now');
    expect(screen.getByRole('button', { name: 'if approved' }).textContent).toContain('$82,000');
    expect(screen.getByRole('button', { name: 'if declined' }).textContent).toContain('$71,000');
  });

  test('the decision bar is one row: Approve filled, Decline, then Edit proposal and Remove as quiet text', async () => {
    renderFloor();
    await selectContract();
    const approve = await screen.findByRole('button', { name: 'Approve, pay $80' });
    const bar = approve.closest('.pubws-ownerbar') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(within(bar).getByRole('button', { name: 'Decline' })).toBeTruthy();
    const edit = within(bar).getByRole('button', { name: 'Edit proposal' });
    const remove = within(bar).getByRole('button', { name: 'Remove' });
    expect(edit.className).toContain('pubws-decide--quiet');
    expect(remove.className).toContain('pubws-decide--quiet');
    expect(document.querySelectorAll('.pubws-ownerbar')).toHaveLength(1);
  });
});

describe('a visitor reads plain words', () => {
  test('the floor says "the market expects", never "market\'s call"', async () => {
    renderFloor();
    await waitFor(() => expect(document.querySelector('.pubws-stat--call')).toBeTruthy());
    expect(document.querySelector('.pubws-stat--call .pubws-stat-what')?.textContent).toMatch(/^the market expects/);
    expect(document.body.textContent).not.toContain("market's call");
  });

  test('the board column says "change by <date> if approved"', async () => {
    renderFloor();
    const board = await waitFor(() => {
      const el = document.querySelector('section[aria-label="Proposals"] .pubws-lb-meta');
      if (!el) throw new Error('no column label');
      return el;
    });
    expect(board.textContent).toMatch(/^change by .+ if approved$/);
    expect(board.closest('section')?.textContent).not.toContain('impact');
  });
});
