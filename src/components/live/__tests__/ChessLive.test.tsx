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
      ['a2a3', 'a3'],
      ['a2a4', 'a4'],
      ['b2b3', 'b3'],
      ['b2b4', 'b4'],
      ['g2g3', 'g3'],
      ['g2g4', 'g4'],
      ['h2h3', 'h3'],
      ['h2h4', 'h4'],
      ['b1a3', 'Na3'],
      ['b1d2', 'Nbd2'],
      ['c1d2', 'Bd2'],
      ['c1e3', 'Be3'],
      ['d1c2', 'Qc2'],
      ['d1b3', 'Qb3'],
      ['d1e2', 'Qe2'],
      ['c4b5', 'Bb5'],
      ['c4b3', 'Bb3'],
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
      {
        number: 2,
        id: 'g2',
        color: 'black',
        opponent: { name: 'OldBot', title: 'BOT', rating: 1900 },
        result: 0,
        plies: 21,
      },
      {
        number: 3,
        id: 'g3',
        color: 'white',
        opponent: { name: 'OppBot', title: 'BOT', rating: 2171 },
        result: null,
        plies: 10,
      },
    ],
  });
  const history = () => ({
    game: { number: 2 },
    plies: [
      {
        ply: 1,
        at: 't',
        by: 'them',
        uci: 'e2e4',
        san: 'e4',
        fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      },
      {
        ply: 2,
        at: 't',
        by: 'us',
        uci: 'e7e5',
        san: 'e5',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
        kind: 'market',
        price: 52.5,
        tied: 1,
      },
      {
        ply: 3,
        at: 't',
        by: 'them',
        uci: 'g1f3',
        san: 'Nf3',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2',
      },
      {
        ply: 4,
        at: 't',
        by: 'us',
        uci: 'a7a6',
        san: 'a6',
        fen: 'rnbqkbnr/1ppp1ppp/p7/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3',
        kind: 'undecided',
        price: null,
        tied: 0,
      },
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
const dots = (c: HTMLElement) =>
  [...c.querySelectorAll('.chess-target')].map(d => d.getAttribute('data-square')).sort();
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
    await waitFor(() => expect(nextLine(black.container)).toMatch(/^Waiting for /));
    expect(y(black.container, 'a1')).toBeLessThan(y(black.container, 'a8'));
    expect(Number(sq(black.container, 'h1').getAttribute('x'))).toBeLessThan(
      Number(sq(black.container, 'a1').getAttribute('x')),
    );
  });

  test('a1 is a dark square and h1 a light one, as on every chessboard', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelectorAll('.chess-square').length).toBe(64));
    const shade = (n: string) =>
      sq(container, n).classList.contains('is-dark')
        ? 'dark'
        : sq(container, n).classList.contains('is-light')
          ? 'light'
          : 'none';
    expect(shade('a1')).toBe('dark');
    expect(shade('h1')).toBe('light');
    expect(shade('a8')).toBe('light');
    expect(shade('h8')).toBe('dark');
    expect(shade('d4')).toBe('dark');
    expect(shade('e4')).toBe('light');
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
    await waitFor(() => expect(nextLine(idle.container)).toMatch(/^Waiting for /));
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

