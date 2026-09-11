import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
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
 * live view is a segment of the chart slot", "The snake feed"): the grid,
 * the next move with its countdown, three tiles carrying the 60-move impact
 * with the leader in the accent, one status line, one quiet line; and under
 * it the replay: a game picker, a scrubber, play, a speed, and LIVE.
 *
 * Realtime polls GET /api/marketplace/:slug/live every 2 seconds while the
 * tab is visible. Replay reads windows of 300 steps of one game around the
 * step the scrubber sits on and draws that step on the same grid. No
 * library: an svg, a range input and a timer.
 */

const POLL_MS = 2_000;
const WINDOW = 300;
/** Drawing units per cell; the svg scales to its box. */
const CELL = 24;

const ARROW: Record<SnakeHeading, string> = { up: '↑', down: '↓', left: '←', right: '→' };
const ACTION_LABEL: Record<SnakeAction, string> = { forward: 'Continue', left: 'Turn left', right: 'Turn right' };
const ACTIONS: SnakeAction[] = ['forward', 'left', 'right'];

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

function formatImpact(v: number | null): string {
  if (v === null) return '—';
  const abs = Math.abs(v).toFixed(1);
  return v < 0 ? `-${abs}` : `+${abs}`;
}

function formatCost(c: number): string {
  return Number.isInteger(c) ? String(c) : c.toFixed(1);
}

/** The proposal's address on this floor when its url ends in a number. */
function proposalHref(slug: string, url: string): { to: string } | { href: string } {
  const m = url.match(/\/p\/(\d+)\/?$/);
  return m ? { to: `/${slug}/p/${m[1]}` } : { href: url };
}

/** The board: grid x grid cells, the snake as one rounded band head first,
 *  a lighter head with two eyes on the moving side, the food a red dot. */
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
      <rect className="snake-bg" x={0} y={0} width={side} height={side} rx={CELL * 0.5} />
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

