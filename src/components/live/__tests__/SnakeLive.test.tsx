import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The snake feed, drawn natively (docs/ui-conventions.md, "The live view is
 * a segment of the chart slot", "The snake feed"): the grid from `grid`,
 * one next-move line, the 2-second poll while visible, and the replay
 * under it, which indexes ENTRIES of the recording, not moves.
 *
 * The fixture is shaped like production on 2026-09-11: game 1 is partial,
 * 38 recorded entries for steps 202..239 while /games says `steps: 239`;
 * game 2 is a complete game with 401 entries for steps 0..400.
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
        startedAt: '2026-09-11T10:38:30Z',
        endedAt: null,
        steps: 239,
        bestLength: 3,
        deaths: 39,
        partial: true,
      },
      {
        number: 2,
        size: 12,
        startedAt: '2026-09-10T10:00:00Z',
        endedAt: '2026-09-10T18:00:00Z',
        steps: 400,
        bestLength: 9,
        deaths: 3,
      },
    ],
  });
  /** Entry i of game g records step FIRST[g] + i; the head sits at (step % 10 + 1, 2). */
  const FIRST: Record<number, number> = { 1: 202, 2: 0 };
  const TOTAL: Record<number, number> = { 1: 38, 2: 401 };
  const history = (game: number, from: number, limit: number) => {
    const total = TOTAL[game];
    const steps = [];
    for (let i = from; i < Math.min(total, from + limit); i++) {
      const step = FIRST[game] + i;
      steps.push({
        step,
        at: '2026-09-10T10:00:00Z',
        snake: [
          { x: (step % 10) + 1, y: 2 },
          { x: step % 10, y: 2 },
        ],
        food: { x: 9, y: 9 },
        heading: 'right',
        action: i === 0 ? null : step % 3 === 0 ? 'right' : 'forward',
        direction: 'right',
        undecided: step === 203,
        impact: { forward: 1, left: 0, right: -1 },
        length: 2 + (step % 4),
        deaths: 0,
      });
    }
    return {
      game: { number: game, size: 12, startedAt: '2026-09-10T10:00:00Z', endedAt: null, partial: game === 1 },
      total,
      from,
      steps,
    };
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

/** The head's cell centre, in cell units, from the drawn band. */
function headCell(container: HTMLElement): [number, number] {
  const cell = Number(container.querySelector('rect.snake-cell')?.getAttribute('width'));
  const band = container.querySelector('.snake-snake') as SVGPolylineElement | null;
  if (!band) return [Number.NaN, Number.NaN];
  const [x, y] = (band.getAttribute('points') ?? '').trim().split(/\s+/)[0].split(',').map(Number);
  return [x / cell, y / cell];
}

async function pickGame(container: HTMLElement, n: number) {
  await waitFor(() => expect(container.querySelector(`select.snake-games option[value="${n}"]`)).toBeTruthy());
  fireEvent.change(container.querySelector('select.snake-games') as HTMLSelectElement, {
    target: { value: String(n) },
  });
}

function scrub(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input.snake-scrub') as HTMLInputElement;
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

  test('the snake is one rounded band along its cells, head first, with the head marked on the moving side', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector('.snake-snake')).toBeTruthy());
    const band = container.querySelector('.snake-snake') as SVGPolylineElement;
    expect(band.getAttribute('stroke-linecap')).toBe('round');
    expect(band.getAttribute('stroke-linejoin')).toBe('round');
    expect((band.getAttribute('points') ?? '').trim().split(/\s+/)).toHaveLength(3);
    expect(headCell(container)).toEqual([5.5, 5.5]);
    const cell = Number(container.querySelector('rect.snake-cell')?.getAttribute('width'));
    const head = container.querySelector('circle.snake-head') as SVGCircleElement;
    expect(Number(head.getAttribute('cx'))).toBeCloseTo(5.5 * cell);
    const eyes = Array.from(container.querySelectorAll('circle.snake-eye'));
    expect(eyes).toHaveLength(2);
    // Heading right: both eyes sit right of the head's centre.
    for (const e of eyes) expect(Number(e.getAttribute('cx'))).toBeGreaterThan(5.5 * cell);
  });

  test('the food is a round dot in its cell', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector('circle.snake-food')).toBeTruthy());
    const cell = Number(container.querySelector('rect.snake-cell')?.getAttribute('width'));
    const food = container.querySelector('circle.snake-food') as SVGCircleElement;
    expect(Number(food.getAttribute('cx'))).toBeCloseTo(8.5 * cell);
    expect(Number(food.getAttribute('cy'))).toBeCloseTo(2.5 * cell);
  });
});

