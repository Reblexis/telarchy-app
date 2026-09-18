import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Every internal link is base-aware (docs/ui-conventions.md): on the /beta
 * build a move's link must stay on /beta. Found beside the 2026-09-17 persona
 * run's "Back does not return to the floor": the address read /chess/p/6957
 * before it read /beta/chess/p/6957.
 */
vi.mock('../../../lib/base-path', () => ({ BASE_PATH: '/beta', withBase: (p: string) => `/beta${p}` }));

// After 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.c3 Nf6 5.d4 exd4, white to move.

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
const { api } = await import('../../../lib/api');

const arrows = (c: HTMLElement) => [...c.querySelectorAll('.chess-arrow')] as SVGElement[];

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

describe('a chess move link on the /beta build', () => {
  test('an arrow links inside /beta', async () => {
    const { container } = renderLive({ onPickProposal: vi.fn() });
    await waitFor(() => expect(arrows(container).length).toBe(3));
    const arrow = arrows(container)[0].closest('a') as Element;
    expect(arrow.getAttribute('href')).toMatch(/^\/beta\/chess\/p\/412\?option=/);
  });
});
