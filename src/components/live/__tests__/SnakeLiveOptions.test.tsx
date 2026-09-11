import { fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The snake feed once a step is ONE proposal with three options
 * (docs/guides/proposals.md, "More than two options"; docs/ui-conventions.md,
 * "The snake feed", "The feed drives the floor"): `open.proposal` names the
 * step's one proposal and `open.quotes[action].m60` carries each option's
 * `price` and `lead` (its consensus minus the best other option, the
 * leader's positive). The three chevrons and the three chips all link to
 * that one proposal, shaded and printed by lead, and every read reports
 * the option prices by proposal id for the floor's own cells.
 */

const h = vi.hoisted(() => {
  const state = () => ({
    game: {
      snake: [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 3, y: 5 },
      ],
      food: { x: 8, y: 2 },
      heading: 'right',
      length: 3,
      step: 41,
      deaths: 0,
      complete: false,
      size: 12,
      gameNumber: 2,
    },
    grid: 12,
    gameNumber: 2,
    next: { action: 'left', direction: 'up', decided: false, seconds: 31 },
    open: {
      step: 42,
      decideAt: '2026-09-11T12:00:31Z',
      deadline: '2026-09-11T12:01:00Z',
      directions: { forward: 'right', left: 'up', right: 'down' },
      proposal: { id: 'p9', url: 'https://telarchy.com/snake/p/129', number: 129 },
      quotes: {
        forward: { m60: { price: 7.2, lead: -1.7, marketId: 'm-f' } },
        left: { m60: { price: 8.9, lead: 1.7, marketId: 'm-l' } },
        right: { m60: { price: 5.1, lead: -3.8, marketId: 'm-r' } },
      },
    },
    recentTrades: [],
    commentary: null,
    complete: false,
    nextGameAt: null,
  });
  const games = () => ({
    games: [
      {
        number: 2,
        size: 12,
        startedAt: '2026-09-10T10:00:00Z',
        endedAt: null,
        steps: 41,
        bestLength: 3,
        deaths: 0,
        partial: false,
      },
    ],
  });
  const history = () => ({
    game: { number: 2, size: 12, startedAt: '2026-09-10T10:00:00Z', endedAt: null },
    total: 0,
    from: 0,
    steps: [],
  });
  return { state, games, history };
});

vi.mock('../../../lib/api', () => ({
  api: {
    getLiveState: vi.fn(async () => h.state()),
    getLiveGames: vi.fn(async () => h.games()),
    getLiveHistory: vi.fn(async () => h.history()),
  },
}));

const { SnakeLive } = await import('../SnakeLive');
const { api } = await import('../../../lib/api');

const arrows = (c: HTMLElement) => [...c.querySelectorAll('.snake-arrow')] as SVGElement[];
const opacityOf = (el: SVGElement) => Number(el.style.strokeOpacity || el.getAttribute('stroke-opacity'));
const byAction = (c: HTMLElement) =>
  Object.fromEntries(arrows(c).map(a => [a.getAttribute('data-action'), a])) as Record<string, SVGElement>;

function renderLive(props: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter>
      <SnakeLive slug="snake" {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(api.getLiveState).mockImplementation(async () => h.state() as never);
});
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("ONE PROPOSAL PER STEP: the feed's `open.proposal` and per-option `price` / `lead`", () => {
  test("every read reports the one proposal's option prices and leads by proposal id", async () => {
    const onQuotes = vi.fn();
    renderLive({ onQuotes });
    await waitFor(() => expect(onQuotes).toHaveBeenCalled());
    expect(onQuotes).toHaveBeenLastCalledWith({
      p9: {
        options: {
          forward: { price: 7.2, lead: -1.7 },
          left: { price: 8.9, lead: 1.7 },
          right: { price: 5.1, lead: -3.8 },
        },
      },
    });
  });

  test('the three chevrons all link to the one proposal, shaded by lead: brightest the leader, faintest the last', async () => {
    const onPickProposal = vi.fn();
    const { container } = renderLive({ onPickProposal });
    await waitFor(() => expect(arrows(container).length).toBe(3));
    const a = byAction(container);
    for (const action of ['forward', 'left', 'right']) {
      expect(a[action].closest('a')?.getAttribute('href')).toBe('/snake/p/129');
    }
    expect(opacityOf(a.left)).toBeCloseTo(0.9, 5);
    expect(opacityOf(a.right)).toBeCloseTo(0.3, 5);
    const mid = opacityOf(a.forward);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.9);
    fireEvent.click(a.forward.closest('a') as Element);
    expect(onPickProposal).toHaveBeenCalledWith(129);
  });

  test('an option with a null price is unquoted: its chevron is drawn at the faint end', async () => {
    const s = h.state();
    s.open.quotes.right = { m60: { price: null, lead: null, marketId: null, reason: 'no liquidity' } } as never;
    vi.mocked(api.getLiveState).mockImplementation(async () => s as never);
    const { container } = renderLive();
    await waitFor(() => expect(arrows(container).length).toBe(3));
    const a = byAction(container);
    expect(opacityOf(a.left)).toBeCloseTo(0.9, 5);
    // Nothing staked is the faint end, never the tie's 0.55 for all three.
    expect(opacityOf(a.right)).toBeCloseTo(0.3, 5);
    expect(opacityOf(a.forward)).toBeCloseTo(0.3, 5);
  });

  test('all three unpriced is a tie: every chevron at the tie shading, and nothing printed', async () => {
    const s = h.state();
    for (const k of ['forward', 'left', 'right'] as const) {
      s.open.quotes[k] = { m60: { price: null, lead: null, marketId: null } } as never;
    }
    vi.mocked(api.getLiveState).mockImplementation(async () => s as never);
    const { container } = renderLive();
    await waitFor(() => expect(arrows(container).length).toBe(3));
    for (const el of Object.values(byAction(container))) expect(opacityOf(el)).toBeCloseTo(0.55, 5);
    expect(container.querySelector('.snake-why')).toBeNull();
    expect(container.querySelector('.snake-picks')).toBeNull();
  });
  test("once decided the chosen action's chevron stays, solid, linked to the one proposal", async () => {
    const s = h.state();
    s.next = { action: 'left', direction: 'up', decided: true, seconds: 0 };
    vi.mocked(api.getLiveState).mockImplementation(async () => s as never);
    const { container } = renderLive();
    await waitFor(() => expect(arrows(container).length).toBe(1));
    const only = arrows(container)[0];
    expect(only.getAttribute('data-action')).toBe('left');
    expect(opacityOf(only)).toBe(1);
    expect(only.closest('a')?.getAttribute('href')).toBe('/snake/p/129');
  });

  test('a proposal without a number takes it from the url', async () => {
    const s = h.state();
    s.open.proposal = { id: 'p9', url: 'https://telarchy.com/snake/p/130' } as never;
    vi.mocked(api.getLiveState).mockImplementation(async () => s as never);
    const { container } = renderLive();
    await waitFor(() => expect(arrows(container).length).toBe(3));
    expect(byAction(container).forward.closest('a')?.getAttribute('href')).toBe('/snake/p/130');
  });
});

