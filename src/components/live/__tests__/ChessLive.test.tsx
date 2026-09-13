import { fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The chess feed on the floor (docs/ui-conventions.md, "The chess feed"):
 * the board from TelarchyBot's side with the last move tinted, arrows for
 * the three highest prices linking to their options, a move made on the
 * board opening its option, the next-move line, the ranked move list, and
 * the replay row over the plies.
 */

// After 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.c3 Nf6 5.d4 exd4, white to move.
const FEN = 'r1bqk2r/pppp1ppp/2n2n2/2b5/2BpP3/2P2N2/PP3PPP/RNBQK2R w KQkq - 0 6';
const MOVES = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'c2c3', 'g8f6', 'd2d4', 'e5d4'];

const h = vi.hoisted(() => {
  const opt = (id: string, san: string, price: number | null) => ({ id, san, price, lead: null, marketId: `m-${id}` });
  const options = () => {
    const priced: Array<[string, string, number | null]> = [
      ['e1g1', 'O-O', 56.4],
      ['c3d4', 'cxd4', 55.1],
      ['e4e5', 'e5', 53.8],
      ['f3g5', 'Ng5', 51.2],
      ['e1f1', 'Kf1', 41.3],
      ['e1e2', 'Ke2', 36.2],
      ['e1d2', 'Kd2', 34.0],
      ['h1g1', 'Rg1', null],
    ];
    const rest: Array<[string, string]> = [
      ['a2a3', 'a3'], ['a2a4', 'a4'], ['b2b3', 'b3'], ['b2b4', 'b4'], ['g2g3', 'g3'], ['g2g4', 'g4'],
      ['h2h3', 'h3'], ['h2h4', 'h4'], ['b1a3', 'Na3'], ['b1d2', 'Nbd2'], ['c1d2', 'Bd2'], ['c1e3', 'Be3'],
      ['d1c2', 'Qc2'], ['d1b3', 'Qb3'], ['d1e2', 'Qe2'], ['c4b5', 'Bb5'], ['c4b3', 'Bb3'],
    ];
    return [
      ...priced.map(([id, san, p]) => opt(id, san, p)),
      ...rest.map(([id, san], i) => opt(id, san, 42 + i * 0.1)),
    ].sort((a, b) => (a.id < b.id ? -1 : 1));
  };
  const state = (over: Record<string, unknown> = {}) => ({
    schema: 1,
    phase: 'our-move',
    player: { username: 'TelarchyBot', rating: 1500, provisional: true },
    game: {
      number: 3,
      id: 'g3',
      url: 'https://lichess.org/g3',
      color: 'white',
      opponent: { name: 'OppBot', title: 'BOT', rating: 2171 },
      fen: FEN_,
      moves: MOVES_,
      turn: 'white',
      clocks: { white: 1_500_000, black: 1_700_000 },
      status: 'started',
      result: null,
    },
    open: {
      move: 6,
      proposal: { id: 'p412', number: 412, url: 'https://telarchy.com/chess/p/412' },
      openedAt: '2026-09-13T18:00:00Z',
      decideAt: new Date(Date.now() + 29_000).toISOString(),
      deadline: new Date(Date.now() + 31_000).toISOString(),
      tradeable: true,
      options: options(),
    },
    recentDecisions: [],
    ...over,
  });
  // Hoisted: the constants are re-declared here because vi.hoisted runs first.
  const FEN_ = 'r1bqk2r/pppp1ppp/2n2n2/2b5/2BpP3/2P2N2/PP3PPP/RNBQK2R w KQkq - 0 6';
  const MOVES_ = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'c2c3', 'g8f6', 'd2d4', 'e5d4'];
  const games = () => ({
    games: [
      { number: 2, id: 'g2', color: 'black', opponent: { name: 'OldBot', title: 'BOT', rating: 1900 }, result: 0, plies: 21 },
      { number: 3, id: 'g3', color: 'white', opponent: { name: 'OppBot', title: 'BOT', rating: 2171 }, result: null, plies: 10 },
    ],
  });
  const history = () => ({
    game: { number: 2 },
    plies: [
      { ply: 1, at: 't', by: 'them', uci: 'e2e4', san: 'e4', fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1' },
      { ply: 2, at: 't', by: 'us', uci: 'e7e5', san: 'e5', fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', kind: 'market', price: 52.5, tied: 1 },
      { ply: 3, at: 't', by: 'them', uci: 'g1f3', san: 'Nf3', fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2' },
      { ply: 4, at: 't', by: 'us', uci: 'a7a6', san: 'a6', fen: 'rnbqkbnr/1ppp1ppp/p7/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3', kind: 'undecided', price: null, tied: 0 },
    ],
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

const { ChessLive } = await import('../ChessLive');
const { LiveView } = await import('../LiveView');
const { api } = await import('../../../lib/api');

const sq = (c: HTMLElement, name: string) => c.querySelector(`[data-square="${name}"]`) as SVGElement;
const arrows = (c: HTMLElement) => [...c.querySelectorAll('.chess-arrow')] as SVGElement[];
const opacityOf = (el: SVGElement) => Number(el.style.strokeOpacity || el.getAttribute('stroke-opacity'));
const dots = (c: HTMLElement) => [...c.querySelectorAll('.chess-target')].map(d => d.getAttribute('data-square')).sort();
const nextLine = (c: HTMLElement) => c.querySelector('.chess-next')?.textContent ?? '';

function renderLive(props: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter>
      <ChessLive slug="chess" {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(api.getLiveState).mockImplementation(async () => h.state() as never);
  vi.mocked(api.getLiveGames).mockImplementation(async () => h.games() as never);
  vi.mocked(api.getLiveHistory).mockImplementation(async () => h.history() as never);
});
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('the board', () => {
  test('draws 64 squares and the pieces of the position', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(sq(container, 'd4')?.getAttribute('data-piece')).toBe('p'));
    expect(container.querySelectorAll('.chess-square').length).toBe(64);
    expect(sq(container, 'e1').getAttribute('data-piece')).toBe('K');
    expect(sq(container, 'e8').getAttribute('data-piece')).toBe('k');
    expect(sq(container, 'd4').getAttribute('data-piece')).toBe('p');
    expect(sq(container, 'e5').getAttribute('data-piece')).toBeNull();
    expect(container.querySelectorAll('.chess-piece').length).toBe(31);
  });

  test("is seen from TelarchyBot's side: white at the bottom when it plays white, black when it plays black", async () => {
    const { container, unmount } = renderLive();
    await waitFor(() => expect(arrows(container).length).toBe(3));
    const y = (c: HTMLElement, n: string) => Number(sq(c, n).getAttribute('y'));
    expect(y(container, 'a1')).toBeGreaterThan(y(container, 'a8'));
    unmount();
    vi.mocked(api.getLiveState).mockImplementation(async () => {
      const s = h.state({ phase: 'their-move', open: null });
      (s.game as Record<string, unknown>).color = 'black';
      return s as never;
    });
    const black = renderLive();
    await waitFor(() => expect(nextLine(black.container)).toMatch(/^Their move/));
    expect(y(black.container, 'a1')).toBeLessThan(y(black.container, 'a8'));
    expect(Number(sq(black.container, 'h1').getAttribute('x'))).toBeLessThan(Number(sq(black.container, 'a1').getAttribute('x')));
  });

  test('the two squares of the last move are tinted', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(sq(container, 'e5')?.classList.contains('is-last')).toBe(true));
    expect(sq(container, 'd4').classList.contains('is-last')).toBe(true);
    expect(sq(container, 'e4').classList.contains('is-last')).toBe(false);
  });
});

describe('arrows for the three highest prices', () => {
  test('three arrows, leader brightest and the third faintest, each a link to its option', async () => {
    const onPickProposal = vi.fn();
    const { container } = renderLive({ onPickProposal });
    await waitFor(() => expect(arrows(container).length).toBe(3));
    const by = Object.fromEntries(arrows(container).map(a => [a.getAttribute('data-option'), a]));
    expect(Object.keys(by).sort()).toEqual(['c3d4', 'e1g1', 'e4e5']);
    expect(opacityOf(by.e1g1)).toBeCloseTo(0.9, 5);
    expect(opacityOf(by.e4e5)).toBeCloseTo(0.3, 5);
    expect(opacityOf(by.c3d4)).toBeGreaterThan(0.3);
    expect(by.e1g1.closest('a')?.getAttribute('href')).toBe('/chess/p/412?option=e1g1');
    fireEvent.click(by.c3d4.closest('a') as Element);
    expect(onPickProposal).toHaveBeenCalledWith(412, 'c3d4');
  });

  test('no open move, no arrows', async () => {
    vi.mocked(api.getLiveState).mockImplementation(async () => h.state({ phase: 'their-move', open: null }) as never);
    const { container } = renderLive();
    await waitFor(() => expect(sq(container, 'e1')).toBeTruthy());
    expect(arrows(container)).toHaveLength(0);
  });
});

describe('a move made on the board opens its option', () => {
  test('pressing a piece marks where it can go, pressing one of those squares opens that move', async () => {
    const onPickProposal = vi.fn();
    const { container } = renderLive({ onPickProposal });
    await waitFor(() => expect(arrows(container).length).toBe(3));
    fireEvent.click(sq(container, 'e1'));
    expect(dots(container)).toEqual(['d2', 'e2', 'f1', 'g1']);
    fireEvent.click(sq(container, 'g1'));
    expect(onPickProposal).toHaveBeenCalledWith(412, 'e1g1');
    expect(dots(container)).toEqual([]);
  });

  test('pressing a square that is not a target clears the selection and opens nothing', async () => {
    const onPickProposal = vi.fn();
    const { container } = renderLive({ onPickProposal });
    await waitFor(() => expect(arrows(container).length).toBe(3));
    fireEvent.click(sq(container, 'e1'));
    fireEvent.click(sq(container, 'a6'));
    expect(dots(container)).toEqual([]);
    expect(onPickProposal).not.toHaveBeenCalled();
  });

  test('a piece with no legal move, an opponent piece, and every piece with no open move do nothing', async () => {
    const onPickProposal = vi.fn();
    const { container, unmount } = renderLive({ onPickProposal });
    await waitFor(() => expect(arrows(container).length).toBe(3));
    fireEvent.click(sq(container, 'a1'));
    expect(dots(container)).toEqual([]);
    fireEvent.click(sq(container, 'e8'));
    expect(dots(container)).toEqual([]);
    unmount();
    vi.mocked(api.getLiveState).mockImplementation(async () => h.state({ phase: 'their-move', open: null }) as never);
    const idle = renderLive({ onPickProposal });
    await waitFor(() => expect(nextLine(idle.container)).toMatch(/^Their move/));
    fireEvent.click(sq(idle.container, 'e1'));
    expect(dots(idle.container)).toEqual([]);
    expect(onPickProposal).not.toHaveBeenCalled();
  });

  test('a promotion opens the queen', async () => {
    const onPickProposal = vi.fn();
    vi.mocked(api.getLiveState).mockImplementation(async () => {
      const s = h.state();
      (s.game as Record<string, unknown>).fen = '8/4P1k1/8/8/8/8/8/4K3 w - - 0 1';
      (s.game as Record<string, unknown>).moves = [];
      (s.open as Record<string, unknown>).options = [
        { id: 'e7e8b', san: 'e8=B', price: 60, lead: null, marketId: 'b' },
        { id: 'e7e8n', san: 'e8=N', price: 50, lead: null, marketId: 'n' },
        { id: 'e7e8q', san: 'e8=Q', price: 90, lead: null, marketId: 'q' },
        { id: 'e7e8r', san: 'e8=R', price: 80, lead: null, marketId: 'r' },
        { id: 'e1e2', san: 'Ke2', price: 40, lead: null, marketId: 'k' },
      ];
      return s as never;
    });
    const { container } = renderLive({ onPickProposal });
    await waitFor(() => expect(sq(container, 'e7')?.getAttribute('data-piece')).toBe('P'));
    fireEvent.click(sq(container, 'e7'));
    expect(dots(container)).toEqual(['e8']);
    fireEvent.click(sq(container, 'e8'));
    expect(onPickProposal).toHaveBeenCalledWith(412, 'e7e8q');
  });
});

describe('the moves, highest price first', () => {
  test('twelve rows by price, the leader marked, the rest in the compact grid, unpriced last as open', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelectorAll('.chess-move-row').length).toBe(12));
    const rows = [...container.querySelectorAll('.chess-move-row')];
    expect(rows[0].textContent).toContain('O-O');
    expect(rows[0].textContent).toContain('56.4');
    expect(rows[0].textContent).toContain('leads');
    expect(rows[0].classList.contains('is-leader')).toBe(true);
    expect(rows[1].textContent).toContain('cxd4');
    expect(container.querySelector('.chess-moves')?.textContent).toContain('25 moves, highest price first');
    const rest = [...container.querySelectorAll('.chess-move-cell')];
    expect(rest).toHaveLength(13);
    expect(container.querySelector('.chess-moves')?.textContent).toContain('The other 13');
    expect(rest[rest.length - 1].textContent).toContain('Rg1');
    expect(rest[rest.length - 1].textContent).toContain('open');
  });

  test('a row and a cell each open their option', async () => {
    const onPickProposal = vi.fn();
    const { container } = renderLive({ onPickProposal });
    await waitFor(() => expect(container.querySelectorAll('.chess-move-row').length).toBe(12));
    fireEvent.click(container.querySelectorAll('.chess-move-row')[1]);
    expect(onPickProposal).toHaveBeenLastCalledWith(412, 'c3d4');
    const cells = container.querySelectorAll('.chess-move-cell');
    fireEvent.click(cells[cells.length - 1]);
    expect(onPickProposal).toHaveBeenLastCalledWith(412, 'h1g1');
  });

  test('no list while no move is open', async () => {
    vi.mocked(api.getLiveState).mockImplementation(async () => h.state({ phase: 'their-move', open: null }) as never);
    const { container } = renderLive();
    await waitFor(() => expect(sq(container, 'e1')).toBeTruthy());
    expect(container.querySelector('.chess-moves')).toBeNull();
  });
});

