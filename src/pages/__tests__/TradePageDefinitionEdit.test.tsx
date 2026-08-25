import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The definition editor writes the metric of the market ON SCREEN.
 *
 * The regression this pins (owner report 2026-08-21, "when i edit description
 * of telarchy market it edits the wrong market (the monthly one) instead of
 * the current one selected"): saveDefinition targeted ws.heroMetricId, the
 * workspace's hero metric, so with two clocks up an edit made under the
 * nearer market rewrote the OTHER market's settlement text.
 *
 * This file mocks its own signed-in admin (the sibling TradePage.test.tsx is
 * anonymous), because the editor only exists for a manager.
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
    maxPositionCostPerMarket: 0,
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

/** Which market is on screen, read from the caption (never the animated price). */
const caption = (container: HTMLElement) => container.querySelector('.pubws-instrument-label')?.textContent ?? '';

/** The "What is this market?" section, so queries never leak into the
 *  workspace-about section, which has its own Edit button and prose. */
const defSection = (container: HTMLElement) =>
  within(container.querySelector('[aria-label="What is this market"]') as HTMLElement);

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

describe('the definition editor edits the market on screen', () => {
  test('saving under the nearer clock writes ITS metric, not the hero metric', async () => {
    const { container } = renderFloor();
    // The headline is the furthest-resolving market (the year).
    await waitFor(() => expect(caption(container)).toContain('Net 2026'));
    // The manager's Edit button appears once the profile answers admin.
    await waitFor(() => expect(defSection(container).getByRole('button', { name: 'Edit' })).toBeTruthy());

    // Step to the week market and confirm it is the one on screen.
    fireEvent.click(
      [...container.querySelectorAll('.pubws-seg-btn')].find(b => b.textContent?.includes('Signups this week'))!,
    );
    await waitFor(() => expect(caption(container)).toContain('Signups this week'));

    fireEvent.click(defSection(container).getByRole('button', { name: 'Edit' }));
    const box = container.querySelector('.pubws-know-edit-text') as HTMLTextAreaElement;
    // The draft opens on the on-screen market's own definition, not the
    // hero metric's.
    expect(box.value).toBe('The week definition.');
    fireEvent.change(box, { target: { value: 'Signups counted Mon-Sun.' } });
    fireEvent.click(defSection(container).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(vi.mocked(api.updateMetricDescription)).toHaveBeenCalledWith(
        'metric-week',
        'Signups counted Mon-Sun.',
        'ws-1',
      ),
    );
    expect(vi.mocked(api.updateMetricDescription)).not.toHaveBeenCalledWith(
      'metric-year',
      expect.anything(),
      expect.anything(),
    );
  });

  test('the definition renders markdown, and a plain newline is a line break', async () => {
    const ws = h.workspace();
    // Written the way an owner writes it over the API: emphasis, a single
    // newline (no trailing spaces), and a list. The old <p> printed this as
    // one run-on line with the asterisks showing.
    ws.horizonHistories[1].description = 'Counts **net** revenue.\nRefunds subtract.\n- Steam\n- direct';
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(ws as never);
    const { container } = renderFloor();
    await waitFor(() => expect(caption(container)).toContain('Net 2026'));

    const what = container.querySelector('.pubws-know-what')!;
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
    expect(defSection(container).getByText('The year definition.')).toBeTruthy();

    fireEvent.click(
      [...container.querySelectorAll('.pubws-seg-btn')].find(b => b.textContent?.includes('Signups this week'))!,
    );
    await waitFor(() => expect(caption(container)).toContain('Signups this week'));
    expect(defSection(container).queryByText('The year definition.')).toBeNull();
  });
});
