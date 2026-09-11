import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The snake feed, drawn natively (docs/ui-conventions.md, "The live view is
 * a segment of the chart slot", "The snake feed"): the grid from `grid`,
 * the next move with its countdown, three tiles with the 60-move impact and
 * the leader, the status line, the quiet line, the 2-second poll while
 * visible, and the replay under it.
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
      cells: {},
      directions: { forward: 'right', left: 'up', right: 'down' },
      proposals: {
        forward: { id: 'p1', title: 'Continue', url: 'https://telarchy.com/snake/p/121' },
        left: { id: 'p2', title: 'Turn left', url: 'https://telarchy.com/snake/p/122' },
        right: { id: 'p3', title: 'Turn right', url: 'https://telarchy.com/snake/p/123' },
      },
      quotes: {
        forward: { m1: {}, m5: {}, m60: { approved: 7.2, declined: 6.0 } },
        left: { m1: {}, m5: {}, m60: { approved: 8.9, declined: 6.0 } },
        right: { m1: {}, m5: {}, m60: { approved: 5.1, declined: 6.0 } },
      },
    },
    recentDecisions: [],
    recentTrades: [{ id: 't1', at: '2026-09-11T12:00:10Z', handle: 'philipp-gl', step: 42, action: 'left', cost: 5 }],
    commentary: 'The market leans left.',
    complete: false,
    nextGameAt: null,
  });
  const games = () => ({
    games: [
      {
        number: 1,
        size: 12,
        startedAt: '2026-09-10T10:00:00Z',
        endedAt: '2026-09-10T18:00:00Z',
        steps: 400,
        bestLength: 9,
        deaths: 3,
      },
      { number: 2, size: 12, startedAt: '2026-09-11T08:00:00Z', endedAt: null, steps: 41, bestLength: 4, deaths: 0 },
    ],
  });
  const history = (game: number, from: number, limit: number) => {
    const total = game === 1 ? 401 : 42;
    const steps = [];
    for (let i = from; i < Math.min(total, from + limit); i++) {
      steps.push({
        step: i,
        at: '2026-09-10T10:00:00Z',
        snake: [
          { x: (i % 10) + 1, y: 2 },
          { x: i % 10, y: 2 },
        ],
        food: { x: 9, y: 9 },
        heading: 'right',
        action: i === 0 ? null : i % 3 === 0 ? 'right' : 'forward',
        direction: 'right',
        undecided: false,
        impact: { forward: 1, left: 0, right: -1 },
        length: 2 + (i % 4),
        deaths: 0,
      });
    }
    return { game: { number: game, size: 12, startedAt: '2026-09-10T10:00:00Z', endedAt: null }, total, from, steps };
  };
  return { state, games, history };
});

vi.mock('../../../lib/api', () => ({
  api: {
    getLiveState: vi.fn(async () => h.state()),
    getLiveGames: vi.fn(async () => h.games()),
    getLiveHistory: vi.fn(async (_slug: string, q: { game: number | string; from?: number; limit?: number }) =>
      h.history(Number(q.game), q.from ?? 0, q.limit ?? 300),
    ),
  },
}));

const { SnakeLive } = await import('../SnakeLive');
const { api } = await import('../../../lib/api');