describe('hovering a piece shows its moves before any press', () => {
  const tinted = (c: HTMLElement, name: string) => sq(c, name).classList.contains('is-hover-piece');

  test('a piece that can move is tinted and its squares get their dots on hover, and both clear on leave', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(arrows(container).length).toBe(3));
    fireEvent.mouseEnter(sq(container, 'e1'));
    expect(tinted(container, 'e1')).toBe(true);
    expect(dots(container)).toEqual(['d2', 'e2', 'f1', 'g1']);
    fireEvent.mouseLeave(sq(container, 'e1'));
    expect(tinted(container, 'e1')).toBe(false);
    expect(dots(container)).toEqual([]);
  });

  test('hovering opens nothing: only a press on a target square does', async () => {
    const onPickProposal = vi.fn();
    const { container } = renderLive({ onPickProposal });
    await waitFor(() => expect(arrows(container).length).toBe(3));
    fireEvent.mouseEnter(sq(container, 'e1'));
    fireEvent.mouseEnter(sq(container, 'g1'));
    expect(onPickProposal).not.toHaveBeenCalled();
  });

  test('a piece that cannot move, an opponent piece, an empty square, and every piece with no open move show nothing', async () => {
    const { container, unmount } = renderLive();
    await waitFor(() => expect(arrows(container).length).toBe(3));
    for (const name of ['a1', 'e8', 'a6']) {
      fireEvent.mouseEnter(sq(container, name));
      expect(tinted(container, name)).toBe(false);
      expect(dots(container)).toEqual([]);
      fireEvent.mouseLeave(sq(container, name));
    }
    unmount();
    vi.mocked(api.getLiveState).mockImplementation(async () => h.state({ phase: 'their-move', open: null }) as never);
    const idle = renderLive();
    await waitFor(() => expect(nextLine(idle.container)).toMatch(/^Waiting for /));
    fireEvent.mouseEnter(sq(idle.container, 'e1'));
    expect(tinted(idle.container, 'e1')).toBe(false);
    expect(dots(idle.container)).toEqual([]);
  });

  test('while a piece is picked up, hovering another piece does not replace its moves', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(arrows(container).length).toBe(3));
    fireEvent.click(sq(container, 'e1'));
    fireEvent.mouseEnter(sq(container, 'd1'));
    expect(dots(container)).toEqual(['d2', 'e2', 'f1', 'g1']);
    expect(tinted(container, 'd1')).toBe(false);
  });
});

describe('an arrow never takes the click meant for the board', () => {
  // Reported on the beta, 2026-09-13: a real click on a piece under the leader's arrow tail could not reach the square.
  test("an arrow's pressable area starts outside the square it leaves", async () => {
    const { container } = renderLive();
    await waitFor(() => expect(arrows(container).length).toBe(3));
    const board = container.querySelector('.chess-board') as SVGSVGElement;
    const side = Number(board.getAttribute('viewBox')?.split(' ')[2]) / 8;
    for (const hit of [...container.querySelectorAll('.chess-arrow-hit')]) {
      const link = hit.closest('a') as Element;
      const from = (link.getAttribute('href')?.match(/option=([a-h][1-8])/) ?? [])[1] as string;
      const rect = sq(container, from);
      const cx = Number(rect.getAttribute('x')) + side / 2;
      const cy = Number(rect.getAttribute('y')) + side / 2;
      const m = /^M\s*([\d.]+)\s+([\d.]+)/.exec(hit.getAttribute('d') ?? '') as RegExpExecArray;
      const dist = Math.hypot(Number(m[1]) - cx, Number(m[2]) - cy);
      const halfWidth = Number(hit.getAttribute('stroke-width')) / 2;
      // The hit stroke's rounded cap reaches halfWidth behind its start: all of it outside the square's half side.
      expect(dist - halfWidth).toBeGreaterThanOrEqual(side / 2);
    }
  });

  test('while a piece is picked up the arrows take no clicks', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(arrows(container).length).toBe(3));
    for (const a of container.querySelectorAll('.chess-arrow-link'))
      expect((a as SVGElement).style.pointerEvents).not.toBe('none');
    fireEvent.click(sq(container, 'e1'));
    for (const a of container.querySelectorAll('.chess-arrow-link'))
      expect((a as SVGElement).style.pointerEvents).toBe('none');
    fireEvent.click(sq(container, 'e1'));
    for (const a of container.querySelectorAll('.chess-arrow-link'))
      expect((a as SVGElement).style.pointerEvents).not.toBe('none');
  });
});

