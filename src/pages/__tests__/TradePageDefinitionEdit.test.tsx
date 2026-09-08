import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The settlement line belongs to the market ON SCREEN.
 *
 * The regression this pins (owner report 2026-08-21, "when i edit description
 * of telarchy market it edits the wrong market (the monthly one) instead of
 * the current one selected"): the floor read the workspace's hero metric, so
 * with two clocks up the nearer market was captioned with the OTHER market's
 * settlement text. The definition is on screen ONCE, behind "Full
 * definition" under the numbers band (docs/ui-conventions.md, "The
 * settlement line"); the in-place editor of 2026-08-18 is not rendered any
 * more, and the owner's "Edit" beside it opens the metric sheet.
 *
 * This file mocks its own signed-in admin (the sibling TradePage.test.tsx is
 * anonymous), because "Edit" only exists for a manager.
 */

const h = vi.hoisted(() => {
  const workspace = () => ({
    workspaceId: 'ws-1',
    name: 'Telarchy',
    slug: 'telarchy',
    ownerId: null,
    ownerHandle: null,
    description: null,
    charter: null,
    visibility: 'public',
    proposalReward: 0,
    spamPenalty: 0,
    joinAs: 'trader' as const,
    signupCredits: 100,
    metricCount: 2,
    openMarketCount: 2,
    participantCount: 3,
    heroMetricId: 'metric-year',
    heroMetricDescription: 'The year definition.',
    proposalStats: { total: 0, pending: 0, approved: 0, declined: 0 },
    markets: [
      {
        marketId: 'm-week',
        metricId: 'metric-week',
        metricName: 'Signups this week',
        targetDate: '2026-W34',
        resolvesOn: '2026-08-24T00:00:00Z',
        consensus: 213,
        probability: 0.5,
        liquidity: 200,
        rangeMin: 0,
        rangeMax: 8000,
      },
      {
        marketId: 'm-year',
        metricId: 'metric-year',
        metricName: 'Net 2026 (USD)',
        targetDate: '2026-12',
        resolvesOn: '2027-01-01T00:00:00Z',
        consensus: 78_571,
        probability: 0.5,
        liquidity: 200,
        rangeMin: 0,
        rangeMax: 150_000,
      },
    ],
    marketHistory: [],
    marketHistoryMarketId: 'm-year',
    horizonHistories: [
      { marketId: 'm-week', periodStart: '2026-08-17', points: [], description: 'The week definition.' },
      { marketId: 'm-year', periodStart: '2026-01-01', points: [], description: 'The year definition.' },
    ],
    proposals: [],
  });
  return { workspace };
});

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u-1', email: 'owner@example.com' }, loading: false }),
}));

vi.mock('../../components/MarketChart', () => ({
  // NumberChart (not mocked) imports the shared geometry from this module.
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
    updateMetricDescription: vi.fn(async () => ({})),
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
    <MemoryRouter initialEntries={['/telarchy']}>
      <Routes>
        <Route path="/:slug" element={<TradePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Which market is on screen, read from the question (never the animated price). */
const caption = (container: HTMLElement) => container.querySelector('h2.pubws-instrument-ask')?.textContent ?? '';

/** Step to the other metric: open the metric word's menu and pick it. */
const stepMetric = (container: HTMLElement) => {
  fireEvent.click(container.querySelector('.pubws-ask-word--live') as HTMLElement);
  fireEvent.click(
    [...container.querySelectorAll('.pubws-chip-menu [role="option"]')].find(b =>
      b.textContent?.includes('Signups this week'),
    )!,
  );
};

/** Open the definition under the band and hand back its block. */
const openDefinition = (container: HTMLElement) => {
  const go = within(container).queryByRole('button', { name: 'Full definition' });
  if (go) fireEvent.click(go);
  return container.querySelector('.pubws-instrument-more');
};

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
afterEach(() => {
  vi.clearAllMocks();
});

describe('the settlement line follows the market on screen', () => {
  test('the owner\'s Edit sits beside "Full definition" and opens the metric sheet', async () => {
    const { container } = renderFloor();
    await waitFor(() => expect(caption(container)).toContain('Net 2026'));
    const line = (await waitFor(() => {
      const el = container.querySelector('.pubws-instrument-sum');
      expect(el).not.toBeNull();
      return el;
    })) as HTMLElement;
    const edit = await within(line).findByRole('button', { name: 'Edit' });
    // Outside the clamped text, so the clamp can never swallow it.
    expect(edit.closest('.pubws-instrument-sum-text')).toBeNull();
    fireEvent.click(edit);
    expect(document.querySelector('[role="dialog"][aria-label="Metrics"]')).not.toBeNull();
    // And nothing edits the settlement text in place any more.
    expect(container.querySelector('.pubws-know-edit-text')).toBeNull();
    expect(vi.mocked(api.updateMetricDescription)).not.toHaveBeenCalled();
  });

  test('the definition renders markdown, and a plain newline is a line break', async () => {
    const ws = h.workspace();
    // Written the way an owner writes it over the API: emphasis, a single
    // newline (no trailing spaces), and a list. A <p> would print this as
    // one run-on line with the asterisks showing.
    ws.horizonHistories[1].description = 'Counts **net** revenue.\nRefunds subtract.\n- Steam\n- direct';
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    const { container } = renderFloor();
    await waitFor(() => expect(caption(container)).toContain('Net 2026'));
    await waitFor(() => expect(container.querySelector('.pubws-instrument-sum')).not.toBeNull());
    openDefinition(container);

    const what = container.querySelector('.pubws-instrument-more .pubws-know-what')!;
    expect(what.querySelector('strong')?.textContent).toBe('net');
    expect(what.textContent).not.toContain('**');
    // remark-breaks: the single newline became a real break.
    expect(what.querySelector('br')).toBeTruthy();
    expect(Array.from(what.querySelectorAll('li')).map(li => li.textContent)).toEqual(['Steam', 'direct']);
  });

  test('the definition shown under the nearer clock is never the hero metric fallback', async () => {
    const ws = h.workspace();
    // The week market's own definition is missing; the page must show
    // nothing rather than the year metric's text.
    ws.horizonHistories = [ws.horizonHistories[1]];
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    const { container } = renderFloor();
    await waitFor(() => expect(caption(container)).toContain('Net 2026'));
    await waitFor(() => expect(container.querySelector('.pubws-instrument-sum')).not.toBeNull());
    expect(container.querySelector('.pubws-instrument-sum-text')?.textContent).toContain('The year definition.');

    stepMetric(container);
    await waitFor(() => expect(caption(container)).toContain('Signups this week'));
    // No summary, no definition: no line at all, rather than another
    // market's settlement text.
    expect(container.querySelector('.pubws-instrument-sum')).toBeNull();
  });
});