describe('the next move and the floor', () => {
  test('counts down to the deadline with the leader named', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(nextLine(container)).toMatch(/^Next move: O-O in 0:(2|3)\d$/));
  });

  test('their move, with our last move of this game', async () => {
    vi.mocked(api.getLiveState).mockImplementation(
      async () =>
        h.state({
          phase: 'their-move',
          open: null,
          recentDecisions: [{ game: 3, move: 6, chosen: 'e1g1', san: 'O-O', price: 56.4, kind: 'market' }],
        }) as never,
    );
    const { container } = renderLive();
    await waitFor(() => expect(nextLine(container)).toBe('Their move, played O-O at 56.4'));
  });

  test('settling, waiting, loading and a failed feed each say so', async () => {
    vi.mocked(api.getLiveState).mockImplementation(async () => h.state({ phase: 'settling', open: null }) as never);
    const a = renderLive();
    await waitFor(() => expect(nextLine(a.container)).toBe('Settling the game'));
    a.unmount();
    vi.mocked(api.getLiveState).mockImplementation(async () => h.state({ phase: 'seeking', open: null }) as never);
    const b = renderLive();
    await waitFor(() => expect(nextLine(b.container)).toBe('Waiting for the next game'));
    b.unmount();
    vi.mocked(api.getLiveState).mockImplementation(() => new Promise(() => {}) as never);
    const c = renderLive();
    expect(nextLine(c.container)).toBe('Loading');
    c.unmount();
    vi.mocked(api.getLiveState).mockImplementation(async () => {
      throw new Error('502');
    });
    const d = renderLive();
    await waitFor(() => expect(nextLine(d.container)).toBe('Feed unavailable'));
  });

  test("every read reports the open move's option prices by proposal id", async () => {
    const onQuotes = vi.fn();
    renderLive({ onQuotes });
    await waitFor(() => expect(onQuotes).toHaveBeenCalled());
    const q = onQuotes.mock.calls.at(-1)?.[0] as Record<string, { options: Record<string, { price: number | null }> }>;
    expect(q.p412.options.e1g1).toEqual({ price: 56.4, lead: null });
    expect(Object.keys(q.p412.options)).toHaveLength(25);
  });

  test('a new open proposal, or none, is reported as a step; the first read is not', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onStep = vi.fn();
    let n = 0;
    vi.mocked(api.getLiveState).mockImplementation(async () => {
      n++;
      return (n === 1 ? h.state() : h.state({ phase: 'their-move', open: null })) as never;
    });
    renderLive({ onStep });
    await waitFor(() => expect(n).toBeGreaterThanOrEqual(1));
    expect(onStep).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_100);
    await waitFor(() => expect(onStep).toHaveBeenCalledTimes(1));
  });

  test('LiveView draws the chess feed for kind chess', async () => {
    const { container } = render(
      <MemoryRouter>
        <LiveView kind="chess" slug="chess" />
      </MemoryRouter>,
    );
    await waitFor(() => expect(container.querySelector('.chess-board')).toBeTruthy());
  });
});

