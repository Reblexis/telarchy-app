import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { withBase } from '../../lib/base-path';
import type { FeedQuotes } from '../../lib/feed-overlay';
import { startVisiblePoll } from '../../lib/visible-poll';
import { leadOpacities } from './SnakeLive';

/**
 * The chess feed, drawn natively on the floor (docs/ui-conventions.md, "The
 * chess feed"): the board from TelarchyBot's side with the last move tinted,
 * arrows for the three highest prices, a move made on the board opening its
 * option, one next-move line, the moves ranked by price, and the snake's
 * replay row over the plies.
 *
 * Realtime polls GET /api/marketplace/:slug/live every 2 seconds while the
 * tab is visible; a read that fails leaves the last board drawn. The board
 * is read from the FEN and the legal moves from the proposal's options, so
 * no chess library ships to the browser.
 */

const POLL_MS = 2_000;
const S = 60;
const FILES = 'abcdefgh';

type Color = 'white' | 'black';
export interface ChessOption {
  id: string;
  san: string;
  price: number | null;
  lead: number | null;
  marketId?: string | null;
  reason?: string;
}
export interface ChessDecision {
  game: number;
  move: number;
  chosen: string;
  san: string;
  price: number | null;
  kind: string;
  /** When the move was played (ISO): the moment the feed's clocks were last true. */
  at?: string;
}
export interface ChessState {
  /** The floor's rule in one sentence (telarchy-chess docs/chess.md, "The feed"). */
  rule?: string | null;
  phase: 'our-move' | 'their-move' | 'settling' | 'seeking' | string;
  game: {
    number: number;
    id: string;
    url?: string;
    color: Color;
    opponent: { name: string; title?: string | null; rating?: number | null };
    fen: string | null;
    moves: string[];
    /** Milliseconds on each clock at the feed's read. */
    clocks?: { white: number; black: number };
    status?: string;
    result: number | null;
  } | null;
  /** The account as Lichess last reported it (docs/ui-conventions.md, "The chess feed", the player's record). */
  player?: {
    username: string;
    url?: string;
    rating: number;
    provisional: boolean;
    games?: { played: number; won: number; lost: number; drawn: number };
  } | null;
  open: {
    move: number;
    proposal: { id: string; number: number; url: string };
    deadline: string;
    tradeable?: boolean;
    options: ChessOption[];
  } | null;
  recentDecisions?: ChessDecision[];
}
export interface ChessGame {
  number: number;
  id: string;
  color: Color;
  opponent: { name: string };
  result: number | null;
  plies: number;
}
export interface ChessPly {
  ply: number;
  by: 'us' | 'them';
  uci: string;
  san: string;
  fen: string;
  kind?: string;
  price?: number | null;
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const GLYPH: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

/** The pieces of a FEN by square name ("e1" -> "K"). */
export function piecesOf(fen: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  const rows = (fen ?? '').split(' ')[0]?.split('/') ?? [];
  if (rows.length !== 8) return out;
  rows.forEach((row, i) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += Number(ch);
      else {
        if (f < 8) out.set(`${FILES[f]}${8 - i}`, ch);
        f++;
      }
    }
  });
  return out;
}

const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const priced = (o: { price: number | null | undefined }): o is { price: number } =>
  typeof o.price === 'number' && Number.isFinite(o.price);