describe('THE LIVE SEGMENT SHOWS ONLY THE GRID AND THE NEXT MOVE', () => {
  test('the segment is the board and one next-move line; no tiles, impacts, status, quiet line, links or buttons', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector('.snake-next')).toBeTruthy());
    const main = container.querySelector('.snake-main') as HTMLElement;
    expect(main.querySelector('svg.snake-board')).toBeTruthy();
    expect(main.querySelectorAll('p')).toHaveLength(1);
    expect(main.querySelector('.snake-next')).toBeTruthy();
    expect(container.querySelector('.snake-tiles')).toBeNull();
    expect(container.querySelector('.snake-tile')).toBeNull();
    expect(container.querySelector('.snake-status')).toBeNull();
    expect(container.querySelector('.snake-quiet')).toBeNull();
    expect(main.querySelectorAll('a, button')).toHaveLength(0);
    // The impacts, the trade and the commentary are not printed anywhere.
    expect(main.textContent).not.toMatch(/\+1\.2|\+2\.9|-0\.9|philipp-gl|leans left|Length|Game 2|12x12/);
  });

  test("the next move is the leader's action in words with the countdown while the step is open", async () => {
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector('.snake-next')).toBeTruthy());
    expect(container.querySelector('.snake-next')?.textContent).toBe('Next move: turn left in 0:31');
    expect(container.querySelector('.snake-clock')?.textContent).toBe('0:31');
    expect(container.querySelector('.snake-next.is-decided')).toBeNull();
  });

  test('once decided the line reads "decided" until the move', async () => {
    vi.mocked(api.getLiveState).mockImplementation(async () => {
      const s = h.state();
      s.next = { action: 'forward', direction: 'right', decided: true, seconds: 0 };
      return s as never;
    });
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector('.snake-next.is-decided')).toBeTruthy());
    expect(container.querySelector('.snake-next')?.textContent).toBe('Next move: continue forward, decided');
  });

  test('while nothing is readable the line is "continue forward (default)"', async () => {
    vi.mocked(api.getLiveState).mockImplementation(async () => {
      const s = h.state();
      (s as { next: unknown }).next = null;
      return s as never;
    });
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector('.snake-next')).toBeTruthy());
    expect(container.querySelector('.snake-next')?.textContent).toBe('Next move: continue forward (default)');
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

  test('the impacts still reach the drawing so showing them is a one-line change', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector('.snake-next')).toBeTruthy());
    const main = container.querySelector('.snake-main') as HTMLElement;
    // approved minus declined on m60: 7.2-6.0, 8.9-6.0, 5.1-6.0, carried as data, not text.
    expect(main.getAttribute('data-impacts')).toBe('1.2,2.9,-0.9');
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
    await waitFor(() => expect(container.querySelectorAll('select.snake-games option').length).toBeGreaterThan(1));
    const opts = Array.from(container.querySelectorAll('select.snake-games option'))
      .filter(o => (o as HTMLOptionElement).value !== '')
      .map(o => o.textContent);
    expect(opts).toEqual(['Game 2 · 12x12 · best 9', 'Game 1 · 12x12 · best 3']);
  });

  test('the controls: scrubber, play, speed, Live; realtime is on until touched', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector('input.snake-scrub')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '1x' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Live' }).getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.snake-next')?.textContent).toBe('Next move: turn left in 0:31');
  });

  test("the newest game's first window is fetched with the games list and the scrubber rests at its end", async () => {
    const { container } = renderLive();
    await waitFor(() => expect(api.getLiveHistory).toHaveBeenCalledWith('snake', { game: 2, from: 0, limit: 300 }));
    await waitFor(() => expect(scrub(container).disabled).toBe(false));
    expect(scrub(container).getAttribute('max')).toBe('400');
    expect(scrub(container).value).toBe('400');
  });

  test('REPLAY DRAWS THE ENTRY THE SCRUBBER NAMES', async () => {
    const { container } = renderLive();
    await pickGame(container, 1);
    await waitFor(() => expect(api.getLiveHistory).toHaveBeenCalledWith('snake', { game: 1, from: 0, limit: 300 }));
    await waitFor(() => expect(scrub(container).getAttribute('max')).toBe('37'));
    fireEvent.change(scrub(container), { target: { value: '5' } });
    // Entry 5 of the partial game is step 207: head at (207 % 10 + 1, 2) = (8, 2).
    await waitFor(() => expect(headCell(container)).toEqual([8.5, 2.5]));
    expect(scrub(container).value).toBe('5');
    // 207 % 3 === 0: the market turned right on that step.
    expect(container.querySelector('.snake-next')?.textContent).toBe('Step 207: turned right');
    expect(screen.getByRole('button', { name: 'Live' }).getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('.snake-clock')).toBeNull();
  });

  test('REPLAY OF A PARTIAL GAME MAPS ENTRIES TO STEPS', async () => {
    const { container } = renderLive();
    await pickGame(container, 1);
    // The scrubber spans the 38 recorded entries, never the game's 239 moves.
    await waitFor(() => expect(scrub(container).getAttribute('max')).toBe('37'));
    expect(scrub(container).value).toBe('0');
    // Entry 0 is step 202, the start of the recording, drawn at (202 % 10 + 1, 2) = (3, 2).
    await waitFor(() => expect(headCell(container)).toEqual([3.5, 2.5]));
    expect(container.querySelector('.snake-next')?.textContent).toBe('Step 202: start');
    fireEvent.change(scrub(container), { target: { value: '1' } });
    await waitFor(() =>
      expect(container.querySelector('.snake-next')?.textContent).toBe('Step 203: continued forward (default)'),
    );
    fireEvent.change(scrub(container), { target: { value: '37' } });
    await waitFor(() => expect(headCell(container)).toEqual([10.5, 2.5]));
    expect(container.querySelector('.snake-next')?.textContent).toBe('Step 239: continued forward');
    // A value past the recording is held at the last entry.
    fireEvent.change(scrub(container), { target: { value: '200' } });
    await waitFor(() => expect(scrub(container).value).toBe('37'));
    // No window was asked for at a move number.
    for (const call of vi.mocked(api.getLiveHistory).mock.calls) expect(call[1].from).toBeLessThan(38);
  });

  test('a scrub past the loaded window fetches the window around that entry', async () => {
    const { container } = renderLive();
    await pickGame(container, 2);
    await waitFor(() => expect(scrub(container).getAttribute('max')).toBe('400'));
    await waitFor(() => expect(api.getLiveHistory).toHaveBeenCalledWith('snake', { game: 2, from: 0, limit: 300 }));
    fireEvent.change(scrub(container), { target: { value: '350' } });
    // 350 is outside that window: the window around it, 150 either side.
    await waitFor(() => expect(api.getLiveHistory).toHaveBeenCalledWith('snake', { game: 2, from: 200, limit: 300 }));
    // Entry 350 of game 2 is step 350: head at (1, 2).
    await waitFor(() => expect(headCell(container)).toEqual([1.5, 2.5]));
    expect(container.querySelector('.snake-next')?.textContent).toBe('Step 350: continued forward');
  });

  test("switching game reloads: the other game's first window, its own range, its first entry", async () => {
    const { container } = renderLive();
    await pickGame(container, 2);
    await waitFor(() => expect(scrub(container).getAttribute('max')).toBe('400'));
    fireEvent.change(scrub(container), { target: { value: '30' } });
    await waitFor(() => expect(headCell(container)).toEqual([1.5, 2.5]));
    await pickGame(container, 1);
    await waitFor(() => expect(api.getLiveHistory).toHaveBeenCalledWith('snake', { game: 1, from: 0, limit: 300 }));
    await waitFor(() => expect(scrub(container).getAttribute('max')).toBe('37'));
    expect(scrub(container).value).toBe('0');
    await waitFor(() => expect(headCell(container)).toEqual([3.5, 2.5]));
    expect(container.querySelector('.snake-next')?.textContent).toBe('Step 202: start');
  });

  test('PLAY ADVANCES ONE ENTRY PER TICK AND HOLDS AT THE END', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container } = renderLive();
    await pickGame(container, 1);
    await waitFor(() => expect(scrub(container).getAttribute('max')).toBe('37'));
    fireEvent.change(scrub(container), { target: { value: '34' } });
    await waitFor(() => expect(container.querySelector('.snake-next')?.textContent).toMatch(/^Step 236/));
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_050);
    });
    expect(scrub(container).value).toBe('36');
    expect(headCell(container)).toEqual([9.5, 2.5]);
    expect(container.querySelector('.snake-next')?.textContent).toBe('Step 238: continued forward');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    // Held at the last entry (37, step 239), not past it, and play is over.
    expect(scrub(container).value).toBe('37');
    expect(headCell(container)).toEqual([10.5, 2.5]);
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
  });

  test('10x plays ten entries a second', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container } = renderLive();
    await pickGame(container, 2);
    await waitFor(() => expect(scrub(container).getAttribute('max')).toBe('400'));
    fireEvent.change(scrub(container), { target: { value: '100' } });
    await waitFor(() => expect(container.querySelector('.snake-next')?.textContent).toMatch(/^Step 100/));
    fireEvent.click(screen.getByRole('button', { name: '1x' }));
    expect(screen.getByRole('button', { name: '10x' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_050);
    });
    expect(scrub(container).value).toBe('110');
  });

  test('Play from realtime opens the newest game at its first entry', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container } = renderLive();
    await waitFor(() => expect(scrub(container).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    await waitFor(() => expect(container.querySelector('.snake-next')?.textContent).toBe('Step 0: start'));
    expect(scrub(container).value).toBe('0');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_050);
    });
    expect(scrub(container).value).toBe('1');
  });

  test('LIVE RETURNS TO POLLING', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container } = renderLive();
    await pickGame(container, 1);
    await waitFor(() => expect(scrub(container).getAttribute('max')).toBe('37'));
    fireEvent.change(scrub(container), { target: { value: '5' } });
    await waitFor(() => expect(headCell(container)).toEqual([8.5, 2.5]));
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    const polls = vi.mocked(api.getLiveState).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Live' }));
    // The polled state is drawn again, at once, with its next-move line.
    await waitFor(() =>
      expect(container.querySelector('.snake-next')?.textContent).toBe('Next move: turn left in 0:31'),
    );
    expect(headCell(container)).toEqual([5.5, 5.5]);
    expect(screen.getByRole('button', { name: 'Live' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
    // And the poll goes on: a fresh read within the next interval.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    expect(vi.mocked(api.getLiveState).mock.calls.length).toBeGreaterThan(polls);
  });
});