function renderLive() {
  return render(
    <MemoryRouter>
      <SnakeLive slug="snake" />
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

describe('the grid', () => {
  test('draws grid x grid cells on a board sized by `grid`', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector('svg.snake-board')).toBeTruthy());
    expect(container.querySelectorAll('rect.snake-cell')).toHaveLength(144);
  });

  test('the snake is one rounded band along its cells, head first, with eyes on the moving side', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector('.snake-snake')).toBeTruthy());
    const band = container.querySelector('.snake-snake') as SVGPolylineElement;
    expect(band.getAttribute('stroke-linecap')).toBe('round');
    expect(band.getAttribute('stroke-linejoin')).toBe('round');
    // Cell centres, head first: (5.5, 5.5) (4.5, 5.5) (3.5, 5.5) in cell units.
    const pts = (band.getAttribute('points') ?? '').trim().split(/\s+/);
    expect(pts).toHaveLength(3);
    const cell = Number(container.querySelector('rect.snake-cell')?.getAttribute('width'));
    expect(pts[0]).toBe(`${5.5 * cell},${5.5 * cell}`);
    const head = container.querySelector('circle.snake-head') as SVGCircleElement;
    expect(Number(head.getAttribute('cx'))).toBeCloseTo(5.5 * cell);
    const eyes = Array.from(container.querySelectorAll('circle.snake-eye'));
    expect(eyes).toHaveLength(2);
    // Heading right: both eyes sit right of the head's centre.
    for (const e of eyes) expect(Number(e.getAttribute('cx'))).toBeGreaterThan(5.5 * cell);
  });

  test('the food is a round red dot in its cell', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector('circle.snake-food')).toBeTruthy());
    const cell = Number(container.querySelector('rect.snake-cell')?.getAttribute('width'));
    const food = container.querySelector('circle.snake-food') as SVGCircleElement;
    expect(Number(food.getAttribute('cx'))).toBeCloseTo(8.5 * cell);
    expect(Number(food.getAttribute('cy'))).toBeCloseTo(2.5 * cell);
  });
});

describe('the next move, the tiles, the status and the quiet line', () => {
  test('the next move is the arrow of the compass direction, the action, and the countdown', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector('.snake-next')).toBeTruthy());
    expect(container.querySelector('.snake-next-move')?.textContent).toBe('↑ Turn left');
    expect(container.querySelector('.snake-clock')?.textContent).toBe('0:31');
    expect(container.querySelector('.snake-next.is-decided')).toBeNull();
  });

  test('once decided the clock reads "decided" and the line is marked so', async () => {
    vi.mocked(api.getLiveState).mockImplementation(async () => {
      const s = h.state();
      s.next = { action: 'forward', direction: 'right', decided: true, seconds: 0 };
      return s as never;
    });
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector('.snake-next.is-decided')).toBeTruthy());
    expect(container.querySelector('.snake-next-move')?.textContent).toBe('→ Continue');
    expect(container.querySelector('.snake-clock')?.textContent).toBe('decided');
  });

  test('a countdown over a minute prints minutes and seconds', async () => {
    vi.mocked(api.getLiveState).mockImplementation(async () => {
      const s = h.state();
      s.next.seconds = 65;
      return s as never;
    });
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector('.snake-clock')?.textContent).toBe('1:05'));
  });

  test('three tiles, Continue, Turn left, Turn right, each with its arrow and 60-move impact', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelectorAll('.snake-tile')).toHaveLength(3));
    const tiles = Array.from(container.querySelectorAll('.snake-tile'));
    expect(tiles.map(t => t.querySelector('.snake-tile-name')?.textContent)).toEqual([
      'Continue',
      'Turn left',
      'Turn right',
    ]);
    expect(tiles.map(t => t.querySelector('.snake-tile-arrow')?.textContent)).toEqual(['→', '↑', '↓']);
    // approved minus declined on m60: 7.2-6.0, 8.9-6.0, 5.1-6.0.
    expect(tiles.map(t => t.querySelector('.snake-tile-impact')?.textContent)).toEqual(['+1.2', '+2.9', '-0.9']);
  });

  test('the leader, the highest impact, carries the accent', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelectorAll('.snake-tile')).toHaveLength(3));
    const lead = container.querySelectorAll('.snake-tile.is-lead');
    expect(lead).toHaveLength(1);
    expect(lead[0].querySelector('.snake-tile-name')?.textContent).toBe('Turn left');
  });

  test('an unreadable impact prints a dash and never leads', async () => {
    vi.mocked(api.getLiveState).mockImplementation(async () => {
      const s = h.state();
      s.open.quotes.left = { m1: {}, m5: {}, m60: { approved: null, declined: 6.0 } } as never;
      return s as never;
    });
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelectorAll('.snake-tile')).toHaveLength(3));
    const tiles = Array.from(container.querySelectorAll('.snake-tile'));
    expect(tiles[1].querySelector('.snake-tile-impact')?.textContent).toBe('—');
    expect(container.querySelector('.snake-tile.is-lead .snake-tile-name')?.textContent).toBe('Continue');
  });

  test('tiles link to the proposals on this floor by number', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelectorAll('.snake-tile')).toHaveLength(3));
    const hrefs = Array.from(container.querySelectorAll('a.snake-tile')).map(a => a.getAttribute('href'));
    expect(hrefs).toEqual(['/snake/p/121', '/snake/p/122', '/snake/p/123']);
  });

  test('a proposal url that carries no number links as given', async () => {
    vi.mocked(api.getLiveState).mockImplementation(async () => {
      const s = h.state();
      s.open.proposals.left = { id: 'p2', title: 'Turn left', url: 'https://elsewhere.example.com/x' };
      return s as never;
    });
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelectorAll('.snake-tile')).toHaveLength(3));
    const a = container.querySelectorAll('a.snake-tile')[1];
    expect(a.getAttribute('href')).toBe('https://elsewhere.example.com/x');
  });

  test('the status line is length, game and size', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector('.snake-status')).toBeTruthy());
    expect(container.querySelector('.snake-status')?.textContent).toBe('Length 3 · Game 2 · 12x12');
  });

  test('the quiet line is the newest trade', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector('.snake-quiet')).toBeTruthy());
    expect(container.querySelector('.snake-quiet')?.textContent).toBe('philipp-gl bet 5 on Turn left');
  });

  test('with no trade the quiet line is the commentary, never both', async () => {
    vi.mocked(api.getLiveState).mockImplementation(async () => {
      const s = h.state();
      s.recentTrades = [];
      return s as never;
    });
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector('.snake-quiet')).toBeTruthy());
    expect(container.querySelectorAll('.snake-quiet')).toHaveLength(1);
    expect(container.querySelector('.snake-quiet')?.textContent).toBe('The market leans left.');
  });
});