type Replay = { game: number; step: number };

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

  /* Replay: the games newest first, a per-game cache of loaded steps, and
     the step the scrubber sits on. Realtime while `replay` is null. */
  const [games, setGames] = useState<SnakeGame[]>([]);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 10>(1);
  const [totals, setTotals] = useState<Record<number, number>>({});
  const stepsRef = useRef<Map<number, Map<number, SnakeHistoryStep>>>(new Map());
  const loadingRef = useRef<Set<string>>(new Set());
  const [, setLoaded] = useState(0);

  useEffect(() => {
    let stopped = false;
    api
      .getLiveGames(slug)
      .then(r => {
        if (!stopped) setGames([...r.games].sort((a, b) => b.number - a.number));
      })
      .catch(() => {
        /* No record yet: the replay row stays empty. */
      });
    return () => {
      stopped = true;
    };
  }, [slug]);

  const stepOf = useCallback((game: number, step: number) => stepsRef.current.get(game)?.get(step) ?? null, []);

  const loadWindow = useCallback(
    (game: number, from: number) => {
      const key = `${game}:${from}`;
      if (loadingRef.current.has(key)) return;
      loadingRef.current.add(key);
      api
        .getLiveHistory(slug, { game, from, limit: WINDOW })
        .then(h => {
          let map = stepsRef.current.get(game);
          if (!map) {
            map = new Map();
            stepsRef.current.set(game, map);
          }
          for (const s of h.steps) map.set(s.step, s);
          setTotals(t => (t[game] === h.total ? t : { ...t, [game]: h.total }));
          setLoaded(n => n + 1);
        })
        .catch(() => {
          /* A window that fails to load leaves the last drawn step on screen. */
        })
        .finally(() => loadingRef.current.delete(key));
    },
    [slug],
  );

  /** The step's row, fetching the window around it when it is not loaded. */
  const ensureLoaded = useCallback(
    (game: number, step: number) => {
      if (stepOf(game, step)) return;
      loadWindow(game, Math.max(0, step - WINDOW / 2));
    },
    [stepOf, loadWindow],
  );

  const totalOf = useCallback(
    (game: number) => totals[game] ?? (games.find(g => g.number === game)?.steps ?? 0) + 1,
    [totals, games],
  );

  const goTo = useCallback(
    (game: number, step: number) => {
      const max = Math.max(0, totalOf(game) - 1);
      const s = Math.min(Math.max(0, step), max);
      setReplay({ game, step: s });
      ensureLoaded(game, s);
    },
    [totalOf, ensureLoaded],
  );

  /* Play: one step per tick at the chosen speed, held at the last step. */
  useEffect(() => {
    if (!playing || !replay) return;
    const t = window.setInterval(() => {
      setReplay(cur => {
        if (!cur) return cur;
        const max = Math.max(0, totalOf(cur.game) - 1);
        if (cur.step >= max) {
          setPlaying(false);
          return cur;
        }
        const next = cur.step + 1;
        ensureLoaded(cur.game, next);
        // Look ahead so the next window is in before the scrubber reaches it.
        const ahead = next + 20;
        if (ahead <= max && !stepOf(cur.game, ahead)) loadWindow(cur.game, next + 1);
        return { game: cur.game, step: next };
      });
    }, 1_000 / speed);
    return () => window.clearInterval(t);
  }, [playing, speed, replay?.game, totalOf, ensureLoaded, stepOf, loadWindow]);

  const goLive = () => {
    setPlaying(false);
    setReplay(null);
  };

  const row = replay ? stepOf(replay.game, replay.step) : null;
  const game = state?.game ?? null;
  const grid = replay
    ? (games.find(g => g.number === replay.game)?.size ?? row?.snake.length ?? state?.grid ?? 12)
    : (state?.grid ?? game?.size ?? 12);

  /* What the board draws: the live game, or the scrubbed step. */
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

  const impacts = state ? ACTIONS.map(a => impactOf(state, a)) : [];
  const readable = impacts.filter((v): v is number => v !== null);
  const leader: SnakeAction = readable.length === 0 ? 'forward' : ACTIONS[impacts.indexOf(Math.max(...readable))];

  const trade = state?.recentTrades?.[0] ?? null;
  const quiet = trade
    ? `${trade.handle} ${trade.kind === 'sell' ? 'sold' : 'bet'} ${formatCost(trade.cost)} on ${ACTION_LABEL[trade.action] ?? trade.action}`
    : (state?.commentary ?? null);

  const total = replay ? totalOf(replay.game) : 0;

  return (
    <div className="snake-live">
      <div className="snake-main">
        <div className="snake-board-box">
          {drawn ? (
            <Board grid={grid} snake={drawn.snake} food={drawn.food} heading={drawn.heading} />
          ) : (
            <Board grid={grid} snake={[]} food={null} heading="right" />
          )}
        </div>
        <div className="snake-side">
          {replay ? (
            <p className="snake-status">
              {row
                ? `Length ${row.length} · Game ${replay.game} · Step ${replay.step} · ${
                    row.action === null ? 'Start' : ACTION_LABEL[row.action]
                  }`
                : `Game ${replay.game} · Step ${replay.step}`}
            </p>
          ) : (
            <>
              {next ? (
                <p className={`snake-next${next.decided ? ' is-decided' : ''}`}>
                  <span className="snake-next-move">{`${ARROW[next.direction]} ${ACTION_LABEL[next.action]}`}</span>
                  <span className="snake-clock">{next.decided ? 'decided' : clock(seconds)}</span>
                </p>
              ) : state ? (
                <p className="snake-next is-idle">
                  <span className="snake-next-move">{failed ? 'Feed unavailable' : 'Waiting for the next game'}</span>
                </p>
              ) : (
                <p className="snake-next is-idle">
                  <span className="snake-next-move">{failed ? 'Feed unavailable' : 'Loading'}</span>
                </p>
              )}
              {state?.open && (
                <div className="snake-tiles">
                  {ACTIONS.map((a, i) => {
                    const dir = state.open?.directions?.[a];
                    const p = state.open?.proposals?.[a] ?? null;
                    const cls = `snake-tile${a === leader ? ' is-lead' : ''}`;
                    const body = (
                      <>
                        <span className="snake-tile-arrow">{dir ? ARROW[dir] : ''}</span>
                        <span className="snake-tile-impact">{formatImpact(impacts[i])}</span>
                        <span className="snake-tile-name">{ACTION_LABEL[a]}</span>
                      </>
                    );
                    if (!p?.url) {
                      return (
                        <span key={a} className={cls}>
                          {body}
                        </span>
                      );
                    }
                    const href = proposalHref(slug, p.url);
                    return 'to' in href ? (
                      <Link key={a} className={cls} to={href.to}>
                        {body}
                      </Link>
                    ) : (
                      <a key={a} className={cls} href={href.href} target="_blank" rel="noopener noreferrer">
                        {body}
                      </a>
                    );
                  })}
                </div>
              )}
              {game && (
                <p className="snake-status">{`Length ${game.length} · Game ${state?.gameNumber ?? game.gameNumber} · ${grid}x${grid}`}</p>
              )}
              {quiet && <p className="snake-quiet">{quiet}</p>}
            </>
          )}
        </div>
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
          aria-label="Step"
          min={0}
          max={replay ? Math.max(0, total - 1) : 0}
          value={replay?.step ?? 0}
          disabled={games.length === 0}
          onChange={e => {
            const g = replay?.game ?? games[0]?.number;
            if (g === undefined) return;
            setPlaying(false);
            goTo(g, Number(e.target.value));
          }}
        />
        <button
          type="button"
          className="snake-btn"
          disabled={games.length === 0}
          onClick={() => {
            if (!replay) {
              const g = games[0]?.number;
              if (g === undefined) return;
              goTo(g, 0);
            }
            setPlaying(p => !p);
          }}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="snake-btn" onClick={() => setSpeed(s => (s === 1 ? 10 : 1))}>
          {`${speed}x`}
        </button>
        <button
          type="button"
          className={`snake-btn snake-live-btn${replay === null ? ' is-active' : ''}`}
          aria-pressed={replay === null}
          onClick={goLive}
        >
          Live
        </button>
      </div>
    </div>
  );
}