describe('the replay', () => {
  test('lists the games newest first with their opponents and results', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelectorAll('.chess-games option').length).toBeGreaterThan(1));
    const labels = [...container.querySelectorAll('.chess-games option')].map(o => o.textContent);
    expect(labels).toContain('Game 3 · vs OppBot · playing');
    expect(labels).toContain('Game 2 · vs OldBot · lost');
    expect(labels.indexOf('Game 3 · vs OppBot · playing')).toBeLessThan(labels.indexOf('Game 2 · vs OldBot · lost'));
  });

  test('scrubbing a game draws that ply, says who played what, and Live returns', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelectorAll('.chess-games option').length).toBeGreaterThan(1));
    fireEvent.change(container.querySelector('.chess-games') as HTMLSelectElement, { target: { value: '2' } });
    await waitFor(() => expect(api.getLiveHistory).toHaveBeenCalledWith('chess', expect.objectContaining({ game: 2 })));
    const scrub = container.querySelector('.chess-scrub') as HTMLInputElement;
    await waitFor(() => expect(scrub.max).toBe('4'));
    fireEvent.change(scrub, { target: { value: '2' } });
    await waitFor(() => expect(nextLine(container)).toBe('Move 1: e5, chosen at 52.5'));
    expect(sq(container, 'e5').getAttribute('data-piece')).toBe('p');
    expect(sq(container, 'e5').classList.contains('is-last')).toBe(true);
    expect(arrows(container)).toHaveLength(1);
    expect(container.querySelector('.chess-moves')).toBeNull();
    fireEvent.change(scrub, { target: { value: '3' } });
    await waitFor(() => expect(nextLine(container)).toBe('Move 2: they played Nf3'));
    fireEvent.change(scrub, { target: { value: '4' } });
    await waitFor(() => expect(nextLine(container)).toBe('Move 2: a6, chosen at random'));
    fireEvent.click(container.querySelector('.chess-live-btn') as Element);
    await waitFor(() => expect(nextLine(container)).toMatch(/^Next move: O-O/));
  });
});

void FEN;
void MOVES;
