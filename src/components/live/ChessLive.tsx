import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import type { FeedQuotes } from '../../lib/feed-overlay';
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
const TOP_ROWS = 12;
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
}
export interface ChessState {
  phase: 'our-move' | 'their-move' | 'settling' | 'seeking' | string;
  game: {
    number: number;
    id: string;
    url?: string;
    color: Color;
    opponent: { name: string; title?: string | null; rating?: number | null };
    fen: string | null;
    moves: string[];
    status?: string;
    result: number | null;
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

type Arrow = { option: string; from: string; to: string; opacity: number; href?: string; number?: number };

function Board({
  fen,
  color,
  last,
  arrows,
  targets,
  selected,
  onSquare,
  onPick,
}: {
  fen: string | null;
  color: Color;
  last: string | null;
  arrows: Arrow[];
  targets: string[];
  selected: string | null;
  onSquare: (square: string) => void;
  onPick?: (n: number, option?: string) => void;
}) {
  const pieces = useMemo(() => piecesOf(fen ?? START_FEN), [fen]);
  const squares = useMemo(() => {
    const out: string[] = [];
    for (let r = 8; r >= 1; r--) for (let f = 0; f < 8; f++) out.push(`${FILES[f]}${r}`);
    return out;
  }, []);
  const lastSquares = last ? [last.slice(0, 2), last.slice(2, 4)] : [];
  return (
    <svg className="chess-board" viewBox={`0 0 ${8 * S} ${8 * S}`} role="img" aria-label={`Chess board, ${color} at the bottom`}>
      <title>Chess board</title>
      {squares.map(sq => {
        const [x, y] = xy(sq, color);
        const light = (FILES.indexOf(sq[0]) + Number(sq[1])) % 2 === 1;
        const cls = [
          'chess-square',
          light ? 'is-light' : 'is-dark',
          lastSquares.includes(sq) ? 'is-last' : '',
          selected === sq ? 'is-selected' : '',
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
      {targets.map(sq => {
        const [cx, cy] = centre(sq, color);
        return <circle key={`t-${sq}`} className="chess-target" data-square={sq} cx={cx} cy={cy} r={S * 0.14} />;
      })}
      {FILES.split('').map((f, i) => (
        <text
          key={`f-${f}`}
          className="chess-coord"
          x={(color === 'white' ? i : 7 - i) * S + S - 4}
          y={8 * S - 5}
          textAnchor="end"
          fontSize={S * 0.17}
        >
          {f}
        </text>
      ))}
      {arrows.map(a => {
        const d = arrowPath(a.from, a.to, color);
        const mark = (
          <path
            className="chess-arrow"
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
            aria-label={`${a.option}: open its world on proposal #${a.number}`}
            onClick={e => {
              if (!onPick) return;
              e.preventDefault();
              onPick(a.number as number, a.option);
            }}
          >
            <path className="chess-arrow-hit" d={d} fill="none" stroke="transparent" strokeWidth={S * 0.5} strokeLinecap="round" />
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

export function ChessLive({
  slug,
  onPickProposal,
  onStep,
  onQuotes,
  replay: showReplay = true,
}: {
  slug: string;
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
  const [selected, setSelected] = useState<string | null>(null);
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;
  const onQuotesRef = useRef(onQuotes);
  onQuotesRef.current = onQuotes;
  const stepKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: number | null = null;
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
    const start = () => {
      if (timer === null) timer = window.setInterval(tick, POLL_MS);
    };
    const stop = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop();
      else {
        void tick();
        start();
      }
    };
    void tick();
    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
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
  const color: Color = game?.color === 'black' ? 'black' : 'white';

  /* A new position clears the piece a reader had picked up. */
  const openId = open?.proposal.id ?? null;
  useEffect(() => setSelected(null), [openId]);

  const replayRow = replay && replay.entry > 0 ? (plies[replay.game]?.[replay.entry - 1] ?? null) : null;
  const replayColor: Color = replay ? (games.find(g => g.number === replay.game)?.color ?? color) : color;

  const liveArrows = (): Arrow[] => {
    if (!open) return [];
    const top = ranked(open.options).filter(priced).slice(0, 3);
    const ops = leadOpacities(top.map(o => o.price));
    return top.map((o, i) => ({
      option: o.id,
      from: o.id.slice(0, 2),
      to: o.id.slice(2, 4),
      opacity: ops[i],
      number: open.proposal.number,
      href: `/${slug}/p/${open.proposal.number}?option=${o.id}`,
    }));
  };

  const drawn = replay
    ? {
        fen: replay.entry === 0 ? START_FEN : (replayRow?.fen ?? null),
        color: replayColor,
        last: replayRow?.uci ?? null,
        arrows:
          replayRow && replayRow.by === 'us'
            ? [{ option: replayRow.uci, from: replayRow.uci.slice(0, 2), to: replayRow.uci.slice(2, 4), opacity: 1 }]
            : [],
      }
    : {
        fen: game?.fen ?? START_FEN,
        color,
        last: game?.moves?.length ? game.moves[game.moves.length - 1] : null,
        arrows: liveArrows(),
      };

  const targets = open && selected ? [...new Set(open.options.filter(o => o.id.startsWith(selected)).map(o => o.id.slice(2, 4)))] : [];

  const pick = (option: string) => {
    if (!open) return;
    onPickProposal?.(open.proposal.number, option);
  };

  const onSquare = (sq: string) => {
    if (!open) {
      setSelected(null);
      return;
    }
    if (selected && targets.includes(sq)) {
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
          ? `chosen at ${replayRow.price.toFixed(1)}`
          : 'chosen at random';
      line = {
        text: replayRow.by === 'us' ? `Move ${n}: ${replayRow.san}, ${chosen}` : `Move ${n}: they played ${replayRow.san}`,
        cls: 'is-replay',
      };
    }
  } else if (!state) {
    line = { text: failed ? 'Feed unavailable' : 'Loading', cls: 'is-idle' };
  } else if (open) {
    const leader = leaderOf(open.options);
    const seconds = (Date.parse(open.deadline) - now) / 1000;
    const head = leader ? `Next move: ${leader.san}` : 'Next move';
    line = seconds < 1 ? { text: `${head}, deciding`, cls: 'is-decided' } : { text: `${head} in `, clock: clock(seconds), cls: 'is-open' };
  } else if (state.phase === 'their-move' && game) {
    const d = state.recentDecisions?.[0];
    const played =
      d && d.game === game.number ? `, played ${d.san}${typeof d.price === 'number' ? ` at ${d.price.toFixed(1)}` : ''}` : '';
    line = { text: `Their move${played}`, cls: 'is-default' };
  } else if (state.phase === 'settling') {
    line = { text: 'Settling the game', cls: 'is-idle' };
  } else {
    line = { text: 'Waiting for the next game', cls: 'is-idle' };
  }

  /* The moves, highest price first. */
  const list = open ? ranked(open.options) : [];
  const leader = open ? leaderOf(open.options) : null;
  const pricedList = list.filter(priced);
  const lo = pricedList.length ? Math.min(...pricedList.map(o => o.price as number)) : 0;
  const hi = pricedList.length ? Math.max(...pricedList.map(o => o.price as number)) : 0;
  const pieces = piecesOf(open ? (game?.fen ?? null) : null);
  const glyphOf = (o: ChessOption) => {
    const p = pieces.get(o.id.slice(0, 2));
    return p ? `${GLYPH[p.toLowerCase()]}︎` : '';
  };
  const hrefOf = (o: ChessOption) => (open ? `/${slug}/p/${open.proposal.number}?option=${o.id}` : '#');
  const onRow = (o: ChessOption) => (e: React.MouseEvent) => {
    if (!onPickProposal) return;
    e.preventDefault();
    pick(o.id);
  };

  const scrubGame = replay?.game ?? games[0]?.number;
  const scrubTotal = scrubGame === undefined ? undefined : plies[scrubGame]?.length;
  const scrubMax = scrubTotal ?? 0;
  const scrubValue = replay ? Math.min(replay.entry, scrubMax) : scrubMax;

  return (
    <div className="chess-live">
      <div className="chess-main">
        <div className="chess-board-col">
          <div className="chess-board-box">
            <Board
              fen={drawn.fen}
              color={drawn.color}
              last={drawn.last}
              arrows={drawn.arrows}
              targets={targets}
              selected={selected}
              onSquare={onSquare}
              onPick={onPickProposal}
            />
          </div>
          <p className={`chess-next ${line.cls}`}>
            {line.text}
            {line.clock !== undefined && <span className="chess-clock">{line.clock}</span>}
          </p>
        </div>
        {open && list.length > 0 && (
          <div className="chess-moves">
            <div className="chess-moves-cap">
              <span>{`${list.length} moves, highest price first`}</span>
              <span>Price</span>
            </div>
            {list.slice(0, TOP_ROWS).map((o, i) => {
              const isLeader = leader?.id === o.id;
              const width = priced(o) && hi > lo ? 8 + 92 * ((o.price - lo) / (hi - lo)) : priced(o) ? 100 : 0;
              return (
                <a
                  key={o.id}
                  className={`chess-move-row${isLeader ? ' is-leader' : ''}`}
                  href={hrefOf(o)}
                  onClick={onRow(o)}
                >
                  <span className="chess-move-rank">{i + 1}</span>
                  <span className="chess-move-san">
                    <span className="chess-move-glyph">{glyphOf(o)}</span>
                    {o.san}
                    {isLeader ? ' · leads' : ''}
                  </span>
                  <span className="chess-move-bar">
                    <span style={{ width: `${width}%` }} />
                  </span>
                  <span className="chess-move-price">{priced(o) ? o.price.toFixed(1) : 'open'}</span>
                </a>
              );
            })}
            {list.length > TOP_ROWS && (
              <>
                <div className="chess-moves-cap is-rest">
                  <span>{`The other ${list.length - TOP_ROWS}`}</span>
                </div>
                <div className="chess-move-grid">
                  {list.slice(TOP_ROWS).map(o => (
                    <a key={o.id} className="chess-move-cell" href={hrefOf(o)} onClick={onRow(o)}>
                      <span>{o.san}</span>
                      <span className="chess-move-price">{priced(o) ? o.price.toFixed(1) : 'open'}</span>
                    </a>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
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