describe('the proposal on screen is marked on the board', () => {
  const selectedArrows = (c: HTMLElement) => [...c.querySelectorAll('.chess-arrow.is-selected')] as SVGElement[];

  test("the open proposal's move on screen is a solid green arrow with its squares tinted, beside the three highest", async () => {
    const { container } = renderLive({ selectedProposal: { number: 412, option: 'f3g5' } });
    await waitFor(() => expect(selectedArrows(container)).toHaveLength(1));
    const mine = selectedArrows(container)[0];
    expect(mine.getAttribute('data-option')).toBe('f3g5');
    expect(opacityOf(mine)).toBe(1);
    expect(
      arrows(container)
        .filter(a => !a.classList.contains('is-selected'))
        .map(a => a.getAttribute('data-option'))
        .sort(),
    ).toEqual(['c3d4', 'e1g1', 'e4e5']);
    expect(sq(container, 'f3').classList.contains('is-proposal')).toBe(true);
    expect(sq(container, 'g5').classList.contains('is-proposal')).toBe(true);
    expect(sq(container, 'e1').classList.contains('is-proposal')).toBe(false);
  });

  test('a move already among the three highest is drawn once, as the selected one', async () => {
    const { container } = renderLive({ selectedProposal: { number: 412, option: 'e1g1' } });
    await waitFor(() => expect(selectedArrows(container)).toHaveLength(1));
    expect(arrows(container)).toHaveLength(3);
    expect(selectedArrows(container)[0].getAttribute('data-option')).toBe('e1g1');
  });

  test('a decided proposal, or one that is not the open move, marks nothing', async () => {
    const { container } = renderLive({ selectedProposal: { number: 400, option: 'e2e4' } });
    await waitFor(() => expect(arrows(container).length).toBe(3));
    expect(selectedArrows(container)).toHaveLength(0);
    expect(container.querySelectorAll('.chess-square.is-proposal')).toHaveLength(0);
  });

  test("on a decided proposal's page a move made on the board opens it on the newest open proposal", async () => {
    const onPickProposal = vi.fn();
    const { container } = renderLive({ onPickProposal, selectedProposal: { number: 400, option: 'e2e4' } });
    await waitFor(() => expect(arrows(container).length).toBe(3));
    fireEvent.click(sq(container, 'c3'));
    fireEvent.click(sq(container, 'd4'));
    expect(onPickProposal).toHaveBeenCalledWith(412, 'c3d4');
  });

  test("on the open proposal's page another move made on the board switches to that move", async () => {
    const onPickProposal = vi.fn();
    const { container } = renderLive({ onPickProposal, selectedProposal: { number: 412, option: 'e1g1' } });
    await waitFor(() => expect(selectedArrows(container)).toHaveLength(1));
    fireEvent.click(sq(container, 'f3'));
    fireEvent.click(sq(container, 'g5'));
    expect(onPickProposal).toHaveBeenCalledWith(412, 'f3g5');
  });

  test('LiveView hands the proposal on screen to the chess view', async () => {
    const { container } = render(
      <MemoryRouter>
        <LiveView kind="chess" slug="chess" selectedProposal={{ number: 412, option: 'f3g5' }} />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(container.querySelector('.chess-arrow.is-selected')?.getAttribute('data-option')).toBe('f3g5'),
    );
  });
});

