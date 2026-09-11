import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * A move transitions, it does not snap, and the grid never blanks
 * (docs/ui-conventions.md, "The live view is a segment of the chart slot",
 * item 1, 2026-09-11). What this pins: on the live floor the board jumped
 * a whole cell between two polls and the arrow flipped, so the one moment
 * the page exists for was invisible.
 */

const h = vi.hoisted(() => {
  const state = {
    snake: [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
    ],
    decided: false,
    seconds: 31,
    fail: false,
    hang: false,
  };
  const live = () => ({
    game: {
      snake: state.snake,
      food: { x: 8, y: 2 },
      heading: 'right',
      length: state.snake.length,
      step: 41,
      deaths: 0,
      complete: false,
      size: 12,
      gameNumber: 2,
    },
    grid: 12,
    gameNumber: 2,
    next: { action: 'forward', direction: 'right', decided: state.decided, seconds: state.seconds },
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
        forward: { m60: { approved: 7.2, declined: 6.0 } },
        left: { m60: { approved: 8.9, declined: 6.0 } },
        right: { m60: { approved: 5.1, declined: 6.0 } },
      },
    },
    recentDecisions: [],
    complete: false,
    nextGameAt: null,
  });
  return { state, live };
});

vi.mock('../../../lib/api', () => ({
  api: {
    getLiveState: vi.fn(async () => {
      if (h.state.hang) await new Promise(() => {});
      if (h.state.fail) throw new Error('feed down');
      return h.live();
    }),
    getLiveGames: vi.fn(async () => ({ games: [] })),
    getLiveHistory: vi.fn(async () => ({ game: { number: 1, size: 12 }, total: 0, from: 0, steps: [] })),
  },
}));

const { SnakeLive } = await import('../SnakeLive');

function board() {
  return render(
    <MemoryRouter>
      <SnakeLive slug="snake" />
    </MemoryRouter>,
  );
}

/** The band's first point, in drawing units: "M 132,132 L 108,132". */
function headPoint(container: HTMLElement): string {
  const d = container.querySelector('.snake-snake')?.getAttribute('d') ?? '';
  return d.trim().split(/[ML]/).filter(Boolean)[0]?.trim() ?? '';
}

