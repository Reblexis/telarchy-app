import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  type SnakeAction,
  type SnakeCell,
  type SnakeGame,
  type SnakeHeading,
  type SnakeHistoryStep,
  type SnakeState,
} from '../../lib/api';

/**
 * The snake feed, drawn natively on the floor (docs/ui-conventions.md, "The
 * live view is a segment of the chart slot", "The snake feed"): the grid
 * and one next-move line, nothing else; under it the replay: a game
 * picker, a scrubber, play, a speed, and LIVE.
 *
 * Realtime polls GET /api/marketplace/:slug/live every 2 seconds while the
 * tab is visible, and keeps polling during replay so LIVE is instant.
 * Replay indexes ENTRIES of the recording (/history's `total` and `from`),
 * never move numbers: a partial game's entry 0 is a step far above 0.
 * Windows of 300 entries are kept per game by entry index. No library: an
 * svg, a range input and a timer.
 */

const POLL_MS = 2_000;
const WINDOW = 300;
/** Drawing units per cell; the svg scales to its box. */
const CELL = 24;

const ACTIONS: SnakeAction[] = ['forward', 'left', 'right'];
/** The action in words, as the next-move line prints it. */
const ACTION_WORDS: Record<SnakeAction, string> = {
  forward: 'continue forward',
  left: 'turn left',
  right: 'turn right',
};
/** The action in the past, as the replay line prints it. */
const ACTION_PAST: Record<SnakeAction, string> = {
  forward: 'continued forward',
  left: 'turned left',
  right: 'turned right',
};

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** approved minus declined on the 60-move horizon, or null while unreadable. */
function impactOf(state: SnakeState, action: SnakeAction): number | null {
  const q = state.open?.quotes?.[action]?.m60;
  if (!q || typeof q.approved !== 'number' || typeof q.declined !== 'number') return null;
  return q.approved - q.declined;
}

/** The board: grid x grid cells on the chart area's ground with a hairline
 *  grid, the snake as one rounded band head first, the head a disc with
 *  two eyes on the moving side, the food a round dot. */
function Board({
  grid,
  snake,
  food,
  heading,
}: {
  grid: number;
  snake: SnakeCell[];
  food: SnakeCell | null;
  heading: SnakeHeading;
}) {
  const side = grid * CELL;
  const centre = (c: SnakeCell) => [(c.x + 0.5) * CELL, (c.y + 0.5) * CELL] as const;
  const cells = useMemo(() => {
    const out: Array<[number, number]> = [];
    for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) out.push([x, y]);
    return out;
  }, [grid]);
  const head = snake[0] ?? null;
  const [hx, hy] = head ? centre(head) : [0, 0];
  const off = CELL * 0.16;
  const sidew = CELL * 0.14;
  const eyes: Array<[number, number]> = !head
    ? []
    : heading === 'up'
      ? [
          [hx - sidew, hy - off],
          [hx + sidew, hy - off],
        ]
      : heading === 'down'
        ? [
            [hx - sidew, hy + off],
            [hx + sidew, hy + off],
          ]
        : heading === 'left'
          ? [
              [hx - off, hy - sidew],
              [hx - off, hy + sidew],
            ]
          : [
              [hx + off, hy - sidew],
              [hx + off, hy + sidew],
            ];
  return (
    <svg
      className="snake-board"
      viewBox={`0 0 ${side} ${side}`}
      role="img"
      aria-label={`Snake board, ${grid} by ${grid}`}
    >
      <title>Snake board</title>
      <rect className="snake-bg" x={0} y={0} width={side} height={side} />
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} className="snake-cell" x={x * CELL} y={y * CELL} width={CELL} height={CELL} />
      ))}
      {food && <circle className="snake-food" cx={centre(food)[0]} cy={centre(food)[1]} r={CELL * 0.3} />}
      {snake.length > 0 && (
        <polyline
          className="snake-snake"
          points={snake.map(c => centre(c).join(',')).join(' ')}
          fill="none"
          strokeWidth={CELL * 0.72}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {head && <circle className="snake-head" cx={hx} cy={hy} r={CELL * 0.36} />}
      {eyes.map(([ex, ey], i) => (
        <circle key={i} className="snake-eye" cx={ex} cy={ey} r={CELL * 0.07} />
      ))}
    </svg>
  );
}