describe('the moves, one slim column beside the board', () => {
  const rows = (c: HTMLElement) => [...c.querySelectorAll('.chess-moverow')] as HTMLElement[];

  test('every legal move in one column, highest price first, unpriced last as open, no second grid', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(rows(container)).toHaveLength(25));
    expect(container.querySelectorAll('.chess-movelist')).toHaveLength(1);
    expect(container.querySelector('.chess-move-grid, .chess-move-cell')).toBeNull();
    expect(rows(container)[0].textContent).toContain('O-O');
    expect(rows(container)[0].textContent).toContain('56.4');
    expect(rows(container)[0].classList.contains('is-leader')).toBe(true);
    expect(rows(container)[1].textContent).toContain('cxd4');
    expect(rows(container)[24].textContent).toContain('Rg1');
    expect(rows(container)[24].textContent).toContain('open');
  });

  test('hovering a row draws that move on the board, leaving clears it', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(rows(container)).toHaveLength(25));
    const ng5 = rows(container).find(r => r.textContent?.includes('Ng5')) as HTMLElement;
    fireEvent.mouseEnter(ng5);
    const hover = container.querySelector('.chess-arrow.is-hover');
    expect(hover?.getAttribute('data-option')).toBe('f3g5');
    expect(sq(container, 'f3').classList.contains('is-hover')).toBe(true);
    expect(sq(container, 'g5').classList.contains('is-hover')).toBe(true);
    fireEvent.mouseLeave(ng5);
    expect(container.querySelector('.chess-arrow.is-hover')).toBeNull();
  });

  test('focusing a row draws its move too', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(rows(container)).toHaveLength(25));
    fireEvent.focus(rows(container)[1]);
    expect(container.querySelector('.chess-arrow.is-hover')?.getAttribute('data-option')).toBe('c3d4');
  });

  test("pressing a row opens that option's world", async () => {
    const onPickProposal = vi.fn();
    const { container } = renderLive({ onPickProposal });
    await waitFor(() => expect(rows(container)).toHaveLength(25));
    fireEvent.click(rows(container).find(r => r.textContent?.includes('Ng5')) as HTMLElement);
    expect(onPickProposal).toHaveBeenCalledWith(412, 'f3g5');
  });

  test("the proposal on screen's row is marked", async () => {
    const { container } = renderLive({ selectedProposal: { number: 412, option: 'f3g5' } });
    await waitFor(() => expect(rows(container)).toHaveLength(25));
    const marked = rows(container).filter(r => r.classList.contains('is-selected'));
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toContain('Ng5');
  });

  test('no list while no move is open', async () => {
    vi.mocked(api.getLiveState).mockImplementation(async () => h.state({ phase: 'their-move', open: null }) as never);
    const { container } = renderLive();
    await waitFor(() => expect(nextLine(container)).toMatch(/^Waiting for /));
    expect(container.querySelector('.chess-movelist')).toBeNull();
  });

  test("a picked-up piece's squares carry their moves' prices, the leader's marked", async () => {
    const { container } = renderLive();
    await waitFor(() => expect(arrows(container).length).toBe(3));
    fireEvent.click(sq(container, 'e1'));
    const labels = Object.fromEntries(
      [...container.querySelectorAll('.chess-target-price')].map(t => [t.getAttribute('data-square'), t]),
    );
    expect(Object.keys(labels).sort()).toEqual(['d2', 'e2', 'f1', 'g1']);
    expect(labels.g1.textContent).toBe('56.4');
    expect(labels.g1.classList.contains('is-leader')).toBe(true);
    expect(labels.f1.textContent).toBe('41.3');
  });

  test('an unpriced move reads open on its square', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(arrows(container).length).toBe(3));
    fireEvent.click(sq(container, 'h1'));
    expect(container.querySelector('.chess-target-price[data-square="g1"]')?.textContent).toBe('open');
  });
});

describe("a price on the live view is the book's own, read once a second", () => {
  const book = (marketId: string, consensus: number) => ({
    marketId,
    consensus,
    probability: null,
    pool: 0,
    tradeCount: 1,
  });

  test('the floor prices replace the feed prices: the leader, its arrow, its square price and the next-move line follow them', async () => {
    const books = new Map([['m-c3d4', book('m-c3d4', 70)]]);
    const { container } = renderLive({ books });
    await waitFor(() => expect(nextLine(container)).toMatch(/^Next move: cxd4 in /));
    const by = Object.fromEntries(arrows(container).map(a => [a.getAttribute('data-option'), a]));
    expect(opacityOf(by.c3d4)).toBeCloseTo(0.9, 5);
    fireEvent.click(sq(container, 'c3'));
    expect(container.querySelector('.chess-target-price[data-square="d4"]')?.textContent).toBe('70.0');
  });

  test('a new price moves the board at once, without waiting for the next feed read', async () => {
    const { container, rerender } = render(
      <MemoryRouter>
        <ChessLive slug="chess" books={new Map()} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(nextLine(container)).toMatch(/^Next move: O-O in /));
    const reads = vi.mocked(api.getLiveState).mock.calls.length;
    rerender(
      <MemoryRouter>
        <ChessLive slug="chess" books={new Map([['m-e4e5', book('m-e4e5', 80)]])} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(nextLine(container)).toMatch(/^Next move: e5 in /));
    expect(vi.mocked(api.getLiveState).mock.calls.length).toBe(reads);
  });

  test('LiveView hands the floor prices to the chess view', async () => {
    const { container } = render(
      <MemoryRouter>
        <LiveView kind="chess" slug="chess" books={new Map([['m-f3g5', book('m-f3g5', 90)]])} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(nextLine(container)).toMatch(/^Next move: Ng5 in /));
  });
});