describe('the poll', () => {
  test('reads /live every 2 seconds while visible, and stops when the tab is hidden', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector('svg.snake-board')).toBeTruthy());
    expect(api.getLiveState).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_050);
    });
    expect(api.getLiveState).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(api.getLiveState).toHaveBeenCalledTimes(3);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(api.getLiveState).toHaveBeenCalledTimes(3);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_050);
    });
    expect(api.getLiveState).toHaveBeenCalledTimes(5);
  });

  test('unmounting stops the poll', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container, unmount } = renderLive();
    await waitFor(() => expect(container.querySelector('svg.snake-board')).toBeTruthy());
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(api.getLiveState).toHaveBeenCalledTimes(1);
  });
});

describe('the replay', () => {
  test('the game picker lists the games newest first', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector('select.snake-games')).toBeTruthy());
    // The placeholder ("Replay a game") is not a game.
    const opts = Array.from(container.querySelectorAll('select.snake-games option'))
      .filter(o => (o as HTMLOptionElement).value !== '')
      .map(o => o.textContent);
    expect(opts).toEqual(['Game 2 · 12x12 · best 4', 'Game 1 · 12x12 · best 9']);
  });

  test('the controls: scrubber, play, speed, Live; realtime is on until touched', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector('input.snake-scrub')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '1x' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Live' }).getAttribute('aria-pressed')).toBe('true');
  });

  test('dragging the scrubber loads the window around that step and draws that step', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector('select.snake-games')).toBeTruthy());
    fireEvent.change(container.querySelector('select.snake-games') as HTMLSelectElement, { target: { value: '1' } });
    const scrub = container.querySelector('input.snake-scrub') as HTMLInputElement;
    await waitFor(() => expect(scrub.getAttribute('max')).toBe('400'));
    // Picking the game opens at its start, which loads steps 0..299.
    await waitFor(() => expect(api.getLiveHistory).toHaveBeenCalledWith('snake', { game: 1, from: 0, limit: 300 }));
    fireEvent.change(scrub, { target: { value: '350' } });
    // 350 is outside that window: the window around it, 150 either side.
    await waitFor(() => expect(api.getLiveHistory).toHaveBeenCalledWith('snake', { game: 1, from: 200, limit: 300 }));
    // Step 350 in the fixture: head at (350 % 10 + 1, 2) = (1, 2), length 2 + 350 % 4 = 4.
    const cell = Number(container.querySelector('rect.snake-cell')?.getAttribute('width'));
    await waitFor(() => {
      const band = container.querySelector('.snake-snake') as SVGPolylineElement;
      expect((band.getAttribute('points') ?? '').trim().split(/\s+/)[0]).toBe(`${1.5 * cell},${2.5 * cell}`);
    });
    expect(container.querySelector('.snake-status')?.textContent).toBe('Length 4 · Game 1 · Step 350 · Continue');
    expect(screen.getByRole('button', { name: 'Live' }).getAttribute('aria-pressed')).toBe('false');
    // Realtime is off: no next-move clock while scrubbing history.
    expect(container.querySelector('.snake-next')).toBeNull();
  });

  test('a scrub past the loaded window fetches the next window', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector('select.snake-games')).toBeTruthy());
    fireEvent.change(container.querySelector('select.snake-games') as HTMLSelectElement, { target: { value: '1' } });
    const scrub = container.querySelector('input.snake-scrub') as HTMLInputElement;
    await waitFor(() => expect(scrub.getAttribute('max')).toBe('400'));
    fireEvent.change(scrub, { target: { value: '10' } });
    await waitFor(() => expect(api.getLiveHistory).toHaveBeenCalledWith('snake', { game: 1, from: 0, limit: 300 }));
    fireEvent.change(scrub, { target: { value: '380' } });
    await waitFor(() => expect(api.getLiveHistory).toHaveBeenCalledWith('snake', { game: 1, from: 230, limit: 300 }));
    await waitFor(() =>
      expect(container.querySelector('.snake-status')?.textContent).toBe('Length 2 · Game 1 · Step 380 · Continue'),
    );
  });

  test('play advances one step per second at 1x, ten at 10x, and pauses at the last step', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector('select.snake-games')).toBeTruthy());
    fireEvent.change(container.querySelector('select.snake-games') as HTMLSelectElement, { target: { value: '1' } });
    const scrub = container.querySelector('input.snake-scrub') as HTMLInputElement;
    await waitFor(() => expect(scrub.getAttribute('max')).toBe('400'));
    fireEvent.change(scrub, { target: { value: '390' } });
    await waitFor(() => expect(container.querySelector('.snake-status')?.textContent).toMatch(/Step 390/));
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_050);
    });
    expect(scrub.value).toBe('392');
    fireEvent.click(screen.getByRole('button', { name: '1x' }));
    expect(screen.getByRole('button', { name: '10x' })).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_050);
    });
    // 10x: ten steps a second, held at the last step (400) rather than past it.
    expect(scrub.value).toBe('400');
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
  });

  test('Live returns to realtime', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector('select.snake-games')).toBeTruthy());
    fireEvent.change(container.querySelector('select.snake-games') as HTMLSelectElement, { target: { value: '1' } });
    const scrub = container.querySelector('input.snake-scrub') as HTMLInputElement;
    await waitFor(() => expect(scrub.getAttribute('max')).toBe('400'));
    fireEvent.change(scrub, { target: { value: '20' } });
    await waitFor(() => expect(container.querySelector('.snake-next')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Live' }));
    await waitFor(() => expect(container.querySelector('.snake-next')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Live' }).getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.snake-status')?.textContent).toBe('Length 3 · Game 2 · 12x12');
  });
});