/** A game and an ENTRY index into its recording (0-based, /history's `from`). */
type Replay = { game: number; entry: number };

/** The replay line for one recorded entry: the move the market took. */
function replayLine(row: SnakeHistoryStep): string {
  if (row.action === null) return `Step ${row.step}: start`;
  const past = ACTION_PAST[row.action] ?? row.action;
  return row.undecided ? `Step ${row.step}: ${past} (default)` : `Step ${row.step}: ${past}`;
}

export function SnakeLive({ slug }: { slug: string }) {
  const [state, setState] = useState<SnakeState | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [failed, setFailed] = useState(false);

  /* Realtime: one read now, then every 2 seconds while the tab is visible. */
  useEffect(() => {
    let stopped = false;
    let timer: number | null = null;
    const tick = async () => {
      try {
        const s = await api.getLiveState(slug);
        if (stopped) return;
        setState(s);
        setFetchedAt(Date.now());
        setFailed(false);
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

  /* The countdown ticks by the second between polls. */
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, []);

  /* Replay: the games newest first, a per-game cache of loaded entries by
     entry index, the recorded total per game, and the entry the scrubber
     sits on. Realtime while `replay` is null. */
  const [games, setGames] = useState<SnakeGame[]>([]);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 10>(1);
  const [totals, setTotals] = useState<Record<number, number>>({});
  const entriesRef = useRef<Map<number, Map<number, SnakeHistoryStep>>>(new Map());
  const loadingRef = useRef<Set<string>>(new Set());
  const [, setLoaded] = useState(0);

  const entryOf = useCallback((game: number, entry: number) => entriesRef.current.get(game)?.get(entry) ?? null, []);

  const loadWindow = useCallback(
    (game: number, from: number) => {
      const key = `${game}:${from}`;
      if (loadingRef.current.has(key)) return;
      loadingRef.current.add(key);
      api
        .getLiveHistory(slug, { game, from, limit: WINDOW })
        .then(h => {
          let map = entriesRef.current.get(game);
          if (!map) {
            map = new Map();
            entriesRef.current.set(game, map);
          }
          // Entries are kept by their index in the recording, `from + i`,
          // never by the move number they record.
          h.steps.forEach((s, i) => map.set(h.from + i, s));
          setTotals(t => (t[game] === h.total ? t : { ...t, [game]: h.total }));
          setLoaded(n => n + 1);
        })
        .catch(() => {
          /* A window that fails to load leaves the last drawn entry on screen. */
        })
        .finally(() => loadingRef.current.delete(key));
    },
    [slug],
  );

  /* The games list, and with it the newest game's first window, so the
     scrubber has a real range before anyone touches it. */
  useEffect(() => {
    let stopped = false;
    api
      .getLiveGames(slug)
      .then(r => {
        if (stopped) return;
        const sorted = [...r.games].sort((a, b) => b.number - a.number);
        setGames(sorted);
        if (sorted[0]) loadWindow(sorted[0].number, 0);
      })
      .catch(() => {
        /* No record yet: the replay row stays empty. */
      });
    return () => {
      stopped = true;
    };
  }, [slug, loadWindow]);

  /** The entry's row, fetching the window around it when it is not loaded. */
  const ensureLoaded = useCallback(
    (game: number, entry: number) => {
      if (entryOf(game, entry)) return;
      loadWindow(game, Math.max(0, entry - WINDOW / 2));
    },
    [entryOf, loadWindow],
  );

  /** Recorded entries of a game, or null until its first window is in. */
  const totalOf = useCallback((game: number): number | null => totals[game] ?? null, [totals]);

  const goTo = useCallback(
    (game: number, entry: number) => {
      const total = totalOf(game);
      const max = total === null ? Number.POSITIVE_INFINITY : Math.max(0, total - 1);
      const e = Math.min(Math.max(0, entry), max);
      setReplay({ game, entry: e });
      ensureLoaded(game, e);
    },
    [totalOf, ensureLoaded],
  );

  /* Play: one entry per tick at the chosen speed, held at the last entry. */
  useEffect(() => {
    if (!playing || !replay) return;
    const t = window.setInterval(() => {
      setReplay(cur => {
        if (!cur) return cur;
        const total = totalOf(cur.game);
        if (total === null) return cur;
        const max = Math.max(0, total - 1);
        if (cur.entry >= max) {
          setPlaying(false);
          return cur;
        }
        const next = cur.entry + 1;
        ensureLoaded(cur.game, next);
        // Look ahead so the next window is in before the scrubber reaches it.
        const ahead = next + 20;
        if (ahead <= max && !entryOf(cur.game, ahead)) loadWindow(cur.game, next + 1);
        return { game: cur.game, entry: next };
      });
    }, 1_000 / speed);
    return () => window.clearInterval(t);
  }, [playing, speed, replay, totalOf, ensureLoaded, entryOf, loadWindow]);

  const goLive = () => {
    setPlaying(false);
    setReplay(null);
  };

  const row = replay ? entryOf(replay.game, replay.entry) : null;
  const game = state?.game ?? null;
  const grid = replay
    ? (games.find(g => g.number === replay.game)?.size ?? state?.grid ?? 12)
    : (state?.grid ?? game?.size ?? 12);

  /* What the board draws: the live game, or the scrubbed entry. */
  const drawn = replay
    ? row
      ? { snake: row.snake, food: row.food, heading: row.heading }
      : null
    : game
      ? { snake: game.snake, food: game.food, heading: game.heading }
      : null;

  const next = state?.next ?? null;
  const elapsed = fetchedAt ? Math.max(0, (now - fetchedAt) / 1000) : 0;
  const seconds = next ? Math.max(0, next.seconds - elapsed) : 0;

  /* The 60-move impacts, carried on the drawing but not printed (the tiles
     were cut 2026-09-11); rendering them again is a one-line change here. */
  const impacts = state ? ACTIONS.map(a => impactOf(state, a)) : [];
  const impactsAttr = impacts.length
    ? impacts.map(v => (v === null ? '' : String(Number(v.toFixed(1))))).join(',')
    : undefined;

  /* The scrubber's game: the one being replayed, else the newest. */
  const scrubGame = replay?.game ?? games[0]?.number;
  const scrubTotal = scrubGame === undefined ? null : totalOf(scrubGame);
  const scrubMax = scrubTotal === null ? 0 : Math.max(0, scrubTotal - 1);
  const scrubValue = replay ? Math.min(replay.entry, scrubMax) : scrubMax;

  /* The one line under the grid. */
  let line: { text: string; clock?: string; cls: string };
  if (replay) {
    line = { text: row ? replayLine(row) : `Game ${replay.game}`, cls: 'is-replay' };
  } else if (!state) {
    line = { text: failed ? 'Feed unavailable' : 'Loading', cls: 'is-idle' };
  } else if (!game) {
    line = { text: failed ? 'Feed unavailable' : 'Waiting for the next game', cls: 'is-idle' };
  } else if (!next || !(next.action in ACTION_WORDS)) {
    line = { text: 'Next move: continue forward (default)', cls: 'is-default' };
  } else if (next.decided) {
    line = { text: `Next move: ${ACTION_WORDS[next.action]}, decided`, cls: 'is-decided' };
  } else {
    line = { text: `Next move: ${ACTION_WORDS[next.action]} in `, clock: clock(seconds), cls: 'is-open' };
  }

  return (
    <div className="snake-live">
      <div className="snake-main" data-impacts={impactsAttr}>
        <div className="snake-board-box">
          {drawn ? (
            <Board grid={grid} snake={drawn.snake} food={drawn.food} heading={drawn.heading} />
          ) : (
            <Board grid={grid} snake={[]} food={null} heading="right" />
          )}
        </div>
        <p className={`snake-next ${line.cls}`}>
          {line.text}
          {line.clock !== undefined && <span className="snake-clock">{line.clock}</span>}
        </p>
      </div>
      <div className="snake-replay" role="group" aria-label="Replay">
        <select
          className="snake-games"
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
              {`Game ${g.number} · ${g.size}x${g.size} · best ${g.bestLength}`}
            </option>
          ))}
        </select>
        <input
          className="snake-scrub"
          type="range"
          aria-label="Entry"
          min={0}
          max={scrubMax}
          value={scrubValue}
          disabled={scrubTotal === null}
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
          disabled={scrubTotal === null}
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
          className={`mchart-range snake-btn snake-live-btn${replay === null ? ' is-active' : ''}`}
          aria-pressed={replay === null}
          onClick={goLive}
        >
          Live
        </button>
      </div>
    </div>
  );
}