describe('the next move and the floor', () => {
  test('counts down to the deadline with the leader named', async () => {
    const { container } = renderLive();
    await waitFor(() => expect(nextLine(container)).toMatch(/^Next move: O-O in 0:(2|3)\d$/));
  });

  test('waiting for the opponent names them, the move they are answering, and their clock', async () => {
    vi.mocked(api.getLiveState).mockImplementation(
      async () =>
        h.state({
          phase: 'their-move',
          open: null,
          recentDecisions: [{ game: 3, move: 6, chosen: 'e1g1', san: 'O-O', price: 56.4, kind: 'market' }],
        }) as never,
    );
    const { container } = renderLive();
    // TelarchyBot plays white here, so the opponent's clock is black's: 1,700,000 ms is 28:20.
    await waitFor(() =>
      expect(nextLine(container)).toMatch(/^Waiting for OppBot \(2171\) to reply to O-O · 28:(20|19)$/),
    );
    expect(container.querySelector('.chess-next .chess-clock')?.textContent).toMatch(/^28:(20|19)$/);
  });

  test('their clock counts down between feed reads', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(api.getLiveState).mockImplementation(async () => h.state({ phase: 'their-move', open: null }) as never);
    const { container } = renderLive();
    await waitFor(() =>
      expect(container.querySelector('.chess-next .chess-clock')?.textContent).toMatch(/^28:(20|19)$/),
    );
    // Hold the feed where it is so only the page's own clock moves.
    vi.mocked(api.getLiveState).mockImplementation(() => new Promise(() => {}) as never);
    await vi.advanceTimersByTimeAsync(5_000);
    await waitFor(() => expect(container.querySelector('.chess-next .chess-clock')?.textContent).toMatch(/^28:1[45]$/));
  });

  test('before TelarchyBot has moved in this game the line says the opponent is to move', async () => {
    vi.mocked(api.getLiveState).mockImplementation(
      async () =>
        h.state({
          phase: 'their-move',
          open: null,
          recentDecisions: [{ game: 2, move: 30, chosen: 'h7h6', san: 'h6', price: 12, kind: 'market' }],
        }) as never,
    );
    const { container } = renderLive();
    await waitFor(() => expect(nextLine(container)).toMatch(/^Waiting for OppBot \(2171\) to move · 28:(20|19)$/));
  });

  test('an opponent with no rating is named without one', async () => {
    vi.mocked(api.getLiveState).mockImplementation(async () => {
      const s = h.state({ phase: 'their-move', open: null });
      (s.game as Record<string, unknown>).opponent = { name: 'Anon', title: null, rating: null };
      return s as never;
    });
    const { container } = renderLive();
    await waitFor(() => expect(nextLine(container)).toMatch(/^Waiting for Anon to move · /));
  });

  test("the player's record: rating, played, won, lost and drawn, from the feed's player", async () => {
    vi.mocked(api.getLiveState).mockImplementation(
      async () =>
        h.state({
          player: {
            username: 'TelarchyBot',
            url: 'https://lichess.org/@/TelarchyBot',
            rating: 1720,
            provisional: false,
            games: { played: 12, won: 3, lost: 8, drawn: 1 },
          },
        }) as never,
    );
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector('.chess-stats')).toBeTruthy());
    const text = (container.querySelector('.chess-stats')?.textContent ?? '').replace(/\s+/g, ' ').trim();
    expect(text).toBe('Rating 1720 Played 12 Won 3 Lost 8 Drawn 1');
    const stats = container.querySelector('[role="region"][aria-label="Player statistics"]');
    expect(stats).toBeTruthy();
    expect(stats?.querySelectorAll('dt')).toHaveLength(5);
    expect(stats?.querySelectorAll('dd')).toHaveLength(5);
  });

  test('a provisional rating carries a question mark', async () => {
    vi.mocked(api.getLiveState).mockImplementation(
      async () =>
        h.state({
          player: {
            username: 'TelarchyBot',
            rating: 2300,
            provisional: true,
            games: { played: 1, won: 0, lost: 1, drawn: 0 },
          },
        }) as never,
    );
    const { container } = renderLive();
    await waitFor(() => expect(container.querySelector('.chess-stats')?.textContent).toContain('Rating 2300?'));
  });

  test("no record while the feed's player is null", async () => {
    vi.mocked(api.getLiveState).mockImplementation(async () => h.state({ player: null }) as never);
    const { container } = renderLive();
    await waitFor(() => expect(arrows(container).length).toBe(3));
    expect(container.querySelector('.chess-stats')).toBeNull();
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