describe('the old feed shape still reads', () => {
  test('per-action proposals with approved/declined quotes keep their pair behaviour', async () => {
    const s = h.state() as Record<string, unknown> & { open: Record<string, unknown> };
    delete s.open.proposal;
    s.open.proposals = {
      forward: { id: 'p1', title: 'Continue', url: 'https://telarchy.com/snake/p/121' },
      left: { id: 'p2', title: 'Turn left', url: 'https://telarchy.com/snake/p/122' },
      right: { id: 'p3', title: 'Turn right', url: 'https://telarchy.com/snake/p/123' },
    };
    s.open.quotes = {
      forward: { m60: { approved: 7.2, declined: 6 } },
      left: { m60: { approved: 8.9, declined: 6 } },
      right: { m60: { approved: 5.1, declined: 6 } },
    };
    vi.mocked(api.getLiveState).mockImplementation(async () => s as never);
    const onQuotes = vi.fn();
    const { container } = renderLive({ onQuotes });
    await waitFor(() => expect(arrows(container).length).toBe(3));
    const a = byAction(container);
    expect(['forward', 'left', 'right'].map(k => a[k].closest('a')?.getAttribute('href'))).toEqual([
      '/snake/p/121',
      '/snake/p/122',
      '/snake/p/123',
    ]);
    expect(onQuotes).toHaveBeenLastCalledWith({
      p1: { approved: 7.2, declined: 6 },
      p2: { approved: 8.9, declined: 6 },
      p3: { approved: 5.1, declined: 6 },
    });
  });
});