/** Highest price first, an unpriced option last, ties by id so the order holds between reads. */
function ranked(options: ChessOption[]): ChessOption[] {
  return [...options].sort((a, b) => {
    const pa = priced(a) ? a.price : -Infinity;
    const pb = priced(b) ? b.price : -Infinity;
    if (pa !== pb) return pb - pa;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** The unique priced option with the strictly highest price, or null on a tie or with none priced. */
function leaderOf(options: ChessOption[]): ChessOption | null {
  const r = ranked(options).filter(priced);
  if (r.length === 0) return null;
  if (r.length > 1 && Math.abs((r[0].price as number) - (r[1].price as number)) <= 1e-9) return null;
  return r[0];
}

function xy(square: string, color: Color): [number, number] {
  const f = FILES.indexOf(square[0]);
  const r = Number(square[1]);
  return color === 'white' ? [f * S, (8 - r) * S] : [(7 - f) * S, (r - 1) * S];
}
const centre = (square: string, color: Color): [number, number] => {
  const [x, y] = xy(square, color);
  return [x + S / 2, y + S / 2];
};

/** A shaft from the move's square to just short of its target and a head at the end. */
function arrowPath(from: string, to: string, color: Color): string {
  const [x1, y1] = centre(from, color);
  const [x2, y2] = centre(to, color);
  const d = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / d;
  const uy = (y2 - y1) / d;
  const tx = x2 - ux * S * 0.18;
  const ty = y2 - uy * S * 0.18;
  const a = S * 0.2;
  const n = (v: number) => Number(v.toFixed(2));
  return [
    `M ${n(x1 + ux * S * 0.22)} ${n(y1 + uy * S * 0.22)} L ${n(tx)} ${n(ty)}`,
    `M ${n(tx - ux * a - uy * a * 0.7)} ${n(ty - uy * a + ux * a * 0.7)}`,
    `L ${n(tx)} ${n(ty)}`,
    `L ${n(tx - ux * a + uy * a * 0.7)} ${n(ty - uy * a - ux * a * 0.7)}`,
  ].join(' ');
}

/** The arrow's pressable stroke: as wide as half a square, starting far enough past its own
 *  square's edge that even its rounded cap stays off that square, so the piece under the tail
 *  can always be picked up (docs/ui-conventions.md, "The chess feed"). */
const HIT_WIDTH = S * 0.5;
function hitPath(from: string, to: string, color: Color): string {
  const [x1, y1] = centre(from, color);
  const [x2, y2] = centre(to, color);
  const d = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / d;
  const uy = (y2 - y1) / d;
  const start = Math.min(S / 2 + HIT_WIDTH / 2 + 1, d - S * 0.18);
  const n = (v: number) => Number(v.toFixed(2));
  return `M ${n(x1 + ux * start)} ${n(y1 + uy * start)} L ${n(x2 - ux * S * 0.18)} ${n(y2 - uy * S * 0.18)}`;
}

type Arrow = {
  option: string;
  from: string;
  to: string;
  opacity: number;
  href?: string;
  number?: number;
  /** The proposal on screen's move (docs/ui-conventions.md, "The chess feed", item 3). */
  selected?: boolean;
};

function Board({
  fen,
  color,
  last,
  prior,
  proposalMove,
  arrows,
  targets,
  selected,
  hoverPiece,
  onSquare,
  onSquareHover,
  onPick,
}: {
  fen: string | null;
  color: Color;
  last: string | null;
  /** The move before the last: tinted fainter, because a reply and our move often land in one read. */
  prior?: string | null;
  /** The proposal on screen's move when it is the open move: its squares tinted. */
  proposalMove: string | null;
  arrows: Arrow[];
  targets: Array<{ square: string; text: string; leader: boolean }>;
  selected: string | null;
  /** A piece that can move, under the pointer while nothing is picked up: its square tinted. */
  hoverPiece: string | null;
  onSquare: (square: string) => void;
  /** The pointer entered a square (null: it left the board's squares). */
  onSquareHover: (square: string | null) => void;
  onPick?: (n: number, option?: string) => void;
}) {
  const pieces = useMemo(() => piecesOf(fen ?? START_FEN), [fen]);
  const squares = useMemo(() => {
    const out: string[] = [];
    for (let r = 8; r >= 1; r--) for (let f = 0; f < 8; f++) out.push(`${FILES[f]}${r}`);
    return out;
  }, []);
  const lastSquares = last ? [last.slice(0, 2), last.slice(2, 4)] : [];
  const priorSquares = prior ? [prior.slice(0, 2), prior.slice(2, 4)] : [];
  const squaresOf = (m: string | null) => (m ? [m.slice(0, 2), m.slice(2, 4)] : []);
  const proposalSquares = squaresOf(proposalMove);
  return (
    <svg
      className="chess-board"
      viewBox={`0 0 ${8 * S} ${8 * S}`}
      role="img"
      aria-label={`Chess board, ${color} at the bottom`}
    >
      <title>Chess board</title>
      {squares.map(sq => {
        const [x, y] = xy(sq, color);
        const light = (FILES.indexOf(sq[0]) + Number(sq[1])) % 2 === 0; // a1 dark, h1 light
        const cls = [
          'chess-square',
          light ? 'is-light' : 'is-dark',
          lastSquares.includes(sq) ? 'is-last' : priorSquares.includes(sq) ? 'is-prior' : '',
          proposalSquares.includes(sq) ? 'is-proposal' : '',
          selected === sq ? 'is-selected' : '',
          hoverPiece === sq ? 'is-hover-piece' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <rect
            key={sq}
            className={cls}
            data-square={sq}
            data-piece={pieces.get(sq) ?? undefined}
            x={x}
            y={y}
            width={S}
            height={S}
            onClick={() => onSquare(sq)}
            onMouseEnter={() => onSquareHover(sq)}
            onMouseLeave={() => onSquareHover(null)}
          />
        );
      })}
      {[...pieces.entries()].map(([sq, p]) => {
        const [cx, cy] = centre(sq, color);
        const white = p === p.toUpperCase();
        return (
          <text
            key={`p-${sq}`}
            className={`chess-piece ${white ? 'is-white' : 'is-black'}`}
            x={cx}
            y={cy + S * 0.25}
            textAnchor="middle"
            fontSize={S * 0.74}
          >
            {`${GLYPH[p.toLowerCase()]}︎`}
          </text>
        );
      })}
      {targets.map(t => {
        const [cx, cy] = centre(t.square, color);
        return (
          <g key={`t-${t.square}`} className="chess-target-mark">
            <circle className="chess-target" data-square={t.square} cx={cx} cy={cy - S * 0.08} r={S * 0.12} />
            {/* The price is on the board (docs/ui-conventions.md, "The chess feed", item 3). */}
            <rect
              className={`chess-target-bg${t.leader ? ' is-leader' : ''}`}
              x={cx - S * 0.42}
              y={cy + S * 0.1}
              width={S * 0.84}
              height={S * 0.3}
              rx={S * 0.06}
            />
            <text
              className={`chess-target-price${t.leader ? ' is-leader' : ''}`}
              data-square={t.square}
              x={cx}
              y={cy + S * 0.32}
              textAnchor="middle"
              fontSize={S * 0.21}
            >
              {t.text}
            </text>
          </g>
        );
      })}
      {FILES.split('').map((f, i) => (
        <text
          key={`f-${f}`}
          className="chess-coord is-file"
          x={(color === 'white' ? i : 7 - i) * S + S - 4}
          y={8 * S - 5}
          textAnchor="end"
          fontSize={S * 0.2}
        >
          {f}
        </text>
      ))}
      {/* Ranks up the left edge, top to bottom as drawn, so the side the
          player has is readable without knowing the pieces (persona run
          2026-09-17). */}
      {[0, 1, 2, 3, 4, 5, 6, 7].map(row => {
        const rank = color === 'white' ? 8 - row : row + 1;
        return (
          <text key={`r-${rank}`} className="chess-coord is-rank" x={4} y={row * S + S * 0.24} fontSize={S * 0.2}>
            {rank}
          </text>
        );
      })}
      {arrows.map(a => {
        const d = arrowPath(a.from, a.to, color);
        const mark = (
          <path
            className={`chess-arrow${a.selected ? ' is-selected' : ''}`}
            data-option={a.option}
            d={d}
            fill="none"
            style={{ strokeOpacity: a.opacity }}
            strokeWidth={S * 0.1}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
        if (!a.href || a.number === undefined) return <g key={a.option}>{mark}</g>;
        return (
          <a
            key={a.option}
            className="chess-arrow-link"
            href={a.href}
            /* A piece is picked up: the square pressed next is the move, never an arrow. */
            style={selected !== null ? { pointerEvents: 'none' } : undefined}
            aria-label={`${a.option}: open its world on proposal #${a.number}`}
            onClick={e => {
              if (!onPick) return;
              e.preventDefault();
              onPick(a.number as number, a.option);
            }}
          >
            <path
              className="chess-arrow-hit"
              d={hitPath(a.from, a.to, color)}
              fill="none"
              stroke="transparent"
              strokeWidth={HIT_WIDTH}
              strokeLinecap="round"
            />
            {mark}
          </a>
        );
      })}
    </svg>
  );
}

type Replay = { game: number; entry: number };

function resultWord(g: ChessGame): string {
  if (g.result === 100) return 'won';
  if (g.result === 50) return 'drew';
  if (g.result === 0) return 'lost';
  return 'playing';
}

/** An option's price from the floor's one-second prices poll when that poll has
 *  its book, else the feed's (docs/ui-conventions.md, "A price on the live view
 *  is the book's own, read once a second"). */
function withBooks(
  options: ChessOption[],
  books: ReadonlyMap<string, { consensus: number | null }> | null | undefined,
): ChessOption[] {
  if (!books || books.size === 0) return options;
  return options.map(o => {
    const b = o.marketId ? books.get(o.marketId) : undefined;
    return b && typeof b.consensus === 'number' && Number.isFinite(b.consensus) ? { ...o, price: b.consensus } : o;
  });
}

export function ChessLive({
  slug,
  onPickProposal,
  onStep,
  onQuotes,
  books,
  selectedProposal,
  replay: showReplay = true,
  card = false,
}: {
  slug: string;
  /** The card form (docs/ui-conventions.md, "The chess feed"): no moves column, the board fills the host's height, the record one line under the next-move line. */
  card?: boolean;
  /** The proposal the page has open and the option on screen, for marking its move. */
  selectedProposal?: { number: number; option: string | null } | null;
  /** The floor's open books by market id, polled once a second. */
  books?: ReadonlyMap<string, { consensus: number | null }> | null;
  replay?: boolean;
  /** An arrow, a move on the board, or a row of the list: open that option's world. */
  onPickProposal?: (number: number, option?: string) => void;
  /** The open proposal changed, or closed: reported as soon as the poll reads it, never for the first read. */
  onStep?: (s: { step: number; decided: boolean }) => void;
  /** Every read: the open move's option prices by proposal id. */
  onQuotes?: (quotes: FeedQuotes) => void;
}) {
  const [state, setState] = useState<ChessState | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [selectionState, setSelectionState] = useState<{ id: string | null; square: string | null }>({
    id: null,
    square: null,
  });
  /* The square under the pointer on the board (docs/ui-conventions.md, "The chess feed", item 1). */
  const [squareHoverState, setSquareHoverState] = useState<{ id: string | null; square: string | null }>({
    id: null,
    square: null,
  });
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;
  const onQuotesRef = useRef(onQuotes);
  onQuotesRef.current = onQuotes;
  const stepKeyRef = useRef<string | null>(null);

  /* The feed read, every POLL_MS while the tab is visible and never while it is
     hidden (docs/ui-conventions.md, "A hidden tab asks for nothing"). */
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const s = (await api.getLiveState(slug)) as unknown as ChessState;
        if (stopped) return;
        setState(s);
        setFailed(false);
        const key = s.open?.proposal?.id ?? 'none';
        if (stepKeyRef.current !== null && key !== stepKeyRef.current) {
          onStepRef.current?.({ step: s.open?.proposal?.number ?? 0, decided: !s.open });
        }
        stepKeyRef.current = key;
        if (onQuotesRef.current && s.open?.proposal?.id) {
          const options: Record<string, { price: number | null; lead: number | null }> = {};
          for (const o of s.open.options ?? []) options[o.id] = { price: o.price ?? null, lead: o.lead ?? null };
          onQuotesRef.current({ [s.open.proposal.id]: { options } });
        }
      } catch {
        if (!stopped) setFailed(true);
      }
    };
    const stop = startVisiblePoll(tick, POLL_MS, { immediate: true });
    return () => {
      stopped = true;
      stop();
    };
  }, [slug]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, []);

  /* Replay: the games newest first, each game's plies once loaded. */
  const [games, setGames] = useState<ChessGame[]>([]);
  const [plies, setPlies] = useState<Record<number, ChessPly[]>>({});
  const [replay, setReplay] = useState<Replay | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 10>(1);
  const loadingRef = useRef<Set<number>>(new Set());

  const loadGame = useCallback(
    (game: number) => {
      if (loadingRef.current.has(game)) return;
      loadingRef.current.add(game);
      api
        .getLiveHistory(slug, { game })
        .then(h => {
          const list = ((h as unknown as { plies?: ChessPly[] }).plies ?? []) as ChessPly[];
          setPlies(p => ({ ...p, [game]: list }));
        })
        .catch(() => {
          /* A game that fails to load leaves the scrubber disabled. */
        })
        .finally(() => loadingRef.current.delete(game));
    },
    [slug],
  );

  useEffect(() => {
    let stopped = false;
    api
      .getLiveGames(slug)
      .then(r => {
        if (stopped) return;
        const sorted = [...((r as unknown as { games: ChessGame[] }).games ?? [])].sort((a, b) => b.number - a.number);
        setGames(sorted);
        if (sorted[0]) loadGame(sorted[0].number);
      })
      .catch(() => {
        /* No record yet: the replay row stays empty. */
      });
    return () => {
      stopped = true;
    };
  }, [slug, loadGame]);

  const goTo = useCallback(
    (game: number, entry: number) => {
      const total = plies[game]?.length;
      const e = Math.max(0, total === undefined ? entry : Math.min(entry, total));
      setReplay({ game, entry: e });
      setSelected(null);
      if (!plies[game]) loadGame(game);
    },
    [plies, loadGame],
  );

  useEffect(() => {
    if (!playing || !replay) return;
    const t = window.setInterval(() => {
      setReplay(cur => {
        if (!cur) return cur;
        const total = plies[cur.game]?.length;
        if (total === undefined) return cur;
        if (cur.entry >= total) {
          setPlaying(false);
          return cur;
        }
        return { game: cur.game, entry: cur.entry + 1 };
      });
    }, 1_000 / speed);
    return () => window.clearInterval(t);
  }, [playing, speed, replay, plies]);

  const goLive = () => {
    setPlaying(false);
    setReplay(null);
  };

  const game = state?.game ?? null;
  const open = !replay && state?.phase === 'our-move' ? (state?.open ?? null) : null;
  const openOptions = open ? withBooks(open.options, books) : [];
  const color: Color = game?.color === 'black' ? 'black' : 'white';

  /* A new position clears the piece a reader had picked up. */
  const openId = open?.proposal.id ?? null;
  /* A piece picked up belongs to the move it was made on: a new position
     clears it by construction, never by an effect that can
     land after a click. */
  const selected = selectionState.id !== null && selectionState.id === openId ? selectionState.square : null;
  const setSelected = (square: string | null) => setSelectionState({ id: openId, square });
  const hoveredSquare = squareHoverState.id !== null && squareHoverState.id === openId ? squareHoverState.square : null;

  const replayRow = replay && replay.entry > 0 ? (plies[replay.game]?.[replay.entry - 1] ?? null) : null;
  const replayColor: Color = replay ? (games.find(g => g.number === replay.game)?.color ?? color) : color;

  /* The proposal on screen is marked on the board when it is the open move
     (docs/ui-conventions.md, "The chess feed", item 3). */
  const proposalMove =
    open &&
    selectedProposal &&
    selectedProposal.number === open.proposal.number &&
    selectedProposal.option &&
    open.options.some(o => o.id === selectedProposal.option)
      ? selectedProposal.option
      : null;
  const liveArrows = (): Arrow[] => {
    if (!open) return [];
    const top = ranked(openOptions)
      .filter(priced)
      .slice(0, 3)
      .filter(o => o.id !== proposalMove);
    const ops = leadOpacities(top.map(o => o.price));
    const at = (id: string) => ({
      option: id,
      from: id.slice(0, 2),
      to: id.slice(2, 4),
      number: open.proposal.number,
      /* A raw anchor, so it carries the build's base itself (lib/base-path). */
      href: withBase(`/${slug}/p/${open.proposal.number}?option=${id}`),
    });
    const out: Arrow[] = top.map((o, i) => ({ ...at(o.id), opacity: ops[i] }));
    if (proposalMove) out.push({ ...at(proposalMove), opacity: 1, selected: true });
    return out;
  };

  const drawn = replay
    ? {
        fen: replay.entry === 0 ? START_FEN : (replayRow?.fen ?? null),
        color: replayColor,
        last: replayRow?.uci ?? null,
        prior: null as string | null,
        arrows:
          replayRow && replayRow.by === 'us'
            ? [{ option: replayRow.uci, from: replayRow.uci.slice(0, 2), to: replayRow.uci.slice(2, 4), opacity: 1 }]
            : [],
      }
    : {
        fen: game?.fen ?? START_FEN,
        color,
        last: game?.moves?.length ? game.moves[game.moves.length - 1] : null,
        prior: game?.moves && game.moves.length > 1 ? game.moves[game.moves.length - 2] : null,
        arrows: liveArrows(),
      };

  /* A hovered piece previews its moves only while nothing is picked up, and only if it can move. */
  const hoverPiece =
    !replay && open && !selected && hoveredSquare && open.options.some(o => o.id.startsWith(hoveredSquare))
      ? hoveredSquare
      : null;
  const shownFrom = selected ?? hoverPiece;
  const targetSquares =
    open && shownFrom
      ? [...new Set(open.options.filter(o => o.id.startsWith(shownFrom)).map(o => o.id.slice(2, 4)))]
      : [];
  const boardLeader = open ? leaderOf(openOptions) : null;
  const targets = targetSquares.map(square => {
    const candidates = openOptions.filter(o => shownFrom !== null && o.id.startsWith(`${shownFrom}${square}`));
    const move = candidates.find(o => o.id.endsWith('q')) ?? candidates[0];
    return {
      square,
      text: move && priced(move) ? move.price.toFixed(1) : 'open',
      leader: !!move && boardLeader?.id === move.id,
    };
  });

  /* A move made where no page handles the pick (the home card) goes to that
     option's address, as an arrow's link does (docs/ui-conventions.md, "The
     chess feed", item 3). */
  const navigate = useNavigate();
  /** An option's world on this floor, opened in place. */
  const optionHref = (id: string) => (open ? `/${slug}/p/${open.proposal.number}?option=${id}` : '');
  const pick = (option: string) => {
    if (!open) return;
    if (onPickProposal) onPickProposal(open.proposal.number, option);
    else navigate(optionHref(option));
  };

  const onSquare = (sq: string) => {
    if (!open) {
      setSelected(null);
      return;
    }
    if (selected && targetSquares.includes(sq)) {
      const candidates = open.options.filter(o => o.id.startsWith(`${selected}${sq}`));
      const chosen = candidates.find(o => o.id.endsWith('q')) ?? candidates[0];
      setSelected(null);
      if (chosen) pick(chosen.id);
      return;
    }
    if (sq !== selected && open.options.some(o => o.id.startsWith(sq))) {
      setSelected(sq);
      return;
    }
    setSelected(null);
  };

  /* The one line under the board. */
  let line: { text: string; clock?: string; cls: string };
  if (replay) {
    if (replay.entry === 0 || !replayRow) line = { text: 'Start position', cls: 'is-replay' };
    else {
      const n = Math.ceil(replayRow.ply / 2);
      const chosen =
        replayRow.kind === 'market' && typeof replayRow.price === 'number'
          ? `chosen at ${replayRow.price.toFixed(1)} of 100`
          : 'chosen at random';
      line = {
        text:
          replayRow.by === 'us' ? `Move ${n}: ${replayRow.san}, ${chosen}` : `Move ${n}: they played ${replayRow.san}`,
        cls: 'is-replay',
      };
    }
  } else if (!state) {
    line = { text: failed ? 'Feed unavailable' : 'Loading', cls: 'is-idle' };
  } else if (open) {
    const leader = leaderOf(openOptions);
    const seconds = (Date.parse(open.deadline) - now) / 1000;
    const head = leader ? `Next move: ${leader.san}` : 'Next move';
    line =
      seconds < 1
        ? { text: `${head}, deciding`, cls: 'is-decided' }
        : { text: `${head} in `, clock: clock(seconds), cls: 'is-open' };
  } else if (state.phase === 'their-move' && game) {
    /* Waiting for the opponent (docs/ui-conventions.md, "The chess feed", item
       2): who, the move of ours they are answering, and their clock ticking. */
    const d = state.recentDecisions?.[0];
    const opp = game.opponent;
    const who = `${opp?.name ?? 'the opponent'}${typeof opp?.rating === 'number' ? ` (${opp.rating})` : ''}`;
    const what = d && d.game === game.number ? `to reply to ${d.san}` : 'to move';
    const theirs: Color = game.color === 'white' ? 'black' : 'white';
    const ms = game.clocks?.[theirs];
    /* The feed's clocks change only when a move is made, so the count runs from
       the decision they were last true at, never from the read (which would
       snap it back every poll); with no such moment the clock stands still. */
    const since = d && d.game === game.number && d.at ? Date.parse(d.at) : Number.NaN;
    const spent = Number.isFinite(since) ? Math.max(0, now - since) / 1000 : 0;
    const left = typeof ms === 'number' && Number.isFinite(ms) ? ms / 1000 - spent : null;
    line =
      left === null
        ? { text: `Waiting for ${who} ${what}`, cls: 'is-default' }
        : { text: `Waiting for ${who} ${what} · `, clock: clock(Math.max(0, left)), cls: 'is-default' };
  } else if (state.phase === 'settling') {
    line = { text: 'Settling the game', cls: 'is-idle' };
  } else {
    line = { text: 'Waiting for the next game', cls: 'is-idle' };
  }

  /* Who is playing whom, always on screen (persona run 2026-09-17: a visitor
     could not tell the side or the opponent from the next-move line alone). */
  const playerName = state?.player?.username ?? 'TelarchyBot';
  const gameCaption = game
    ? `${playerName} plays ${game.color === 'black' ? 'Black' : 'White'} against ${game.opponent?.name ?? 'the opponent'}${
        typeof game.opponent?.rating === 'number' ? ` (${game.opponent.rating})` : ''
      }`
    : null;
  const replayGame = replay ? games.find(g => g.number === replay.game) : undefined;
  const replayChip = replay
    ? `Replay: game ${replay.game}${replayGame ? ` against ${replayGame.opponent?.name ?? 'the opponent'}, ${resultWord(replayGame)}` : ''}. Not live.`
    : null;
  /* A proposal that is not the open move belongs to a position the board no
     longer shows; the board says so instead of sitting under its heading. */
  const nowNote =
    !replay && selectedProposal && (!open || selectedProposal.number !== open.proposal.number)
      ? `The board shows the game as it stands now, not the position of proposal #${selectedProposal.number}.`
      : null;

  const scrubGame = replay?.game ?? games[0]?.number;
  const scrubTotal = scrubGame === undefined ? undefined : plies[scrubGame]?.length;
  const scrubMax = scrubTotal ?? 0;
  const scrubValue = replay ? Math.min(replay.entry, scrubMax) : scrubMax;

  /* The player's record (docs/ui-conventions.md, "The chess feed", item 2): label and value rows. */
  const record: [string, string | number][] = state?.player
    ? [
        ['Rating', `${state.player.rating}${state.player.provisional ? '?' : ''}`],
        ...(state.player.games
          ? ([
              ['Played', state.player.games.played],
              ['Won', state.player.games.won],
              ['Lost', state.player.games.lost],
              ['Drawn', state.player.games.drawn],
            ] as [string, number][])
          : []),
      ]
    : [];

  return (
    <div className={`chess-live${card ? ' chess-live--card' : ''}`}>
      <div className="chess-main">
        <div className="chess-board-col">
          {replayChip && <p className="chess-replay-chip">{replayChip}</p>}
          {gameCaption && !replay && <p className="chess-game">{gameCaption}</p>}
          {gameCaption && !replay && !card && (
            /* Who picks the moves, where the visitor is looking; the feed's own
               full rule is the tooltip. */
            <p className="chess-rule" title={typeof state?.rule === 'string' ? state.rule : undefined}>
              Traders price every legal move. The highest price is played.
            </p>
          )}
          <div className="chess-board-box">
            <Board
              fen={drawn.fen}
              color={drawn.color}
              last={drawn.last}
              prior={drawn.prior}
              proposalMove={replay ? null : proposalMove}
              arrows={drawn.arrows}
              targets={targets}
              selected={selected}
              hoverPiece={replay ? null : hoverPiece}
              onSquare={onSquare}
              onSquareHover={square => setSquareHoverState({ id: openId, square })}
              onPick={onPickProposal}
            />
          </div>
          {nowNote && <p className="chess-now-note">{nowNote}</p>}
          <p className={`chess-next ${line.cls}`}>
            {line.text}
            {line.clock !== undefined && <span className="chess-clock">{line.clock}</span>}
          </p>
          {open && openOptions.length > 0 && !replay && !card && (
            /* The scale the prices are on (docs/ui-conventions.md, "The chess feed"). */
            <p className="chess-scale">
              A move's price is the expected score if it is played: 0 loss, 50 draw, 100 win
            </p>
          )}
          {state?.player && (
            /* The record: one muted line under the next move, headed by whose it
               is on the floor (docs/ui-conventions.md, "The chess feed", item 2). */
            <p className="chess-stats chess-stats--line">
              {[
                ...(card ? [] : [`${playerName} on Lichess`]),
                ...record.map(([label, value]) => `${label} ${value}`),
              ].join(' · ')}
            </p>
          )}
        </div>
      </div>
      {showReplay && (
        <div className="snake-replay chess-replay" role="group" aria-label="Replay">
          <select
            className="snake-games chess-games"
            aria-label="Game"
            value={replay?.game ?? ''}
            onChange={e => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && e.target.value !== '') {
                setPlaying(false);
                goTo(n, 0);
              }
            }}
          >
            {replay === null && <option value="">Replay a game</option>}
            {games.map(g => (
              <option key={g.number} value={g.number}>
                {`Game ${g.number} · vs ${g.opponent?.name ?? '?'} · ${resultWord(g)}`}
              </option>
            ))}
          </select>
          <input
            className="snake-scrub chess-scrub"
            type="range"
            aria-label="Ply"
            min={0}
            max={scrubMax}
            value={scrubValue}
            disabled={scrubTotal === undefined}
            style={{ '--slider-pct': `${scrubMax ? (scrubValue / scrubMax) * 100 : 0}%` } as React.CSSProperties}
            onChange={e => {
              if (scrubGame === undefined) return;
              setPlaying(false);
              goTo(scrubGame, Number(e.target.value));
            }}
          />
          <button
            type="button"
            className="mchart-range snake-btn"
            disabled={scrubTotal === undefined}
            onClick={() => {
              if (!replay) {
                if (scrubGame === undefined) return;
                goTo(scrubGame, 0);
              }
              setPlaying(p => !p);
            }}
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" className="mchart-range snake-btn" onClick={() => setSpeed(s => (s === 1 ? 10 : 1))}>
            {`${speed}x`}
          </button>
          <button
            type="button"
            className={`mchart-range snake-btn chess-live-btn${replay === null ? ' is-active' : ''}`}
            aria-pressed={replay === null}
            onClick={goLive}
          >
            Live
          </button>
        </div>
      )}
    </div>
  );
}