/** Let the mounted poll's promise land (fake timers do not flush it). */
async function settle(ms = 0) {
  await act(async () => {
    if (ms) await vi.advanceTimersByTimeAsync(ms);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  h.state.snake = [
    { x: 5, y: 5 },
    { x: 4, y: 5 },
  ];
  h.state.decided = false;
  h.state.seconds = 31;
  h.state.fail = false;
  h.state.hang = false;
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('a move transitions, it does not snap', () => {
  test('the band is one path that keeps its node and changes its d, on a board that declares motion', async () => {
    const { container } = board();
    await settle(10);
    expect(container.querySelector('.snake-snake')).toBeTruthy();
    const band = container.querySelector('.snake-snake') as SVGPathElement;
    // A path, because `d` is what a CSS transition can interpolate; a
    // polyline's `points` cannot be transitioned at all.
    expect(band.tagName.toLowerCase()).toBe('path');
    const before = headPoint(container);
    expect(container.querySelector('.snake-board')?.getAttribute('data-motion')).toBe('animate');
    // The head carries its own transform, so it slides with the band.
    const head = container.querySelector('.snake-head-mark') as SVGGElement;
    expect(head.getAttribute('style') ?? '').toMatch(/translate/);
    // The move.
    h.state.snake = [
      { x: 6, y: 5 },
      { x: 5, y: 5 },
    ];
    await settle(2100);
    expect(headPoint(container)).not.toBe(before);
    // The SAME element moved: an element React replaced would restart at
    // its new place with nothing to transition from.
    expect(container.querySelector('.snake-snake')).toBe(band);
    expect(container.querySelector('.snake-head-mark')).toBe(head);
  });

  test('a reader who asks for less motion gets none', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q.includes('prefers-reduced-motion'),
      media: q,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    try {
      const { container } = board();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(container.querySelector('.snake-snake')).toBeTruthy();
      expect(container.querySelector('.snake-board')?.getAttribute('data-motion')).toBe('reduce');
    } finally {
      window.matchMedia = original;
    }
  });

  test('the arrow fades between its states instead of being replaced', async () => {
    const { container } = board();
    await settle(10);
    expect(container.querySelector('.snake-arrow[data-action="forward"]')).toBeTruthy();
    const arrow = container.querySelector('.snake-arrow[data-action="forward"]') as SVGElement;
    const line = container.querySelector('.snake-next') as HTMLElement;
    expect(arrow.classList.contains('is-open')).toBe(true);
    h.state.decided = true;
    await settle(2100);
    expect(container.querySelector('.snake-arrow.is-decided')).toBeTruthy();
    // The same chevron, now solid: its opacity is a transition, not a swap.
    expect(container.querySelector('.snake-arrow[data-action="forward"]')).toBe(arrow);
    expect(arrow.style.strokeOpacity).toBe('1');
    // And the next-move line changed state where it stood.
    expect(container.querySelector('.snake-next')).toBe(line);
    expect(line.textContent).toMatch(/decided/);
  });
});

describe('a countdown that runs out says what is happening', () => {
  test('at zero the line says it is deciding instead of sitting on 0:00', async () => {
    // The ruling lands a moment after the countdown ends and the next step
    // opens a moment after that: on the live floor the line sat on "in 0:00"
    // for ten seconds, the one transition the page exists to show.
    h.state.seconds = 0;
    const { container } = board();
    await settle(10);
    const line = container.querySelector('.snake-next') as HTMLElement;
    expect(line.textContent).toMatch(/Next move: continue forward, deciding/);
    expect(line.textContent).not.toMatch(/0:00/);
  });

  test('a second left still counts', async () => {
    h.state.seconds = 1;
    const { container } = board();
    await settle(10);
    expect((container.querySelector('.snake-next') as HTMLElement).textContent).toMatch(/in 0:01/);
  });
});

describe('the grid keeps the last state while a poll is in flight', () => {
  test('a poll that never answers leaves the board exactly as it was', async () => {
    const { container } = board();
    await settle(10);
    expect(container.querySelector('.snake-snake')).toBeTruthy();
    const before = headPoint(container);
    h.state.hang = true;
    await settle(6000);
    expect(container.querySelector('.snake-snake')).toBeTruthy();
    expect(headPoint(container)).toBe(before);
  });

  test('a poll that fails leaves the board and says so on the line, not by blanking', async () => {
    const { container } = board();
    await settle(10);
    expect(container.querySelector('.snake-snake')).toBeTruthy();
    const before = headPoint(container);
    h.state.fail = true;
    await settle(6000);
    expect(headPoint(container)).toBe(before);
    expect(container.querySelector('.snake-board')).toBeTruthy();
  });
});

describe('the transition is in the stylesheet, not in a timer', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const css = readFileSync(join(here, '..', '..', '..', 'style.css'), 'utf8');
  const rule = (selector: string) => {
    const at = css.indexOf(selector);
    return at === -1 ? '' : css.slice(at, css.indexOf('}', at));
  };

  test('the band transitions its d, the head its transform, the chevron its shading', () => {
    expect(rule("[data-motion='animate'] .snake-snake")).toMatch(/transition:[^;]*\bd\b/);
    expect(rule("[data-motion='animate'] .snake-head-mark")).toMatch(/transition:[^;]*transform/);
    expect(rule("[data-motion='animate'] .snake-arrow")).toMatch(/transition:[^;]*stroke-opacity/);
  });

  test('every one of them hangs off the board saying it may animate', () => {
    // The board says `reduce` for a reader who asked for less motion, and
    // then no rule matches: the state change is instant.
    for (const sel of ['.snake-snake', '.snake-head-mark', '.snake-arrow']) {
      const at = css.indexOf(`[data-motion='animate'] ${sel}`);
      expect(at).toBeGreaterThan(-1);
    }
  });
});
